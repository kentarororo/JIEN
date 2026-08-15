import type { SQLiteDatabase } from 'expo-sqlite';

import { startOfIsoWeek, toLocalDateKey } from '@/lib/time';

import { getDailyNutrition } from './nutrition';
import { getLatestBodyMeasurement } from './wellness';
import { getWorkoutProgressComparison } from './workouts';
import type { DashboardSummary, WorkoutStatus, WorkoutSummary } from './types';

export async function getDashboardSummary(db: SQLiteDatabase): Promise<DashboardSummary> {
  const weekStart = toLocalDateKey(startOfIsoWeek());
  const workoutRow = await db.getFirstAsync<{
    workout_count: number;
    volume_kg: number | null;
  }>(
    `SELECT COUNT(DISTINCT w.id) AS workout_count,
      COALESCE(SUM(CASE
        WHEN s.kind = 'working' AND s.load_unit = 'lb' THEN s.load_value * 0.45359237 * s.reps
        WHEN s.kind = 'working' THEN s.load_value * s.reps
        ELSE 0 END), 0) AS volume_kg
     FROM workouts w
     LEFT JOIN workout_sets s ON s.workout_id = w.id AND s.deleted_at IS NULL
     WHERE w.performed_on >= ? AND w.status = 'completed' AND w.deleted_at IS NULL`,
    [weekStart],
  );
  const latest = await db.getFirstAsync<{
    id: string;
    title: string;
    performed_on: string;
    started_at: string | null;
    completed_at: string | null;
    status: WorkoutStatus;
    set_count: number;
    exercise_count: number;
    total_volume_kg: number;
  }>(
    `SELECT w.id, w.title, w.performed_on, w.started_at, w.completed_at, w.status,
      COUNT(s.id) AS set_count, COUNT(DISTINCT s.exercise_id) AS exercise_count,
      COALESCE(SUM(CASE WHEN s.load_unit = 'lb' THEN s.load_value * 0.45359237 * s.reps
        ELSE s.load_value * s.reps END), 0) AS total_volume_kg
     FROM workouts w
     LEFT JOIN workout_sets s ON s.workout_id = w.id AND s.deleted_at IS NULL
     WHERE w.status = 'completed' AND w.deleted_at IS NULL
     GROUP BY w.id
     ORDER BY w.performed_on DESC, w.started_at DESC
     LIMIT 1`,
  );
  const latestWorkout: WorkoutSummary | null = latest
    ? {
        id: latest.id,
        title: latest.title,
        performedOn: latest.performed_on,
        startedAt: latest.started_at,
        completedAt: latest.completed_at,
        status: latest.status,
        setCount: latest.set_count,
        exerciseCount: latest.exercise_count,
        totalVolumeKg: latest.total_volume_kg,
        scheduledAt: null,
      }
    : null;

  return {
    workoutCountThisWeek: workoutRow?.workout_count ?? 0,
    weeklyVolumeKg: workoutRow?.volume_kg ?? 0,
    latestWorkout,
    workoutProgress: await getWorkoutProgressComparison(db, latestWorkout?.id),
    latestBodyMeasurement: await getLatestBodyMeasurement(db),
    nutrition: await getDailyNutrition(db),
  };
}
