import type { PlannedWorkoutExercise, WorkoutTimeBudget } from '../db/types.ts';

/** Editable scheduling assumptions, not measured pace or prescribed rest. */
export const DEFAULT_TIME_BUDGET: WorkoutTimeBudget = {
  version: 1, availableMinutes: 60, warmUpMinutes: 5,
  secondsPerSet: 45, restSeconds: 120, transitionSeconds: 120,
};

export type TimeEstimateFields = Record<'warmUpMinutes' | 'secondsPerSet' | 'restSeconds' | 'transitionSeconds', string>;

export function timeEstimateFields(budget: WorkoutTimeBudget): TimeEstimateFields {
  return { warmUpMinutes: String(budget.warmUpMinutes), secondsPerSet: String(budget.secondsPerSet),
    restSeconds: String(budget.restSeconds), transitionSeconds: String(budget.transitionSeconds) };
}

export function parseTimeEstimateFields(fields: TimeEstimateFields, availableMinutes: WorkoutTimeBudget['availableMinutes']) {
  if (Object.values(fields).some((value) => !/^\d+$/.test(value.trim()))) return null;
  return parseWorkoutTimeBudget({ version: 1, availableMinutes,
    ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Number(value)])) });
}

export function parseWorkoutTimeBudget(value: unknown): WorkoutTimeBudget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const integer = (key: string, min: number, max: number) =>
    typeof v[key] === 'number' && Number.isInteger(v[key]) && v[key] >= min && v[key] <= max;
  if (v.version !== 1 || ![30, 45, 60, 90].includes(v.availableMinutes as number)
    || !integer('warmUpMinutes', 0, 30) || !integer('secondsPerSet', 10, 300)
    || !integer('restSeconds', 0, 600) || !integer('transitionSeconds', 0, 600)) return null;
  return {
    version: 1, availableMinutes: v.availableMinutes as WorkoutTimeBudget['availableMinutes'],
    warmUpMinutes: v.warmUpMinutes as number, secondsPerSet: v.secondsPerSet as number,
    restSeconds: v.restSeconds as number, transitionSeconds: v.transitionSeconds as number,
  };
}

export function estimateSessionTime(exercises: Pick<PlannedWorkoutExercise, 'sets'>[], budget: WorkoutTimeBudget) {
  if (!parseWorkoutTimeBudget(budget)) throw new Error('Check the time estimate settings.');
  const active = exercises.filter((exercise) => exercise.sets.length > 0);
  const setCount = active.reduce((total, exercise) => total + exercise.sets.length, 0);
  const workSeconds = setCount * budget.secondsPerSet;
  const restSeconds = (setCount - active.length) * budget.restSeconds;
  // Between-exercise time includes moving, setup and recovery; no extra rest is double-counted.
  const transitionSeconds = Math.max(0, active.length - 1) * budget.transitionSeconds;
  const warmUpSeconds = active.length ? budget.warmUpMinutes * 60 : 0;
  const totalSeconds = workSeconds + restSeconds + transitionSeconds + warmUpSeconds;
  return {
    setCount, workSeconds, restSeconds, transitionSeconds, warmUpSeconds, totalSeconds,
    totalMinutes: Math.ceil(totalSeconds / 60),
    overByMinutes: Math.ceil(Math.max(0, totalSeconds - budget.availableMinutes * 60) / 60),
  };
}

/** Preview only. Keep order and complete exercises; never change loads, reps or rest to force a fit. */
export function previewShorterSession(exercises: PlannedWorkoutExercise[], budget: WorkoutTimeBudget) {
  let count = exercises.length;
  while (count > 0 && estimateSessionTime(exercises.slice(0, count), budget).overByMinutes > 0) count -= 1;
  return { kept: exercises.slice(0, count), removed: exercises.slice(count) };
}
