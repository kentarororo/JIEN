import type { SQLiteDatabase } from 'expo-sqlite';

import { withExclusiveTransaction } from './exclusive-transaction';
import { DEFAULT_EXERCISES, REGIONAL_STARTER_FOODS, STARTER_FOODS } from './migrate';

const ACCOUNT_DATA_TABLES_IN_DELETE_ORDER = [
  'meal_photo_jobs',
  'sync_queue',
  'workout_sets',
  'food_items',
  'ai_messages',
  'workouts',
  'meals',
  'nutrition_targets',
  'wellness_logs',
  'ai_conversations',
  'notification_preferences',
  'user_profile',
  'app_settings',
  'exercises',
  'food_catalog_cache',
] as const;

/**
 * Removes one account's device data without dropping or replacing the database.
 * The built-in catalogs are restored in the same transaction so a later sign-in
 * starts from the normal first-run state.
 */
export async function resetLocalAccountData(
  db: SQLiteDatabase,
  now = new Date(),
): Promise<void> {
  const timestamp = now.toISOString();
  await withExclusiveTransaction(db, async (transactionDb) => {
    for (const table of ACCOUNT_DATA_TABLES_IN_DELETE_ORDER) {
      await transactionDb.runAsync(`DELETE FROM "${table}"`);
    }

    for (const exercise of DEFAULT_EXERCISES) {
      await transactionDb.runAsync(
        `INSERT INTO exercises (
          id, name, movement_pattern, primary_muscle_group, secondary_muscle_groups,
          equipment, target_rep_min, target_rep_max, load_increment,
          created_at, updated_at, client_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...exercise, timestamp, timestamp, timestamp],
      );
    }

    for (const food of STARTER_FOODS) {
      await transactionDb.runAsync(
        `INSERT INTO food_catalog_cache (
          id, name, brand, serving_quantity, serving_unit, calories_kcal,
          protein_g, carbohydrate_g, fat_g, fibre_g, source, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'starter', ?)`,
        [...food, timestamp],
      );
    }

    for (const food of REGIONAL_STARTER_FOODS) {
      await transactionDb.runAsync(
        `INSERT INTO food_catalog_cache (
          id, name, serving_quantity, serving_unit, calories_kcal,
          protein_g, carbohydrate_g, fat_g, fibre_g, source, source_ref, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'usda', ?, ?)`,
        [...food, timestamp],
      );
    }
  });
}
