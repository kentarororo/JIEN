import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { enqueueUpsert } from './sync-queue';
import type { Exercise } from './types';

type ExerciseRow = {
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

function mapExercise(row: ExerciseRow): Exercise {
  return {
    id: row.id,
    name: row.name,
    movementPattern: row.movement_pattern,
    primaryMuscleGroup: row.primary_muscle_group,
    secondaryMuscleGroups: JSON.parse(row.secondary_muscle_groups) as string[],
    equipment: row.equipment,
    targetRepMin: row.target_rep_min,
    targetRepMax: row.target_rep_max,
    loadIncrement: row.load_increment,
    notes: row.notes,
    isArchived: row.is_archived === 1,
  };
}

export async function listExercises(db: SQLiteDatabase): Promise<Exercise[]> {
  const rows = await db.getAllAsync<ExerciseRow>(
    `SELECT id, name, movement_pattern, primary_muscle_group, secondary_muscle_groups,
      equipment, target_rep_min, target_rep_max, load_increment, notes, is_archived
     FROM exercises
     WHERE deleted_at IS NULL AND is_archived = 0
     ORDER BY primary_muscle_group, name`,
  );
  return rows.map(mapExercise);
}

export async function createCustomExercise(
  db: SQLiteDatabase,
  input: Omit<Exercise, 'id' | 'isArchived' | 'secondaryMuscleGroups' | 'notes'> & {
    secondaryMuscleGroups?: string[];
    notes?: string;
  },
): Promise<Exercise> {
  const exercise: Exercise = {
    ...input,
    id: Crypto.randomUUID(),
    isArchived: false,
    secondaryMuscleGroups: input.secondaryMuscleGroups ?? [],
    notes: input.notes ?? null,
  };
  const now = new Date().toISOString();
  const payload = {
    id: exercise.id,
    name: exercise.name.trim(),
    movement_pattern: exercise.movementPattern.trim(),
    primary_muscle_group: exercise.primaryMuscleGroup.trim(),
    secondary_muscle_groups: exercise.secondaryMuscleGroups,
    equipment: exercise.equipment,
    target_rep_min: exercise.targetRepMin,
    target_rep_max: exercise.targetRepMax,
    load_increment: exercise.loadIncrement,
    notes: exercise.notes,
    is_archived: false,
    created_at: now,
    client_updated_at: now,
    deleted_at: null,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO exercises (
        id, name, movement_pattern, primary_muscle_group, secondary_muscle_groups,
        equipment, target_rep_min, target_rep_max, load_increment, notes, is_archived,
        created_at, updated_at, client_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        exercise.id,
        payload.name,
        payload.movement_pattern,
        payload.primary_muscle_group,
        JSON.stringify(payload.secondary_muscle_groups),
        payload.equipment,
        payload.target_rep_min,
        payload.target_rep_max,
        payload.load_increment,
        payload.notes,
        now,
        now,
        now,
      ],
    );
    await enqueueUpsert(db, 'exercises', exercise.id, payload);
  });

  return exercise;
}

export function exerciseRemotePayload(exercise: Exercise, now: string): Record<string, unknown> {
  return {
    id: exercise.id,
    name: exercise.name,
    movement_pattern: exercise.movementPattern,
    primary_muscle_group: exercise.primaryMuscleGroup,
    secondary_muscle_groups: exercise.secondaryMuscleGroups,
    equipment: exercise.equipment,
    target_rep_min: exercise.targetRepMin,
    target_rep_max: exercise.targetRepMax,
    load_increment: exercise.loadIncrement,
    notes: exercise.notes,
    is_archived: exercise.isArchived,
    client_updated_at: now,
    deleted_at: null,
  };
}
