import type { Exercise } from '../db/types.ts';
import {
  muscleGroupFamilyKey,
  muscleGroupFamilyLabel,
  type MuscleGroupCoverage,
} from '../progression/index.ts';
import { exerciseEquipmentFamily, type ExerciseEquipmentFilter } from '../training/exercise-catalog.ts';

export type RoutineStarterId = 'push' | 'pull' | 'legs' | 'upper' | 'lower' | 'full_body';

export type RoutineStarter = {
  id: RoutineStarterId;
  label: string;
  sessionTitle: string;
  slots: ReadonlyArray<ReadonlyArray<string>>;
};

export type PlannedMuscleCredit = {
  muscleGroup: string;
  label: string;
  setCredits: number;
};

export type RoutineStarterRecommendation = {
  starter: RoutineStarter;
  score: number;
  matchedFocus: MuscleGroupCoverage[];
  exercises: Exercise[];
  reason: string;
};

const exerciseId = (suffix: number) => `10000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

const SLOTS = {
  horizontalPress: [exerciseId(59), exerciseId(43), exerciseId(1), exerciseId(47)],
  inclinePress: [exerciseId(60), exerciseId(77), exerciseId(17)],
  verticalPress: [exerciseId(62), exerciseId(79), exerciseId(4), exerciseId(76)],
  lateralRaise: [exerciseId(81), exerciseId(5), exerciseId(24)],
  triceps: [exerciseId(72), exerciseId(90), exerciseId(13), exerciseId(39), exerciseId(124)],
  verticalPull: [exerciseId(121), exerciseId(2), exerciseId(48)],
  horizontalPull: [exerciseId(63), exerciseId(44), exerciseId(3), exerciseId(20), exerciseId(123)],
  rearDelts: [exerciseId(83), exerciseId(25), exerciseId(6), exerciseId(52)],
  biceps: [exerciseId(70), exerciseId(86), exerciseId(12), exerciseId(36)],
  squat: [exerciseId(57), exerciseId(45), exerciseId(7), exerciseId(130), exerciseId(125)],
  hinge: [exerciseId(67), exerciseId(46), exerciseId(9), exerciseId(31), exerciseId(129), exerciseId(42)],
  unilateralLegs: [exerciseId(92), exerciseId(119), exerciseId(125)],
  legCurl: [exerciseId(8), exerciseId(113), exerciseId(131)],
  calves: [exerciseId(98), exerciseId(14), exerciseId(35)],
} as const;

export const ROUTINE_STARTERS: readonly RoutineStarter[] = [
  { id: 'push', label: 'Push', sessionTitle: 'Push session', slots: [SLOTS.horizontalPress, SLOTS.inclinePress, SLOTS.verticalPress, SLOTS.lateralRaise, SLOTS.triceps] },
  { id: 'pull', label: 'Pull', sessionTitle: 'Pull session', slots: [SLOTS.verticalPull, SLOTS.horizontalPull, SLOTS.rearDelts, SLOTS.biceps] },
  { id: 'legs', label: 'Legs', sessionTitle: 'Leg session', slots: [SLOTS.squat, SLOTS.hinge, SLOTS.unilateralLegs, SLOTS.legCurl, SLOTS.calves] },
  { id: 'upper', label: 'Upper', sessionTitle: 'Upper-body session', slots: [SLOTS.horizontalPress, SLOTS.verticalPull, SLOTS.horizontalPull, SLOTS.verticalPress, SLOTS.lateralRaise, SLOTS.triceps] },
  { id: 'lower', label: 'Lower', sessionTitle: 'Lower-body session', slots: [SLOTS.squat, SLOTS.hinge, SLOTS.unilateralLegs, SLOTS.legCurl, SLOTS.calves] },
  { id: 'full_body', label: 'Full body', sessionTitle: 'Full-body session', slots: [SLOTS.squat, SLOTS.horizontalPress, SLOTS.verticalPull, SLOTS.hinge, SLOTS.verticalPress] },
] as const;

/**
 * Chooses at most one exercise per movement slot. Profile equipment narrows the
 * choices, while the catalogue remains authoritative so archived rows are not
 * silently restored. Selection never invents loads, reps, or progression.
 */
export function resolveRoutineStarter(
  starter: RoutineStarter,
  catalog: Exercise[],
  availableEquipment: string[] = [],
): Exercise[] {
  const byId = new Map(catalog.map((exercise) => [exercise.id, exercise]));
  const allowed = normalizeEquipmentPreferences(availableEquipment);
  const selected: Exercise[] = [];
  const selectedIds = new Set<string>();

  for (const slot of starter.slots) {
    const candidates = slot.flatMap((id) => {
      const exercise = byId.get(id);
      return exercise ? [exercise] : [];
    });
    const exercise = allowed.size
      ? candidates.find((candidate) => {
          const family = exerciseEquipmentFamily(candidate.equipment);
          return family !== 'other' && allowed.has(family);
        }) ?? candidates.find((candidate) => exerciseEquipmentFamily(candidate.equipment) === 'bodyweight')
      : candidates[0];
    if (!exercise || selectedIds.has(exercise.id)) continue;
    selected.push(exercise);
    selectedIds.add(exercise.id);
  }

  return selected;
}

export function rankRoutineStarters(input: {
  catalog: Exercise[];
  availableEquipment?: string[];
  focus: MuscleGroupCoverage[];
}): RoutineStarterRecommendation[] {
  const readyFocus = input.focus.filter((item) => item.remainingSetCredits > 0 && !item.trainedWithin48Hours);
  if (!readyFocus.length) return [];

  return ROUTINE_STARTERS.map((starter, starterIndex) => {
    const exercises = resolveRoutineStarter(starter, input.catalog, input.availableEquipment);
    const draftCredits = summarizeExerciseMuscleCredits(exercises.map((exercise) => ({ exercise, setCount: 3 })));
    const byMuscle = new Map(draftCredits.map((item) => [item.muscleGroup, item.setCredits]));
    const matchedFocus = readyFocus.filter((item) => (byMuscle.get(muscleGroupFamilyKey(item.muscleGroup)) ?? 0) > 0);
    const score = matchedFocus.reduce((total, item) => total + Math.min(
      item.remainingSetCredits,
      byMuscle.get(muscleGroupFamilyKey(item.muscleGroup)) ?? 0,
    ), 0);
    return {
      starter,
      score: roundCredit(score),
      matchedFocus,
      exercises,
      reason: routineStarterReason(starter, matchedFocus),
      starterIndex,
    };
  }).filter((item) => item.score > 0 && item.exercises.length >= 2)
    .sort((left, right) => right.score - left.score
      || right.matchedFocus.length - left.matchedFocus.length
      || left.starterIndex - right.starterIndex)
    .map(({ starterIndex: _starterIndex, ...item }) => item);
}

export function summarizePlannedMuscleCredits(
  planned: Array<{ exerciseId: string; setCount: number }>,
  catalog: Exercise[],
): PlannedMuscleCredit[] {
  const byId = new Map(catalog.map((exercise) => [exercise.id, exercise]));
  return summarizeExerciseMuscleCredits(planned.flatMap((item) => {
    const exercise = byId.get(item.exerciseId);
    return exercise && item.setCount > 0 ? [{ exercise, setCount: item.setCount }] : [];
  }));
}

export function repeatedMovementPatterns(
  exerciseIds: string[],
  catalog: Exercise[],
): Array<{ movementPattern: string; count: number }> {
  const selected = new Set(exerciseIds);
  const counts = new Map<string, number>();
  for (const exercise of catalog) {
    if (!selected.has(exercise.id)) continue;
    counts.set(exercise.movementPattern, (counts.get(exercise.movementPattern) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([movementPattern, count]) => ({ movementPattern, count }))
    .sort((left, right) => right.count - left.count || left.movementPattern.localeCompare(right.movementPattern));
}

function summarizeExerciseMuscleCredits(
  entries: Array<{ exercise: Exercise; setCount: number }>,
): PlannedMuscleCredit[] {
  const credits = new Map<string, number>();
  for (const { exercise, setCount } of entries) {
    const primary = muscleGroupFamilyKey(exercise.primaryMuscleGroup);
    const secondary = [...new Set(exercise.secondaryMuscleGroups.map(muscleGroupFamilyKey))]
      .filter((group) => group !== primary);
    credits.set(primary, (credits.get(primary) ?? 0) + setCount);
    for (const group of secondary) credits.set(group, (credits.get(group) ?? 0) + setCount * 0.5);
  }
  return [...credits.entries()]
    .map(([muscleGroup, setCredits]) => ({
      muscleGroup,
      label: muscleGroupFamilyLabel(muscleGroup),
      setCredits: roundCredit(setCredits),
    }))
    .sort((left, right) => right.setCredits - left.setCredits || left.label.localeCompare(right.label));
}

function routineStarterReason(starter: RoutineStarter, focus: MuscleGroupCoverage[]): string {
  const visible = focus.slice(0, 3);
  const names = formatList(visible.map((item) => item.label));
  const gaps = formatList(visible.map((item) => `${formatCredit(item.remainingSetCredits)} ${item.label.toLocaleLowerCase()}`));
  return `${starter.label} covers ${names}. Current coverage is below the usual week by ${gaps}. Exercise choices use the equipment saved in your profile.`;
}

function formatList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? 'the current focus';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values[0]}, ${values[1]}, and ${values[2]}`;
}

function formatCredit(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} set credit${value === 1 ? '' : 's'} for`;
}

function roundCredit(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeEquipmentPreferences(values: string[]): Set<ExerciseEquipmentFilter> {
  const normalized = new Set<ExerciseEquipmentFilter>();
  for (const value of values) {
    const singular = value.trim().toLocaleLowerCase().replace(/s$/, '');
    if (singular === 'barbell' || singular === 'dumbbell' || singular === 'cable'
      || singular === 'machine' || singular === 'bodyweight' || singular === 'kettlebell') {
      normalized.add(singular);
    }
  }
  return normalized;
}
