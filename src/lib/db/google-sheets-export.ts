import type { SQLiteDatabase } from 'expo-sqlite';

import { listWorkoutExportRows } from './workouts';
import type { WorkoutExportRow } from './types';

export type GoogleSheetsNutritionExportRow = {
  date: string;
  dayState: 'partial' | 'complete';
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  bodyWeightKg: number | null;
};

export type GoogleSheetsExportData = {
  workouts: WorkoutExportRow[];
  nutrition: GoogleSheetsNutritionExportRow[];
};

export async function getGoogleSheetsExportData(db: SQLiteDatabase): Promise<GoogleSheetsExportData> {
  const [workouts, nutritionRows] = await Promise.all([
    listWorkoutExportRows(db),
    db.getAllAsync<{
      logged_on: string;
      day_state: 'partial' | 'complete';
      calories_kcal: number;
      protein_g: number;
      carbohydrate_g: number;
      fat_g: number;
      body_weight_kg: number | null;
    }>(
      `WITH export_dates AS (
         SELECT eaten_on AS logged_on FROM meals WHERE deleted_at IS NULL
         UNION
         SELECT logged_on FROM nutrition_day_states WHERE deleted_at IS NULL
         UNION
         SELECT logged_on FROM wellness_logs
          WHERE deleted_at IS NULL AND kind = 'body_measurement' AND body_weight_kg IS NOT NULL
       ), nutrition_totals AS (
         SELECT m.eaten_on AS logged_on,
           SUM(f.calories_kcal) AS calories_kcal,
           SUM(f.protein_g) AS protein_g,
           SUM(f.carbohydrate_g) AS carbohydrate_g,
           SUM(f.fat_g) AS fat_g
         FROM meals m
         JOIN food_items f ON f.meal_id = m.id AND f.deleted_at IS NULL
         WHERE m.deleted_at IS NULL
         GROUP BY m.eaten_on
       )
       SELECT d.logged_on,
         CASE WHEN s.state = 'complete' THEN 'complete' ELSE 'partial' END AS day_state,
         COALESCE(t.calories_kcal, 0) AS calories_kcal,
         COALESCE(t.protein_g, 0) AS protein_g,
         COALESCE(t.carbohydrate_g, 0) AS carbohydrate_g,
         COALESCE(t.fat_g, 0) AS fat_g,
         (SELECT w.body_weight_kg
            FROM wellness_logs w
           WHERE w.deleted_at IS NULL
             AND w.kind = 'body_measurement'
             AND w.body_weight_kg IS NOT NULL
             AND w.logged_on = d.logged_on
           ORDER BY w.logged_at DESC, w.id DESC
           LIMIT 1) AS body_weight_kg
       FROM export_dates d
       LEFT JOIN nutrition_totals t ON t.logged_on = d.logged_on
       LEFT JOIN nutrition_day_states s ON s.logged_on = d.logged_on AND s.deleted_at IS NULL
       ORDER BY d.logged_on ASC`,
    ),
  ]);

  return {
    workouts,
    nutrition: nutritionRows.map((row) => ({
      date: row.logged_on,
      dayState: row.day_state,
      caloriesKcal: row.calories_kcal,
      proteinG: row.protein_g,
      carbohydrateG: row.carbohydrate_g,
      fatG: row.fat_g,
      bodyWeightKg: row.body_weight_kg,
    })),
  };
}
