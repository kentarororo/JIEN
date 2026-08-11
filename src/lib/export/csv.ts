import type { NutritionExportRow, WorkoutExportRow } from '@/lib/db';

function escapeCsv(value: unknown): string {
  const normalized = value == null ? '' : String(value);
  return /[",\r\n]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
}

function rowsToCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n');
}

export function workoutsToCsv(rows: WorkoutExportRow[]): string {
  return rowsToCsv(
    [
      'workout_id',
      'date',
      'workout',
      'exercise',
      'muscle_group',
      'set',
      'kind',
      'reps',
      'load',
      'unit',
      'rpe',
      'volume_kg',
    ],
    rows.map((row) => [
      row.workoutId,
      row.performedOn,
      row.workoutTitle,
      row.exercise,
      row.muscleGroup,
      row.setNumber,
      row.kind,
      row.reps,
      row.load,
      row.unit,
      row.rpe,
      row.volumeKg.toFixed(2),
    ]),
  );
}

export function nutritionToCsv(rows: NutritionExportRow[]): string {
  return rowsToCsv(
    [
      'meal_id',
      'date',
      'eaten_at',
      'meal',
      'meal_type',
      'food',
      'quantity',
      'unit',
      'calories_kcal',
      'protein_g',
      'carbohydrate_g',
      'fat_g',
      'fibre_g',
    ],
    rows.map((row) => [
      row.mealId,
      row.eatenOn,
      row.eatenAt,
      row.mealName,
      row.mealType,
      row.food,
      row.quantity,
      row.unit,
      row.caloriesKcal,
      row.proteinG,
      row.carbohydrateG,
      row.fatG,
      row.fibreG,
    ]),
  );
}
