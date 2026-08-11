import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { toLocalDateKey } from '@/lib/time';

import { enqueueUpsert } from './sync-queue';
import type {
  DailyNutrition,
  MacroTotals,
  MealSummary,
  MealType,
  NutritionExportRow,
  NutritionTarget,
  SaveMealInput,
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

  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  const eatenOn = toLocalDateKey(new Date(input.eatenAt));
  const mealPayload = {
    id,
    name: input.name.trim() || 'Meal',
    type: input.type,
    eaten_on: eatenOn,
    eaten_at: input.eatenAt,
    source: 'manual',
    notes: input.notes?.trim() || null,
    photo_storage_path: null,
    ai_context: null,
    ai_status: 'not_requested',
    ai_error_code: null,
    created_at: now,
    client_updated_at: now,
    deleted_at: null,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO meals (
        id, name, type, eaten_on, eaten_at, source, notes,
        created_at, updated_at, client_updated_at
      ) VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)`,
      [id, mealPayload.name, input.type, eatenOn, input.eatenAt, mealPayload.notes, now, now, now],
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
        source: 'manual',
        confidence: null,
        created_at: now,
        client_updated_at: now,
        deleted_at: null,
      };
      await db.runAsync(
        `INSERT INTO food_items (
          id, meal_id, sort_order, name, quantity, unit, calories_kcal, protein_g,
          carbohydrate_g, fat_g, fibre_g, source, created_at, updated_at, client_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)`,
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

export async function getDailyNutrition(
  db: SQLiteDatabase,
  date = toLocalDateKey(),
): Promise<DailyNutrition> {
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
     LEFT JOIN food_items f ON f.meal_id = m.id AND f.deleted_at IS NULL
     WHERE m.eaten_on = ? AND m.deleted_at IS NULL
     GROUP BY m.id
     ORDER BY m.eaten_at DESC`,
    [date],
  );

  const meals: MealSummary[] = rows.map((row) => ({
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

  return { date, meals, totals, target: await getNutritionTarget(db, date) };
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
  }>(
    `SELECT id, effective_from, calories_kcal, protein_g, carbohydrate_g, fat_g, fibre_g
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
  };
}

export async function saveNutritionTarget(
  db: SQLiteDatabase,
  input: Omit<NutritionTarget, 'id' | 'effectiveFrom'>,
): Promise<NutritionTarget> {
  if (input.caloriesKcal <= 0 || input.proteinG < 0 || input.carbohydrateG < 0 || input.fatG < 0) {
    throw new Error('Macro targets must be valid non-negative values.');
  }
  const now = new Date().toISOString();
  const effectiveFrom = toLocalDateKey();
  const current = await db.getFirstAsync<{
    id: string;
    effective_from: string;
    calories_kcal: number;
    protein_g: number;
    carbohydrate_g: number;
    fat_g: number;
    fibre_g: number | null;
    source: string;
    rationale: string | null;
    created_at: string;
  }>(
    `SELECT id, effective_from, calories_kcal, protein_g, carbohydrate_g, fat_g,
      fibre_g, source, rationale, created_at
     FROM nutrition_targets
     WHERE effective_to IS NULL AND deleted_at IS NULL
     ORDER BY effective_from DESC LIMIT 1`,
  );
  const updateCurrentDay = current?.effective_from === effectiveFrom;
  const id = updateCurrentDay && current ? current.id : Crypto.randomUUID();
  const payload = {
    id,
    effective_from: effectiveFrom,
    effective_to: null,
    calories_kcal: input.caloriesKcal,
    protein_g: input.proteinG,
    carbohydrate_g: input.carbohydrateG,
    fat_g: input.fatG,
    fibre_g: input.fibreG,
    source: 'manual',
    rationale: null,
    created_at: updateCurrentDay && current ? current.created_at : now,
    client_updated_at: now,
    deleted_at: null,
  };

  await db.withTransactionAsync(async () => {
    if (updateCurrentDay) {
      await db.runAsync(
        `UPDATE nutrition_targets SET
          calories_kcal = ?, protein_g = ?, carbohydrate_g = ?, fat_g = ?, fibre_g = ?,
          updated_at = ?, client_updated_at = ? WHERE id = ?`,
        [
          input.caloriesKcal,
          input.proteinG,
          input.carbohydrateG,
          input.fatG,
          input.fibreG,
          now,
          now,
          id,
        ],
      );
    } else {
      if (current) {
        const closedOn = toLocalDateKey(new Date(Date.now() - 86_400_000));
        await db.runAsync(
          `UPDATE nutrition_targets SET effective_to = ?, updated_at = ?, client_updated_at = ?
           WHERE id = ?`,
          [closedOn, now, now, current.id],
        );
        await enqueueUpsert(db, 'nutrition_targets', current.id, {
          id: current.id,
          effective_from: current.effective_from,
          effective_to: closedOn,
          calories_kcal: current.calories_kcal,
          protein_g: current.protein_g,
          carbohydrate_g: current.carbohydrate_g,
          fat_g: current.fat_g,
          fibre_g: current.fibre_g,
          source: current.source,
          rationale: current.rationale,
          created_at: current.created_at,
          client_updated_at: now,
          deleted_at: null,
        });
      }
      await db.runAsync(
        `INSERT INTO nutrition_targets (
          id, effective_from, calories_kcal, protein_g, carbohydrate_g, fat_g, fibre_g,
          source, created_at, updated_at, client_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)`,
        [
          id,
          effectiveFrom,
          input.caloriesKcal,
          input.proteinG,
          input.carbohydrateG,
          input.fatG,
          input.fibreG,
          now,
          now,
          now,
        ],
      );
    }
    await enqueueUpsert(db, 'nutrition_targets', id, payload);
  });
  return { id, effectiveFrom, ...input };
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
