import type { SQLiteDatabase } from 'expo-sqlite';

import { mealDateQueryKey } from '../nutrition/meal-record';
import { withExclusiveTransaction } from './exclusive-transaction';
import { enqueueUpsert } from './sync-queue';
import type { MealSource } from './types';

type FoodRow = {
  id: string; meal_id: string; sort_order: number; name: string; quantity: number; unit: string;
  calories_kcal: number; protein_g: number; carbohydrate_g: number; fat_g: number; fibre_g: number | null;
  source: MealSource; confidence: number | null; original_source: MealSource | null;
  original_confidence: number | null; is_user_edited: number; created_at: string;
};

export type DailyFoodItem = {
  id: string; mealId: string; name: string; quantity: number; unit: string; eatenAt: string;
  caloriesKcal: number; proteinG: number; carbohydrateG: number; fatG: number; fibreG: number | null;
  source: MealSource; originalSource: MealSource;
};

/** One query across both old multi-item meals and new individual entries. */
export async function listDailyFoodItems(db: SQLiteDatabase, date: string): Promise<DailyFoodItem[]> {
  const rows = await db.getAllAsync<FoodRow & { eaten_at: string }>(
    `SELECT f.*, m.eaten_at FROM food_items f JOIN meals m ON m.id = f.meal_id
     WHERE m.eaten_on = ? AND m.deleted_at IS NULL AND f.deleted_at IS NULL
     ORDER BY m.eaten_at DESC, m.id, f.sort_order, f.id`, [mealDateQueryKey(date)],
  );
  return rows.map((row) => ({
    id: row.id, mealId: row.meal_id, name: row.name, quantity: row.quantity, unit: row.unit,
    eatenAt: row.eaten_at, caloriesKcal: row.calories_kcal, proteinG: row.protein_g,
    carbohydrateG: row.carbohydrate_g, fatG: row.fat_g, fibreG: row.fibre_g, source: row.source,
    originalSource: row.original_source ?? row.source,
  }));
}

/** Read, scale and enqueue in one transaction; never rewrite sibling foods. */
export async function changeDailyFoodPortion(db: SQLiteDatabase, itemId: string, quantity: number): Promise<void> {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Enter a portion greater than zero.');
  await withExclusiveTransaction(db, async (tx) => {
    const row = await activeFood(tx, itemId);
    if (!Number.isFinite(row.quantity) || row.quantity <= 0) throw new Error('Open the saved entry to correct its original portion.');
    if (row.quantity === quantity) return;
    const scale = quantity / row.quantity;
    const now = new Date().toISOString();
    const values = [row.calories_kcal, row.protein_g, row.carbohydrate_g, row.fat_g].map((n) => n * scale);
    const fibre = row.fibre_g == null ? null : row.fibre_g * scale;
    if ([...values, fibre ?? 0].some((n) => !Number.isFinite(n) || n < 0)) throw new Error('That portion is too large. Enter a smaller amount.');
    await tx.runAsync(
      `UPDATE food_items SET quantity = ?, calories_kcal = ?, protein_g = ?, carbohydrate_g = ?,
       fat_g = ?, fibre_g = ?, source = 'manual', confidence = NULL, original_source = ?,
       original_confidence = ?, is_user_edited = 1, updated_at = ?, client_updated_at = ? WHERE id = ?`,
      [quantity, ...values, fibre, row.original_source ?? row.source, row.original_confidence ?? row.confidence, now, now, itemId],
    );
    await enqueueUpsert(tx, 'food_items', itemId, {
      ...foodPayload(row), quantity, calories_kcal: values[0], protein_g: values[1],
      carbohydrate_g: values[2], fat_g: values[3], fibre_g: fibre, source: 'manual', confidence: null,
      is_user_edited: true, client_updated_at: now, deleted_at: null,
    });
  });
}

export async function removeDailyFoodItem(db: SQLiteDatabase, itemId: string): Promise<void> {
  await withExclusiveTransaction(db, async (tx) => {
    const row = await activeFood(tx, itemId);
    const now = new Date().toISOString();
    await tx.runAsync('UPDATE food_items SET deleted_at = ?, updated_at = ?, client_updated_at = ? WHERE id = ?', [now, now, now, itemId]);
    await enqueueUpsert(tx, 'food_items', itemId, { ...foodPayload(row), client_updated_at: now, deleted_at: now });
    const remaining = await tx.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM food_items WHERE meal_id = ? AND deleted_at IS NULL', [row.meal_id]);
    if (remaining?.count === 0) {
      // An empty container must not appear as a meal in Calendar or reminders.
      const meal = await tx.getFirstAsync<Record<string, unknown>>(
        'SELECT id, name, type, eaten_on, eaten_at, source, notes, is_user_edited, created_at FROM meals WHERE id = ?', [row.meal_id],
      );
      await tx.runAsync('UPDATE meals SET deleted_at = ?, updated_at = ?, client_updated_at = ? WHERE id = ?', [now, now, now, row.meal_id]);
      await enqueueUpsert(tx, 'meals', row.meal_id, { ...meal, is_user_edited: Boolean(meal?.is_user_edited), client_updated_at: now, deleted_at: now });
    }
  });
}

async function activeFood(db: SQLiteDatabase, id: string): Promise<FoodRow> {
  const row = await db.getFirstAsync<FoodRow>(
    `SELECT f.* FROM food_items f JOIN meals m ON m.id = f.meal_id
     WHERE f.id = ? AND f.deleted_at IS NULL AND m.deleted_at IS NULL`, [id],
  );
  if (!row) throw new Error('This food is no longer in your log. Close this panel and refresh the day.');
  return row;
}

function foodPayload(row: FoodRow) {
  // Explicit remote columns: never spread local-only fields into the sync payload.
  return {
    id: row.id, meal_id: row.meal_id, sort_order: row.sort_order, name: row.name,
    quantity: row.quantity, unit: row.unit, calories_kcal: row.calories_kcal, protein_g: row.protein_g,
    carbohydrate_g: row.carbohydrate_g, fat_g: row.fat_g, fibre_g: row.fibre_g,
    source: row.source, confidence: row.confidence, original_source: row.original_source ?? row.source,
    original_confidence: row.original_confidence ?? row.confidence,
    is_user_edited: Boolean(row.is_user_edited), created_at: row.created_at,
  };
}
