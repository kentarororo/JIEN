type WorkoutContextRow = { id: string; performed_on: string };
type SetContextRow = {
  workout_id: string;
  exercise_id: string;
  reps: number | string;
  load_value: number | string;
  load_unit: string;
  kind: string;
};
type ExerciseContextRow = {
  id: string;
  primary_muscle_group: string;
  secondary_muscle_groups: unknown;
};

type MuscleTotals = { weightedSets: number; workKg: number };

export function summarizeTrainingMuscleContext(
  workouts: WorkoutContextRow[],
  sets: SetContextRow[],
  exercises: ExerciseContextRow[],
  asOf = new Date(),
) {
  const workoutDates = new Map(workouts.map((workout) => [workout.id, workout.performed_on]));
  const exerciseTags = new Map(exercises.map((exercise) => [exercise.id, {
    primary: normalizeMuscleGroup(exercise.primary_muscle_group),
    secondary: parseSecondaryGroups(exercise.secondary_muscle_groups),
  }]));
  const weekMap = new Map<string, { totalWorkingSets: number; totalWorkKg: number; groups: Map<string, MuscleTotals> }>();

  for (const set of sets) {
    if (set.kind !== 'working') continue;
    const performedOn = workoutDates.get(set.workout_id);
    const tags = exerciseTags.get(set.exercise_id);
    if (!performedOn || !tags) continue;
    const reps = Number(set.reps);
    const load = Number(set.load_value);
    if (!Number.isFinite(reps) || reps <= 0 || !Number.isFinite(load) || load < 0) continue;
    const workKg = load * reps * (set.load_unit === 'lb' ? 0.45359237 : 1);
    const weekKey = isoWeekKey(performedOn);
    const week = weekMap.get(weekKey) ?? { totalWorkingSets: 0, totalWorkKg: 0, groups: new Map() };
    week.totalWorkingSets += 1;
    week.totalWorkKg += workKg;
    addMuscleWork(week.groups, tags.primary, 1, workKg);
    for (const secondary of tags.secondary) {
      if (secondary !== tags.primary) addMuscleWork(week.groups, secondary, 0.5, workKg * 0.5);
    }
    weekMap.set(weekKey, week);
  }

  const weeks = [...weekMap.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-4).map(([week, totals]) => ({
    week,
    totalWorkingSets: totals.totalWorkingSets,
    totalWorkKg: round(totals.totalWorkKg),
    muscleGroups: [...totals.groups.entries()]
      .map(([muscleGroup, value]) => ({ muscleGroup, weightedSets: value.weightedSets, workKg: round(value.workKg) }))
      .sort((a, b) => b.weightedSets - a.weightedSets || a.muscleGroup.localeCompare(b.muscleGroup)),
  }));
  const latest = weeks.at(-1) ?? null;
  const previous = weeks.at(-2) ?? null;
  const latestIsPartialWeek = latest?.week === isoWeekKey(asOf.toISOString().slice(0, 10));
  const groups = new Set([
    ...(latest?.muscleGroups.map((group) => group.muscleGroup) ?? []),
    ...(previous?.muscleGroups.map((group) => group.muscleGroup) ?? []),
  ]);
  const latestVsPrevious = [...groups].map((muscleGroup) => {
    const current = latest?.muscleGroups.find((group) => group.muscleGroup === muscleGroup);
    const prior = previous?.muscleGroups.find((group) => group.muscleGroup === muscleGroup);
    const changePercent = prior && prior.workKg > 0 && current
      ? round(((current.workKg - prior.workKg) / prior.workKg) * 100)
      : null;
    return {
      muscleGroup,
      currentWeightedSets: current?.weightedSets ?? 0,
      previousWeightedSets: prior?.weightedSets ?? 0,
      workChangePercent: changePercent,
      status: !current || current.weightedSets <= 0
        ? latestIsPartialWeek && (prior?.weightedSets ?? 0) > 0 ? 'partial' : 'inactive'
        : !prior || prior.weightedSets <= 0
          ? 'new'
          : latestIsPartialWeek && (changePercent == null || changePercent < 2)
            ? 'partial'
          : changePercent != null && changePercent <= -20
            ? 'down'
            : changePercent != null && changePercent >= 2
              ? 'up'
              : 'steady',
    };
  }).sort((a, b) => b.currentWeightedSets - a.currentWeightedSets || a.muscleGroup.localeCompare(b.muscleGroup));

  return { weeks, latestIsPartialWeek, latestVsPrevious };
}

function addMuscleWork(groups: Map<string, MuscleTotals>, muscleGroup: string, weightedSets: number, workKg: number) {
  const current = groups.get(muscleGroup) ?? { weightedSets: 0, workKg: 0 };
  current.weightedSets += weightedSets;
  current.workKg += workKg;
  groups.set(muscleGroup, current);
}

function parseSecondaryGroups(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values.filter((item): item is string => typeof item === 'string').map(normalizeMuscleGroup))];
}

function normalizeMuscleGroup(value: string): string {
  const clean = value.trim().toLocaleLowerCase().replaceAll(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (clean === 'quadriceps') return 'quads';
  if (clean === 'shoulders') return 'front_delts';
  return clean || 'other';
}

function isoWeekKey(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00.000Z`);
  const utc = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
