import type { SQLiteDatabase } from 'expo-sqlite';

import { MUSCLE_GROUP_OPTIONS, normalizeMuscleGroupKey } from '../progression/index.ts';
import { withExclusiveTransaction } from './exclusive-transaction.ts';
import type { Exercise } from './types.ts';

const STARTER_EXERCISE_ID_PREFIX = '10000000-';
const selectableMuscleGroups = new Set<string>(MUSCLE_GROUP_OPTIONS.map((option) => option.value));

export type UpdateExerciseTargetsInput = {
  primaryMuscleGroup: string;
  secondaryMuscleGroups: string[];
};

type ExerciseTargetRow = {
  id: string;
  name: string;
  movement_pattern: string;
  primary_muscle_group: string;
  secondary_muscle_groups: string;
  equipment: string | null;
  target_rep_min: number;
  target_rep_max: number;
  load_increment: number;
  notes: string | null;
  is_archived: number;
};

export function isStarterExerciseId(exerciseId: string): boolean {
  return exerciseId.startsWith(STARTER_EXERCISE_ID_PREFIX);
}

export function normalizeExerciseTargets(input: UpdateExerciseTargetsInput): UpdateExerciseTargetsInput {
  const primaryMuscleGroup = normalizeMuscleGroupKey(input.primaryMuscleGroup);
  if (!selectableMuscleGroups.has(primaryMuscleGroup)) {
    throw new Error('Choose a valid primary muscle group.');
  }
  const secondaryMuscleGroups = [...new Set(input.secondaryMuscleGroups.map(normalizeMuscleGroupKey))]
    .filter((group) => group !== primaryMuscleGroup);
  if (secondaryMuscleGroups.some((group) => !selectableMuscleGroups.has(group))) {
    throw new Error('Choose valid assisting muscle groups.');
  }
  return { primaryMuscleGroup, secondaryMuscleGroups };
}

export function exerciseTargetsNeedReview(
  exercise: Pick<Exercise, 'primaryMuscleGroup' | 'secondaryMuscleGroups'>,
): boolean {
  const primary = normalizeMuscleGroupKey(exercise.primaryMuscleGroup);
  const secondary = exercise.secondaryMuscleGroups.map(normalizeMuscleGroupKey);
  return !selectableMuscleGroups.has(primary)
    || secondary.some((group) => !selectableMuscleGroups.has(group) || group === primary)
    || new Set(secondary).size !== secondary.length;
}

export async function updateExerciseTargetsAtomically(
  db: SQLiteDatabase,
  exerciseId: string,
  input: UpdateExerciseTargetsInput,
  dependencies: {
    now: () => string;
    enqueue: (db: SQLiteDatabase, exercise: Exercise, changedAt: string) => Promise<void>;
  },
): Promise<Exercise> {
  const targets = normalizeExerciseTargets(input);
  const now = dependencies.now();

  return withExclusiveTransaction(db, async (db) => {
    const row = await db.getFirstAsync<ExerciseTargetRow>(
      `SELECT id, name, movement_pattern, primary_muscle_group, secondary_muscle_groups,
        equipment, target_rep_min, target_rep_max, load_increment, notes, is_archived
       FROM exercises
       WHERE id = ? AND deleted_at IS NULL`,
      [exerciseId],
    );
    if (!row) throw new Error('Exercise not found.');

    await db.runAsync(
      `UPDATE exercises
       SET primary_muscle_group = ?, secondary_muscle_groups = ?,
         updated_at = ?, client_updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [targets.primaryMuscleGroup, JSON.stringify(targets.secondaryMuscleGroups), now, now, exerciseId],
    );

    const exercise: Exercise = {
      id: row.id,
      name: row.name,
      movementPattern: row.movement_pattern,
      primaryMuscleGroup: targets.primaryMuscleGroup,
      secondaryMuscleGroups: targets.secondaryMuscleGroups,
      equipment: row.equipment,
      targetRepMin: row.target_rep_min,
      targetRepMax: row.target_rep_max,
      loadIncrement: row.load_increment,
      notes: row.notes,
      isArchived: row.is_archived === 1,
    };
    await dependencies.enqueue(db, exercise, now);
    return exercise;
  });
}
