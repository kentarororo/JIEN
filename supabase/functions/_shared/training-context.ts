type WorkoutContextRow = { id: string; performed_on: string };
type SetContextRow = {
  workout_id: string;
  exercise_id: string;
  reps: number | string;
  load_value: number | string;
  load_unit: string;
  kind: string;
  primary_muscle_group?: string | null;
  secondary_muscle_groups?: unknown;
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
  const familyWeekCredits = new Map<string, Map<string, number>>();
  const familyLastTrainedAt = new Map<string, string>();

  for (const set of sets) {
    if (set.kind !== 'working') continue;
    const performedOn = workoutDates.get(set.workout_id);
    const exerciseTag = exerciseTags.get(set.exercise_id);
    const tags = set.primary_muscle_group
      ? {
          primary: normalizeMuscleGroup(set.primary_muscle_group),
          secondary: parseSecondaryGroups(set.secondary_muscle_groups),
        }
      : exerciseTag;
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

    const familyCredits = familyWeekCredits.get(weekKey) ?? new Map<string, number>();
    const primaryFamily = muscleGroupFamily(tags.primary);
    const secondaryFamilies = [...new Set(tags.secondary.map(muscleGroupFamily))]
      .filter((group) => group !== primaryFamily);
    addCredit(familyCredits, primaryFamily, 1);
    for (const group of secondaryFamilies) addCredit(familyCredits, group, 0.5);
    familyWeekCredits.set(weekKey, familyCredits);
    for (const group of [primaryFamily, ...secondaryFamilies]) {
      const previous = familyLastTrainedAt.get(group);
      if (!previous || performedOn > previous) familyLastTrainedAt.set(group, performedOn);
    }
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
    const setChangePercent = prior && prior.weightedSets > 0 && current
      ? round(((current.weightedSets - prior.weightedSets) / prior.weightedSets) * 100)
      : null;
    const workChangePercent = prior && prior.workKg > 0 && current
      ? round(((current.workKg - prior.workKg) / prior.workKg) * 100)
      : null;
    return {
      muscleGroup,
      currentWeightedSets: current?.weightedSets ?? 0,
      previousWeightedSets: prior?.weightedSets ?? 0,
      setChangePercent,
      workChangePercent,
      status: !current || current.weightedSets <= 0
        ? latestIsPartialWeek && (prior?.weightedSets ?? 0) > 0 ? 'partial' : 'inactive'
        : !prior || prior.weightedSets <= 0
          ? 'new'
          : latestIsPartialWeek && current.weightedSets < prior.weightedSets
            ? 'partial'
          : setChangePercent != null && setChangePercent <= -20
            ? 'down'
            : setChangePercent != null && setChangePercent >= 2
              ? 'up'
              : 'steady',
    };
  }).sort((a, b) => b.currentWeightedSets - a.currentWeightedSets || a.muscleGroup.localeCompare(b.muscleGroup));

  const currentWeek = isoWeekKey(asOf.toISOString().slice(0, 10));
  const priorWeeks = previousIsoWeeks(asOf, 4);
  const earliestWeek = familyWeekCredits.size ? [...familyWeekCredits.keys()].sort()[0] ?? null : null;
  const baselineWeeks = earliestWeek == null ? [] : priorWeeks.filter((week) => week >= earliestWeek);
  const advisoryGroups = new Set<string>();
  for (const week of [currentWeek, ...baselineWeeks]) {
    familyWeekCredits.get(week)?.forEach((_value, group) => advisoryGroups.add(group));
  }
  const coverage = [...advisoryGroups].map((muscleGroup) => {
    const currentSetCredits = familyWeekCredits.get(currentWeek)?.get(muscleGroup) ?? 0;
    const baselineSetCredits = baselineWeeks.length
      ? baselineWeeks.reduce((sum, week) => sum + (familyWeekCredits.get(week)?.get(muscleGroup) ?? 0), 0) / baselineWeeks.length
      : 0;
    const lastTrainedAt = familyLastTrainedAt.get(muscleGroup) ?? null;
    const lastMs = lastTrainedAt ? new Date(`${lastTrainedAt.slice(0, 10)}T12:00:00.000Z`).getTime() : Number.NaN;
    return {
      muscleGroup,
      currentSetCredits: round(currentSetCredits),
      baselineSetCredits: round(baselineSetCredits),
      remainingSetCredits: round(Math.max(0, baselineSetCredits - currentSetCredits)),
      lastTrainedAt,
      trainedWithin48Hours: Number.isFinite(lastMs)
        && asOf.getTime() >= lastMs
        && asOf.getTime() - lastMs < 48 * 60 * 60 * 1_000,
    };
  }).filter((item) => item.baselineSetCredits > 0 || item.currentSetCredits > 0)
    .sort((a, b) => b.remainingSetCredits - a.remainingSetCredits
      || b.baselineSetCredits - a.baselineSetCredits
      || a.muscleGroup.localeCompare(b.muscleGroup));
  const gaps = coverage.filter((item) => item.remainingSetCredits >= 0.5);
  const readyGaps = gaps.filter((item) => !item.trainedWithin48Hours);
  const advisory = baselineWeeks.length === 0 || coverage.every((item) => item.baselineSetCredits === 0)
    ? { status: 'baseline', currentWeek, baselineWeekCount: baselineWeeks.length, focus: [], coverage }
    : readyGaps.length
      ? { status: 'focus', currentWeek, baselineWeekCount: baselineWeeks.length, focus: readyGaps.slice(0, 3), coverage }
      : gaps.length
        ? { status: 'recovery', currentWeek, baselineWeekCount: baselineWeeks.length, focus: gaps.slice(0, 3), coverage }
        : { status: 'covered', currentWeek, baselineWeekCount: baselineWeeks.length, focus: [], coverage };

  return { weeks, latestIsPartialWeek, latestVsPrevious, advisory };
}

function addMuscleWork(groups: Map<string, MuscleTotals>, muscleGroup: string, weightedSets: number, workKg: number) {
  const current = groups.get(muscleGroup) ?? { weightedSets: 0, workKg: 0 };
  current.weightedSets += weightedSets;
  current.workKg += workKg;
  groups.set(muscleGroup, current);
}

function addCredit(groups: Map<string, number>, muscleGroup: string, value: number) {
  groups.set(muscleGroup, (groups.get(muscleGroup) ?? 0) + value);
}

function muscleGroupFamily(value: string): string {
  const normalized = normalizeMuscleGroup(value);
  if (normalized === 'upper_chest') return 'chest';
  if (['middle_traps', 'lower_traps', 'rhomboids'].includes(normalized)) return 'upper_back';
  if (['abs', 'obliques'].includes(normalized)) return 'core';
  if (normalized === 'brachialis') return 'biceps';
  return normalized;
}

function previousIsoWeeks(asOf: Date, count: number): string[] {
  const cursor = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
  const day = cursor.getUTCDay() || 7;
  cursor.setUTCDate(cursor.getUTCDate() - day + 1);
  const weeks: string[] = [];
  for (let offset = count; offset >= 1; offset -= 1) {
    const week = new Date(cursor);
    week.setUTCDate(week.getUTCDate() - offset * 7);
    weeks.push(isoWeekKey(week.toISOString()));
  }
  return weeks;
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
