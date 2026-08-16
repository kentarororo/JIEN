import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { toLocalDateKey } from '@/lib/time';
import { calculateStartingNutritionTarget } from '@/lib/nutrition/targets';
import { inferMealLoggingPattern } from '@/lib/nutrition/meal-pattern';
import type { AdaptiveNutritionHistoryDay } from '@/lib/nutrition/adaptive-targets';
import {
  activeRecordPredicate,
  calculateMealTotals,
  mealDateQueryKey,
  tombstonePayload,
  validateMealEdit,
} from '@/lib/nutrition/meal-record';

import { enqueueUpsert } from './sync-queue';
import { withExclusiveTransaction } from './exclusive-transaction';
import { saveNutritionTargetAtomically } from './nutrition-target-save';
import { getUserProfile } from './profile';
import { getLatestBodyMeasurement } from './wellness';
import type {
  DailyNutrition,
  MealDetail,
  MealItemSnapshot,
  MealSource,
  MacroTotals,
  MealSummary,
  MealType,
  NutritionExportRow,
  NutritionTarget,
  SaveMealInput,
  UpdateMealInput,
} from './types';

const EMPTY_TOTALS: MacroTotals = {
  caloriesKcal: 0,
  proteinG: 0,
  carbohydrateG: 0,
  fatG: 0,
  fibreG: 0,
};

export async function saveMeal(db: SQLiteDatabase, input: SaveMealInput): Promise<string> {
  if (input.items.length === 0) throw new Error('Add at least one food item.');
  if (
    input.items.some(
      (item) =>
        !item.name.trim() ||
        item.quantity <= 0 ||
        item.caloriesKcal < 0 ||
        item.proteinG < 0 ||
        item.carbohydrateG < 0 ||
        item.fatG < 0,
    )
  ) {
    throw new Error('Food names, portions, and macros must be valid non-negative values.');
  }
  const eatenAt = new Date(input.eatenAt);
  if (!Number.isFinite(eatenAt.getTime()) || eatenAt.getTime() > Date.now() + 60_000) {
    throw new Error('Logged meals must use today or an earlier calendar date.');
  }

  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  const eatenOn = toLocalDateKey(eatenAt);
  const mealSource = input.items.some((item) => item.source === 'ai_photo')
    ? 'ai_photo'
    : input.items.some((item) => item.source === 'imported') ? 'imported' : 'manual';
  const mealPayload = {
    id,
    name: input.name.trim() || 'Meal',
    type: input.type,
    eaten_on: eatenOn,
    eaten_at: input.eatenAt,
    source: mealSource,
    notes: input.notes?.trim() || null,
    photo_storage_path: null,
    ai_context: mealSource === 'ai_photo' ? input.aiContext?.trim() || null : null,
    ai_status: mealSource === 'ai_photo' ? 'completed' : 'not_requested',
    ai_error_code: null,
    is_user_edited: false,
    created_at: now,
    client_updated_at: now,
    deleted_at: null,
  };

  await withExclusiveTransaction(db, async (db) => {
    await db.runAsync(
      `INSERT INTO meals (
        id, name, type, eaten_on, eaten_at, source, notes,
        is_user_edited, created_at, updated_at, client_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [id, mealPayload.name, input.type, eatenOn, input.eatenAt, mealSource, mealPayload.notes, now, now, now],
    );
    await enqueueUpsert(db, 'meals', id, mealPayload);

    for (const [index, item] of input.items.entries()) {
      const itemId = Crypto.randomUUID();
      const itemPayload = {
        id: itemId,
        meal_id: id,
        sort_order: index,
        name: item.name.trim(),
        quantity: item.quantity,
        unit: item.unit.trim() || 'serving',
        calories_kcal: item.caloriesKcal,
        protein_g: item.proteinG,
        carbohydrate_g: item.carbohydrateG,
        fat_g: item.fatG,
        fibre_g: item.fibreG ?? null,
        source: item.source ?? 'manual',
        confidence: item.confidence ?? null,
        original_source: item.source ?? 'manual',
        original_confidence: item.confidence ?? null,
        is_user_edited: false,
        created_at: now,
        client_updated_at: now,
        deleted_at: null,
      };
      await db.runAsync(
        `INSERT INTO food_items (
          id, meal_id, sort_order, name, quantity, unit, calories_kcal, protein_g,
          carbohydrate_g, fat_g, fibre_g, source, confidence, original_source,
          original_confidence, is_user_edited, created_at, updated_at, client_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          itemId,
          id,
          index,
          itemPayload.name,
          item.quantity,
          itemPayload.unit,
          item.caloriesKcal,
          item.proteinG,
          item.carbohydrateG,
          item.fatG,
          item.fibreG ?? null,
          itemPayload.source,
          itemPayload.confidence,
          itemPayload.original_source,
          itemPayload.original_confidence,
          now,
          now,
          now,
        ],
      );
      await enqueueUpsert(db, 'food_items', itemId, itemPayload);
    }
  });

  return id;
}

export async function listMealsForDate(
  db: SQLiteDatabase,
  date = toLocalDateKey(),
): Promise<MealSummary[]> {
  const queryDate = mealDateQueryKey(date);
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    type: MealType | null;
    eaten_at: string;
    item_count: number;
    calories_kcal: number | null;
    protein_g: number | null;
    carbohydrate_g: number | null;
    fat_g: number | null;
    fibre_g: number | null;
  }>(
    `SELECT m.id, m.name, m.type, m.eaten_at, COUNT(f.id) AS item_count,
      COALESCE(SUM(f.calories_kcal), 0) AS calories_kcal,
      COALESCE(SUM(f.protein_g), 0) AS protein_g,
      COALESCE(SUM(f.carbohydrate_g), 0) AS carbohydrate_g,
      COALESCE(SUM(f.fat_g), 0) AS fat_g,
      COALESCE(SUM(f.fibre_g), 0) AS fibre_g
     FROM meals m
     LEFT JOIN food_items f ON f.meal_id = m.id AND ${activeRecordPredicate('f')}
     WHERE m.eaten_on = ? AND ${activeRecordPredicate('m')}
     GROUP BY m.id
     ORDER BY m.eaten_at DESC`,
    [queryDate],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    eatenAt: row.eaten_at,
    itemCount: row.item_count,
    caloriesKcal: row.calories_kcal ?? 0,
    proteinG: row.protein_g ?? 0,
    carbohydrateG: row.carbohydrate_g ?? 0,
    fatG: row.fat_g ?? 0,
    fibreG: row.fibre_g ?? 0,
  }));
}

export async function getDailyNutrition(
  db: SQLiteDatabase,
  date = toLocalDateKey(),
): Promise<DailyNutrition> {
  const meals = await listMealsForDate(db, date);
  const totals = meals.reduce<MacroTotals>(
    (sum, meal) => ({
      caloriesKcal: sum.caloriesKcal + meal.caloriesKcal,
      proteinG: sum.proteinG + meal.proteinG,
      carbohydrateG: sum.carbohydrateG + meal.carbohydrateG,
      fatG: sum.fatG + meal.fatG,
      fibreG: sum.fibreG + meal.fibreG,
    }),
    { ...EMPTY_TOTALS },
  );

  const target = await getNutritionTarget(db, date) ?? (date === toLocalDateKey()
    ? await ensureStartingNutritionTarget(db)
    : null);
  return { date, meals, totals, target };
}

export async function getMealLoggingPattern(
  db: SQLiteDatabase,
  now = new Date(),
): Promise<{ established: boolean; expectedMeals: number | null; sampleDays: number }> {
  const today = toLocalDateKey(now);
  const since = new Date(now);
  since.setDate(since.getDate() - 14);
  const rows = await db.getAllAsync<{ meal_count: number }>(
    `SELECT COUNT(*) AS meal_count
     FROM meals
     WHERE eaten_on >= ? AND eaten_on < ? AND deleted_at IS NULL
     GROUP BY eaten_on
     ORDER BY meal_count`,
    [toLocalDateKey(since), today],
  );
  return inferMealLoggingPattern(rows.map((row) => Number(row.meal_count)));
}

type MealRecordRow = {
  id: string;
  name: string;
  type: MealType | null;
  eaten_on: string;
  eaten_at: string;
  source: MealSource;
  notes: string | null;
  is_user_edited: number;
  created_at: string;
  updated_at: string;
};

type FoodItemRecordRow = {
  id: string;
  meal_id: string;
  sort_order: number;
  name: string;
  quantity: number;
  unit: string;
  calories_kcal: number;
  protein_g: number;
  carbohydrate_g: number;
  fat_g: number;
  fibre_g: number | null;
  source: MealSource;
  confidence: number | null;
  original_source: MealSource | null;
  original_confidence: number | null;
  is_user_edited: number;
  created_at: string;
};

export async function getMealDetail(db: SQLiteDatabase, mealId: string): Promise<MealDetail | null> {
  const meal = await db.getFirstAsync<MealRecordRow>(
    `SELECT id, name, type, eaten_on, eaten_at, source, notes, is_user_edited,
      created_at, updated_at
     FROM meals WHERE id = ? AND ${activeRecordPredicate('meals')}`,
    [mealId],
  );
  if (!meal) return null;
  const rows = await db.getAllAsync<FoodItemRecordRow>(
    `SELECT id, meal_id, sort_order, name, quantity, unit, calories_kcal, protein_g,
      carbohydrate_g, fat_g, fibre_g, source, confidence, original_source,
      original_confidence, is_user_edited, created_at
     FROM food_items
     WHERE meal_id = ? AND ${activeRecordPredicate('food_items')}
     ORDER BY sort_order`,
    [mealId],
  );
  const items: MealItemSnapshot[] = rows.map((item) => ({
    id: item.id,
    sortOrder: item.sort_order,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    caloriesKcal: item.calories_kcal,
    proteinG: item.protein_g,
    carbohydrateG: item.carbohydrate_g,
    fatG: item.fat_g,
    fibreG: item.fibre_g,
    source: item.source,
    originalSource: item.original_source ?? item.source,
    confidence: item.confidence,
    originalConfidence: item.original_confidence ?? item.confidence,
    isUserEdited: Boolean(item.is_user_edited),
  }));
  const totals = calculateMealTotals(items);
  return {
    id: meal.id,
    name: meal.name,
    type: meal.type,
    eatenOn: meal.eaten_on,
    eatenAt: meal.eaten_at,
    source: meal.source,
    notes: meal.notes,
    createdAt: meal.created_at,
    updatedAt: meal.updated_at,
    isUserEdited: Boolean(meal.is_user_edited),
    itemCount: items.length,
    items,
    ...totals,
  };
}

export async function updateMeal(
  db: SQLiteDatabase,
  mealId: string,
  input: UpdateMealInput,
): Promise<void> {
  const meal = await db.getFirstAsync<MealRecordRow>(
    `SELECT id, name, type, eaten_on, eaten_at, source, notes, is_user_edited,
      created_at, updated_at FROM meals
     WHERE id = ? AND ${activeRecordPredicate('meals')}`,
    [mealId],
  );
  if (!meal) throw new Error('This meal is no longer available.');
  const currentItems = await db.getAllAsync<FoodItemRecordRow>(
    `SELECT id, meal_id, sort_order, name, quantity, unit, calories_kcal, protein_g,
      carbohydrate_g, fat_g, fibre_g, source, confidence, original_source,
      original_confidence, is_user_edited, created_at
     FROM food_items WHERE meal_id = ? AND ${activeRecordPredicate('food_items')}
     ORDER BY sort_order`,
    [mealId],
  );
  const validated = validateMealEdit(input);
  if (validated.items.length !== currentItems.length) {
    throw new Error('Reload this meal before changing its saved items.');
  }
  const currentById = new Map(currentItems.map((item) => [item.id, item]));
  if (validated.items.some((item) => !currentById.has(item.id))) {
    throw new Error('Reload this meal before changing its saved items.');
  }
  const now = new Date().toISOString();
  const prepared = validated.items.map((item) => {
    const current = currentById.get(item.id)!;
    const changed = item.name !== current.name
      || item.quantity !== current.quantity
      || item.unit !== current.unit
      || item.caloriesKcal !== current.calories_kcal
      || item.proteinG !== current.protein_g
      || item.carbohydrateG !== current.carbohydrate_g
      || item.fatG !== current.fat_g
      || item.fibreG !== current.fibre_g;
    return {
      current,
      item,
      source: changed ? 'manual' as const : current.source,
      confidence: changed ? null : current.confidence,
      originalSource: current.original_source ?? current.source,
      originalConfidence: current.original_confidence ?? current.confidence,
      isUserEdited: Boolean(current.is_user_edited) || changed,
    };
  });
  const mealChanged = validated.name !== meal.name
    || validated.eatenAt !== new Date(meal.eaten_at).toISOString()
    || prepared.some((entry) => entry.isUserEdited && !entry.current.is_user_edited);
  const mealPayload = {
    id: meal.id,
    name: validated.name,
    type: meal.type,
    eaten_on: validated.eatenOn,
    eaten_at: validated.eatenAt,
    source: meal.source,
    notes: meal.notes,
    is_user_edited: Boolean(meal.is_user_edited) || mealChanged,
    created_at: meal.created_at,
    client_updated_at: now,
    deleted_at: null,
  };

  await withExclusiveTransaction(db, async (db) => {
    await db.runAsync(
      `UPDATE meals SET name = ?, eaten_on = ?, eaten_at = ?, is_user_edited = ?,
        updated_at = ?, client_updated_at = ? WHERE id = ?`,
      [validated.name, validated.eatenOn, validated.eatenAt, mealPayload.is_user_edited ? 1 : 0, now, now, mealId],
    );
    await enqueueUpsert(db, 'meals', mealId, mealPayload);
    for (const entry of prepared) {
      await db.runAsync(
        `UPDATE food_items SET name = ?, quantity = ?, unit = ?, calories_kcal = ?,
          protein_g = ?, carbohydrate_g = ?, fat_g = ?, fibre_g = ?, source = ?,
          confidence = ?, original_source = ?, original_confidence = ?, is_user_edited = ?,
          updated_at = ?, client_updated_at = ? WHERE id = ?`,
        [
          entry.item.name, entry.item.quantity, entry.item.unit, entry.item.caloriesKcal,
          entry.item.proteinG, entry.item.carbohydrateG, entry.item.fatG, entry.item.fibreG,
          entry.source, entry.confidence, entry.originalSource, entry.originalConfidence,
          entry.isUserEdited ? 1 : 0, now, now, entry.item.id,
        ],
      );
      await enqueueUpsert(db, 'food_items', entry.item.id, {
        id: entry.item.id,
        meal_id: mealId,
        sort_order: entry.current.sort_order,
        name: entry.item.name,
        quantity: entry.item.quantity,
        unit: entry.item.unit,
        calories_kcal: entry.item.caloriesKcal,
        protein_g: entry.item.proteinG,
        carbohydrate_g: entry.item.carbohydrateG,
        fat_g: entry.item.fatG,
        fibre_g: entry.item.fibreG,
        source: entry.source,
        confidence: entry.confidence,
        original_source: entry.originalSource,
        original_confidence: entry.originalConfidence,
        is_user_edited: entry.isUserEdited,
        created_at: entry.current.created_at,
        client_updated_at: now,
        deleted_at: null,
      });
    }
  });
}

export async function deleteMeal(db: SQLiteDatabase, mealId: string): Promise<void> {
  const meal = await db.getFirstAsync<MealRecordRow>(
    `SELECT id, name, type, eaten_on, eaten_at, source, notes, is_user_edited,
      created_at, updated_at FROM meals
     WHERE id = ? AND ${activeRecordPredicate('meals')}`,
    [mealId],
  );
  if (!meal) return;
  const items = await db.getAllAsync<FoodItemRecordRow>(
    `SELECT id, meal_id, sort_order, name, quantity, unit, calories_kcal, protein_g,
      carbohydrate_g, fat_g, fibre_g, source, confidence, original_source,
      original_confidence, is_user_edited, created_at
     FROM food_items WHERE meal_id = ? AND ${activeRecordPredicate('food_items')}`,
    [mealId],
  );
  const deletedAt = new Date().toISOString();
  await withExclusiveTransaction(db, async (db) => {
    await db.runAsync(
      `UPDATE meals SET deleted_at = ?, updated_at = ?, client_updated_at = ? WHERE id = ?`,
      [deletedAt, deletedAt, deletedAt, mealId],
    );
    await enqueueUpsert(db, 'meals', mealId, tombstonePayload({
      id: meal.id,
      name: meal.name,
      type: meal.type,
      eaten_on: meal.eaten_on,
      eaten_at: meal.eaten_at,
      source: meal.source,
      notes: meal.notes,
      is_user_edited: Boolean(meal.is_user_edited),
      created_at: meal.created_at,
    }, deletedAt));
    for (const item of items) {
      await db.runAsync(
        `UPDATE food_items SET deleted_at = ?, updated_at = ?, client_updated_at = ? WHERE id = ?`,
        [deletedAt, deletedAt, deletedAt, item.id],
      );
      await enqueueUpsert(db, 'food_items', item.id, tombstonePayload({
        id: item.id,
        meal_id: mealId,
        sort_order: item.sort_order,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        calories_kcal: item.calories_kcal,
        protein_g: item.protein_g,
        carbohydrate_g: item.carbohydrate_g,
        fat_g: item.fat_g,
        fibre_g: item.fibre_g,
        source: item.source,
        confidence: item.confidence,
        original_source: item.original_source ?? item.source,
        original_confidence: item.original_confidence ?? item.confidence,
        is_user_edited: Boolean(item.is_user_edited),
        created_at: item.created_at,
      }, deletedAt));
    }
  });
}

export async function ensureStartingNutritionTarget(
  db: SQLiteDatabase,
): Promise<NutritionTarget | null> {
  const current = await getNutritionTarget(db);
  if (current) return current;
  const [measurement, profile] = await Promise.all([
    getLatestBodyMeasurement(db),
    getUserProfile(db),
  ]);
  if (!measurement || !profile) return null;
  return saveNutritionTarget(
    db,
    {
      ...calculateStartingNutritionTarget({
        bodyWeightKg: measurement.bodyWeightKg,
        goals: profile.goals,
      }),
      desiredWeeklyWeightChangePercent: 0,
    },
    {
      source: 'adaptive',
      rationale: `Starting estimate from ${measurement.bodyWeightKg} kg body weight and onboarding goal. Edit at any time.`,
    },
  );
}

export async function getNutritionTarget(
  db: SQLiteDatabase,
  date = toLocalDateKey(),
): Promise<NutritionTarget | null> {
  const row = await db.getFirstAsync<{
    id: string;
    effective_from: string;
    calories_kcal: number;
    protein_g: number;
    carbohydrate_g: number;
    fat_g: number;
    fibre_g: number | null;
    desired_weekly_weight_change_percent: number;
  }>(
    `SELECT id, effective_from, calories_kcal, protein_g, carbohydrate_g, fat_g, fibre_g,
      desired_weekly_weight_change_percent
     FROM nutrition_targets
     WHERE effective_from <= ?
       AND (effective_to IS NULL OR effective_to >= ?)
       AND deleted_at IS NULL
     ORDER BY effective_from DESC
     LIMIT 1`,
    [date, date],
  );
  if (!row) return null;
  return {
    id: row.id,
    effectiveFrom: row.effective_from,
    caloriesKcal: row.calories_kcal,
    proteinG: row.protein_g,
    carbohydrateG: row.carbohydrate_g,
    fatG: row.fat_g,
    fibreG: row.fibre_g ?? 0,
    desiredWeeklyWeightChangePercent: row.desired_weekly_weight_change_percent,
  };
}

export async function getAdaptiveNutritionHistory(
  db: SQLiteDatabase,
  days = 35,
): Promise<AdaptiveNutritionHistoryDay[]> {
  const safeDays = Math.max(21, Math.min(90, Math.floor(days)));
  const start = new Date();
  start.setDate(start.getDate() - safeDays + 1);
  const startDate = toLocalDateKey(start);
  const [weights, nutrition] = await Promise.all([
    db.getAllAsync<{ date: string; body_weight_kg: number }>(
      `SELECT w.logged_on AS date, w.body_weight_kg
       FROM wellness_logs w
       WHERE w.kind = 'body_measurement'
         AND w.logged_on >= ?
         AND w.deleted_at IS NULL
         AND w.logged_at = (
           SELECT MAX(latest.logged_at)
           FROM wellness_logs latest
           WHERE latest.kind = 'body_measurement'
             AND latest.logged_on = w.logged_on
             AND latest.deleted_at IS NULL
         )
       ORDER BY w.logged_on`,
      [startDate],
    ),
    db.getAllAsync<{ date: string; calories_kcal: number; protein_g: number }>(
      `SELECT m.eaten_on AS date,
        COALESCE(SUM(f.calories_kcal), 0) AS calories_kcal,
        COALESCE(SUM(f.protein_g), 0) AS protein_g
       FROM meals m
       LEFT JOIN food_items f ON f.meal_id = m.id AND f.deleted_at IS NULL
       WHERE m.eaten_on >= ? AND m.deleted_at IS NULL
       GROUP BY m.eaten_on
       ORDER BY m.eaten_on`,
      [startDate],
    ),
  ]);
  const byDate = new Map<string, AdaptiveNutritionHistoryDay>();
  for (const row of weights) {
    byDate.set(row.date, { date: row.date, bodyWeightKg: row.body_weight_kg, caloriesKcal: null, proteinG: null });
  }
  for (const row of nutrition) {
    const current = byDate.get(row.date) ?? { date: row.date, bodyWeightKg: null, caloriesKcal: null, proteinG: null };
    byDate.set(row.date, { ...current, caloriesKcal: row.calories_kcal, proteinG: row.protein_g });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function saveNutritionTarget(
  db: SQLiteDatabase,
  input: Omit<NutritionTarget, 'id' | 'effectiveFrom'>,
  options: { source?: 'manual' | 'adaptive'; rationale?: string | null } = {},
): Promise<NutritionTarget> {
  if (input.caloriesKcal <= 0 || input.proteinG < 0 || input.carbohydrateG < 0 || input.fatG < 0) {
    throw new Error('Macro targets must be valid non-negative values.');
  }
  if (!Number.isFinite(input.desiredWeeklyWeightChangePercent)
    || input.desiredWeeklyWeightChangePercent < -1
    || input.desiredWeeklyWeightChangePercent > 1) {
    throw new Error('Desired weekly weight change must be between -1% and 1%.');
  }
  return saveNutritionTargetAtomically(db, input, options, {
    createId: Crypto.randomUUID,
    now: () => new Date(),
    toLocalDateKey,
    enqueueUpsert: (database, entityId, payload) => (
      enqueueUpsert(database, 'nutrition_targets', entityId, payload)
    ),
  });
}

export async function listNutritionExportRows(
  db: SQLiteDatabase,
): Promise<NutritionExportRow[]> {
  const rows = await db.getAllAsync<{
    meal_id: string;
    eaten_on: string;
    eaten_at: string;
    meal_name: string;
    meal_type: MealType | null;
    food: string;
    quantity: number;
    unit: string;
    calories_kcal: number;
    protein_g: number;
    carbohydrate_g: number;
    fat_g: number;
    fibre_g: number | null;
  }>(
    `SELECT m.id AS meal_id, m.eaten_on, m.eaten_at, m.name AS meal_name, m.type AS meal_type,
      f.name AS food, f.quantity, f.unit, f.calories_kcal, f.protein_g,
      f.carbohydrate_g, f.fat_g, f.fibre_g
     FROM food_items f
     JOIN meals m ON m.id = f.meal_id
     WHERE f.deleted_at IS NULL AND m.deleted_at IS NULL
     ORDER BY m.eaten_on, m.eaten_at, f.sort_order`,
  );
  return rows.map((row) => ({
    mealId: row.meal_id,
    eatenOn: row.eaten_on,
    eatenAt: row.eaten_at,
    mealName: row.meal_name,
    mealType: row.meal_type,
    food: row.food,
    quantity: row.quantity,
    unit: row.unit,
    caloriesKcal: row.calories_kcal,
    proteinG: row.protein_g,
    carbohydrateG: row.carbohydrate_g,
    fatG: row.fat_g,
    fibreG: row.fibre_g,
  }));
}
