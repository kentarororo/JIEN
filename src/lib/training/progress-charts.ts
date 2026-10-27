import type { ExerciseHistorySession } from '../db/types.ts';
import { isoWeekKey, type WeeklyVolume } from '../progression/index.ts';
import { toLocalDateKey } from '../time.ts';

const POUNDS_TO_KG = 0.45359237;

export const PROGRESS_CHART_RANGES = [12, 26, 52] as const;
export type ProgressChartRange = typeof PROGRESS_CHART_RANGES[number];

export type ExerciseWeeklyTrendPoint = {
  week: string;
  volumeKg: number;
  bestLoadKg: number | null;
  bestReps: number | null;
};

export type MuscleWeeklyTrendPoint = {
  week: string;
  setCredits: number;
  volumeKg: number;
};

export function buildExerciseWeeklyTrend(
  sessions: readonly ExerciseHistorySession[],
  targetRepMin: number,
  targetRepMax: number,
  weekCount: ProgressChartRange,
  endingAt = new Date(),
): ExerciseWeeklyTrendPoint[] {
  const byWeek = new Map<string, ExerciseWeeklyTrendPoint>();
  for (const session of sessions) {
    const week = isoWeekKey(session.performedOn);
    const point = byWeek.get(week) ?? { week, volumeKg: 0, bestLoadKg: null, bestReps: null };
    point.volumeKg += session.volumeKg;
    for (const set of session.sets) {
      if (set.reps < targetRepMin || set.reps > targetRepMax || set.loadValue < 0) continue;
      const loadKg = set.loadUnit === 'lb' ? set.loadValue * POUNDS_TO_KG : set.loadValue;
      if (point.bestLoadKg == null || loadKg > point.bestLoadKg
        || (loadKg === point.bestLoadKg && set.reps > (point.bestReps ?? 0))) {
        point.bestLoadKg = loadKg;
        point.bestReps = set.reps;
      }
    }
    byWeek.set(week, point);
  }
  return denseWeekKeys(weekCount, endingAt).map((week) => {
    const point = byWeek.get(week);
    return point ? { ...point, volumeKg: round(point.volumeKg), bestLoadKg: point.bestLoadKg == null ? null : round(point.bestLoadKg) }
      : { week, volumeKg: 0, bestLoadKg: null, bestReps: null };
  });
}

export function buildMuscleWeeklyTrend(
  weeks: readonly WeeklyVolume[],
  muscleGroup: string,
  weekCount: ProgressChartRange,
  endingAt = new Date(),
): MuscleWeeklyTrendPoint[] {
  const byWeek = new Map(weeks.map((week) => [week.week, week]));
  return denseWeekKeys(weekCount, endingAt).map((week) => ({
    week,
    setCredits: round(byWeek.get(week)?.muscleGroupSets[muscleGroup] ?? 0),
    volumeKg: round(byWeek.get(week)?.muscleGroups[muscleGroup] ?? 0),
  }));
}

export function progressChartMuscles(
  weeks: readonly WeeklyVolume[],
  programmeMuscles: readonly string[] = [],
): string[] {
  const groups = new Set(programmeMuscles);
  for (const week of weeks) {
    Object.keys(week.muscleGroupSets).forEach((group) => groups.add(group));
    Object.keys(week.muscleGroups).forEach((group) => groups.add(group));
  }
  return [...groups].sort();
}

function denseWeekKeys(count: number, endingAt: Date): string[] {
  const monday = new Date(endingAt.getFullYear(), endingAt.getMonth(), endingAt.getDate(), 12);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() - (count - index - 1) * 7);
    return isoWeekKey(toLocalDateKey(date));
  });
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
