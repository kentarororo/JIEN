import { calculateOverloadChangePercent, muscleGroupLabel, normalizeMuscleGroupKey } from '../progression/index.ts';

export type WorkoutHistoryRecord = {
  id: string;
  title: string;
  performedOn: string;
  exerciseNames: string[];
  muscleGroups: string[];
};

export type ExerciseHistoryVolumeSession = {
  workoutId: string;
  volumeKg: number;
};

export function filterWorkoutHistory<T extends WorkoutHistoryRecord>(
  workouts: T[],
  query: string,
  muscleGroup: string | null,
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const normalizedMuscle = muscleGroup ? normalizeMuscleGroupKey(muscleGroup) : null;
  return workouts.filter((workout) => {
    if (normalizedMuscle && !workout.muscleGroups.some((group) => normalizeMuscleGroupKey(group) === normalizedMuscle)) return false;
    if (!normalizedQuery) return true;
    const searchText = [
      workout.title,
      ...workout.exerciseNames,
      ...workout.muscleGroups.map(muscleGroupLabel),
    ].join(' ').toLocaleLowerCase();
    return searchText.includes(normalizedQuery);
  });
}

export function groupWorkoutHistoryByMonth<T extends WorkoutHistoryRecord>(workouts: T[]): Array<{ month: string; workouts: T[] }> {
  const groups = new Map<string, T[]>();
  for (const workout of workouts) {
    const month = workout.performedOn.slice(0, 7);
    groups.set(month, [...(groups.get(month) ?? []), workout]);
  }
  return [...groups.entries()].map(([month, entries]) => ({ month, workouts: entries }));
}

export function summarizeExerciseHistory<T extends ExerciseHistoryVolumeSession>(sessions: T[]): {
  latest: T | null;
  previous: T | null;
  changePercent: number | null;
  maximumVolumeKg: number;
  chronological: T[];
} {
  const latest = sessions[0] ?? null;
  const previous = sessions[1] ?? null;
  return {
    latest,
    previous,
    changePercent: latest && previous
      ? calculateOverloadChangePercent(latest.volumeKg, previous.volumeKg)
      : null,
    maximumVolumeKg: Math.max(1, ...sessions.map((session) => session.volumeKg)),
    chronological: sessions.slice().reverse(),
  };
}
