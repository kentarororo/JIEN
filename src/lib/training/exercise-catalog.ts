import type { Exercise } from '@/lib/db/types';
import { MUSCLE_GROUP_OPTIONS, muscleGroupLabel, normalizeMuscleGroupKey } from '@/lib/progression';

export const EXERCISE_EQUIPMENT_FILTERS = [
  { value: 'barbell', label: 'Barbell' },
  { value: 'dumbbell', label: 'Dumbbell' },
  { value: 'cable', label: 'Cable' },
  { value: 'machine', label: 'Machine' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'kettlebell', label: 'Kettlebell' },
] as const;

export type ExerciseEquipmentFilter = typeof EXERCISE_EQUIPMENT_FILTERS[number]['value'];
export type ExerciseMuscleSection = typeof MUSCLE_GROUP_OPTIONS[number]['section'];

export function filterExerciseCatalog(
  exercises: Exercise[],
  options: {
    query?: string;
    muscleSection?: ExerciseMuscleSection | null;
    equipment?: ExerciseEquipmentFilter | null;
  } = {},
): Exercise[] {
  const terms = normalizeSearch(options.query ?? '').split(' ').filter(Boolean);
  return exercises.filter((exercise) => {
    if (options.muscleSection && !exerciseMuscleSections(exercise).has(options.muscleSection)) return false;
    if (options.equipment && exerciseEquipmentFamily(exercise.equipment) !== options.equipment) return false;
    if (!terms.length) return true;
    const searchText = exerciseSearchText(exercise);
    return terms.every((term) => searchText.includes(term));
  });
}

export function exerciseEquipmentFamily(value: string | null | undefined): ExerciseEquipmentFilter | 'other' {
  if (!value) return 'bodyweight';
  if (value === 'smith_machine' || value === 'machine') return 'machine';
  if (EXERCISE_EQUIPMENT_FILTERS.some((option) => option.value === value)) {
    return value as ExerciseEquipmentFilter;
  }
  return 'other';
}

export function exerciseEquipmentLabel(value: string | null | undefined): string {
  const family = exerciseEquipmentFamily(value);
  if (value === 'smith_machine') return 'Smith machine';
  return EXERCISE_EQUIPMENT_FILTERS.find((option) => option.value === family)?.label ?? 'Other';
}

function exerciseSearchText(exercise: Exercise): string {
  const muscleGroups = [exercise.primaryMuscleGroup, ...exercise.secondaryMuscleGroups];
  const muscleTerms = muscleGroups.flatMap((group) => {
    const normalized = normalizeMuscleGroupKey(group);
    const option = MUSCLE_GROUP_OPTIONS.find((item) => item.value === normalized);
    return [normalized, muscleGroupLabel(normalized), option?.section ?? ''];
  });
  return normalizeSearch([
    exercise.name,
    exercise.movementPattern,
    exercise.equipment ?? 'bodyweight',
    exerciseEquipmentLabel(exercise.equipment),
    ...muscleTerms,
  ].join(' '));
}

function exerciseMuscleSections(exercise: Exercise): Set<ExerciseMuscleSection> {
  const sections = [exercise.primaryMuscleGroup, ...exercise.secondaryMuscleGroups]
    .map((group) => MUSCLE_GROUP_OPTIONS.find((option) => option.value === normalizeMuscleGroupKey(group))?.section)
    .filter((section): section is ExerciseMuscleSection => Boolean(section));
  return new Set(sections);
}

function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase().replaceAll(/[^a-z0-9]+/g, ' ').trim();
}
