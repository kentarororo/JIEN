import type { SQLiteDatabase } from 'expo-sqlite';

import type { CalendarDayActivity } from './types';

const emptyDay = (date: string): CalendarDayActivity => ({
  date,
  workoutCount: 0,
  plannedWorkoutCount: 0,
  workingSetCount: 0,
  trainingWorkKg: 0,
  mealCount: 0,
  caloriesKcal: 0,
  proteinG: 0,
  bodyMeasurementCount: 0,
  sleepLogCount: 0,
  sleepDurationMinutes: 0,
});

export async function listCalendarActivity(
  db: SQLiteDatabase,
  startDate: string,
  endDate: string,
): Promise<CalendarDayActivity[]> {
  const [workouts, bodyMeasurements, sleepLogs, meals] = await Promise.all([
    db.getAllAsync<{
      date: string;
      workout_count: number;
      planned_workout_count: number;
      working_set_count: number;
      training_work_kg: number | null;
    }>(
      `SELECT w.performed_on AS date,
        COUNT(DISTINCT CASE WHEN w.status = 'completed' THEN w.id END) AS workout_count,
        COUNT(DISTINCT CASE WHEN w.status = 'planned' THEN w.id END) AS planned_workout_count,
        COUNT(CASE WHEN w.status = 'completed' AND s.kind = 'working' THEN 1 END) AS working_set_count,
        COALESCE(SUM(CASE
          WHEN w.status = 'completed' AND s.kind = 'working' AND s.load_unit = 'lb' THEN s.load_value * 0.45359237 * s.reps
          WHEN w.status = 'completed' AND s.kind = 'working' THEN s.load_value * s.reps
          ELSE 0 END), 0) AS training_work_kg
       FROM workouts w
       LEFT JOIN workout_sets s ON s.workout_id = w.id AND s.deleted_at IS NULL
       WHERE w.performed_on BETWEEN ? AND ?
         AND w.status IN ('completed', 'planned')
         AND w.deleted_at IS NULL
       GROUP BY w.performed_on`,
      [startDate, endDate],
    ),
    db.getAllAsync<{ date: string; measurement_count: number }>(
      `SELECT logged_on AS date, COUNT(*) AS measurement_count
       FROM wellness_logs
       WHERE kind = 'body_measurement' AND logged_on BETWEEN ? AND ? AND deleted_at IS NULL
       GROUP BY logged_on`,
      [startDate, endDate],
    ),
    db.getAllAsync<{ date: string; sleep_count: number; sleep_minutes: number | null }>(
      `SELECT logged_on AS date, COUNT(*) AS sleep_count,
        COALESCE(SUM(sleep_duration_minutes), 0) AS sleep_minutes
       FROM wellness_logs
       WHERE kind = 'sleep' AND logged_on BETWEEN ? AND ? AND deleted_at IS NULL
       GROUP BY logged_on`,
      [startDate, endDate],
    ),
    db.getAllAsync<{
      date: string;
      meal_count: number;
      calories_kcal: number | null;
      protein_g: number | null;
    }>(
      `SELECT m.eaten_on AS date,
        COUNT(DISTINCT m.id) AS meal_count,
        COALESCE(SUM(f.calories_kcal), 0) AS calories_kcal,
        COALESCE(SUM(f.protein_g), 0) AS protein_g
       FROM meals m
       LEFT JOIN food_items f ON f.meal_id = m.id AND f.deleted_at IS NULL
       WHERE m.eaten_on BETWEEN ? AND ? AND m.deleted_at IS NULL
       GROUP BY m.eaten_on`,
      [startDate, endDate],
    ),
  ]);

  const byDate = new Map<string, CalendarDayActivity>();
  for (const row of workouts) {
    byDate.set(row.date, {
      ...emptyDay(row.date),
      workoutCount: row.workout_count,
      plannedWorkoutCount: row.planned_workout_count,
      workingSetCount: row.working_set_count,
      trainingWorkKg: row.training_work_kg ?? 0,
    });
  }
  for (const row of meals) {
    const current = byDate.get(row.date) ?? emptyDay(row.date);
    byDate.set(row.date, {
      ...current,
      mealCount: row.meal_count,
      caloriesKcal: row.calories_kcal ?? 0,
      proteinG: row.protein_g ?? 0,
    });
  }
  for (const row of bodyMeasurements) {
    const current = byDate.get(row.date) ?? emptyDay(row.date);
    byDate.set(row.date, { ...current, bodyMeasurementCount: row.measurement_count });
  }
  for (const row of sleepLogs) {
    const current = byDate.get(row.date) ?? emptyDay(row.date);
    byDate.set(row.date, {
      ...current,
      sleepLogCount: row.sleep_count,
      sleepDurationMinutes: row.sleep_minutes ?? 0,
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
