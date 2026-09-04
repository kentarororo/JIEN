import type { PlannedWorkoutExercise, SessionApproach } from '../db/types.ts';

export const SESSION_APPROACHES: ReadonlyArray<{
  id: SessionApproach;
  title: string;
  body: string;
}> = [
  {
    id: 'progress',
    title: 'Progress',
    body: 'Keep the completed values as targets and show the existing rep or load cues.',
  },
  {
    id: 'repeat',
    title: 'Repeat',
    body: 'Keep the same exercises, sets, loads and reps without an increase cue.',
  },
  {
    id: 'ease_off',
    title: 'Ease off',
    body: 'Keep the same exercises, loads and reps, with one fewer working set where possible.',
  },
];

export function isSessionApproach(value: unknown): value is SessionApproach {
  return value === 'progress' || value === 'repeat' || value === 'ease_off';
}

export function sessionApproachTitle(value: SessionApproach): string {
  return SESSION_APPROACHES.find((item) => item.id === value)?.title ?? 'Workout plan';
}

export function sessionApproachBody(value: SessionApproach): string {
  return SESSION_APPROACHES.find((item) => item.id === value)?.body ?? '';
}

/**
 * Applies an explicit post-session choice to a derived plan. Completed workout
 * values are never changed. The returned object is a new plan snapshot.
 */
export function applySessionApproach(
  exercise: PlannedWorkoutExercise,
  approach: SessionApproach,
): PlannedWorkoutExercise {
  const removedWorkingSet = approach === 'ease_off' && exercise.sets.length > 1;
  const sets = removedWorkingSet
    ? exercise.sets.slice(0, -1)
    : [...exercise.sets];
  const result = applySessionApproachProgression({ ...exercise, sets }, approach);
  if (approach !== 'ease_off') return result;
  return {
    ...result,
    progression: {
      ...result.progression,
      reason: removedWorkingSet
        ? 'One working set was removed. Load and reps are unchanged.'
        : 'This exercise has one working set. Load and reps are unchanged.',
    },
  };
}

/** Reapplies only the cue policy after joint-consideration recalculation. */
export function applySessionApproachProgression(
  exercise: PlannedWorkoutExercise,
  approach: SessionApproach,
): PlannedWorkoutExercise {
  if (approach === 'progress') return exercise;
  if (approach === 'repeat') {
    return {
      ...exercise,
      progression: {
        action: 'hold',
        reason: 'Repeat the completed load and reps. No increase is suggested.',
        cues: [],
      },
    };
  }
  return {
    ...exercise,
    progression: {
      action: 'hold',
      reason: exercise.progression.action === 'hold' && /working set|one working set/i.test(exercise.progression.reason)
        ? exercise.progression.reason
        : 'Ease-off plan selected. Load and reps are unchanged.',
      cues: [],
    },
  };
}
