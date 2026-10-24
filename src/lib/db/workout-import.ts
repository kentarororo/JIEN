import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { deterministicImportUuid, type WorkoutImportPreview } from '../import/workout-csv.ts';
import type { Exercise } from './types';
import { exerciseRemotePayload } from './exercises';
import { withExclusiveTransaction } from './exclusive-transaction';
import { enqueueUpsert } from './sync-queue';

export type WorkoutImportExerciseChoice =
  | { kind: 'existing'; exercise: Exercise }
  | { kind: 'create'; name: string };

export type WorkoutImportResult = {
  importedWorkouts: number;
  importedSets: number;
  skippedWorkouts: number;
};

export async function importWorkoutHistory(
  database: SQLiteDatabase,
  preview: WorkoutImportPreview,
  choices: Record<string, WorkoutImportExerciseChoice>,
): Promise<WorkoutImportResult> {
  const missing = preview.exerciseNames.filter((name) => !choices[name]);
  if (missing.length) throw new Error(`Choose how to import: ${missing.join(', ')}.`);
  const changedAt = new Date().toISOString();
  let importedWorkouts = 0;
  let importedSets = 0;
  let skippedWorkouts = 0;

  await withExclusiveTransaction(database, async (transaction) => {
    const importNamespace = await getImportNamespace(transaction, changedAt);
    const exercises: Record<string, Exercise> = {};
    for (const exerciseName of preview.exerciseNames) {
      const choice = choices[exerciseName]!;
      if (choice.kind === 'existing') {
        exercises[exerciseName] = choice.exercise;
        continue;
      }
      const exercise = importedCustomExercise(importNamespace, preview.source, choice.name || exerciseName);
      await transaction.runAsync(
        `INSERT OR IGNORE INTO exercises (
          id, name, movement_pattern, primary_muscle_group, secondary_muscle_groups,
          equipment, target_rep_min, target_rep_max, load_increment, notes, is_archived,
          created_at, updated_at, client_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          exercise.id, exercise.name, exercise.movementPattern, exercise.primaryMuscleGroup,
          JSON.stringify(exercise.secondaryMuscleGroups), exercise.equipment,
          exercise.targetRepMin, exercise.targetRepMax, exercise.loadIncrement, exercise.notes,
          changedAt, changedAt, changedAt,
        ],
      );
      await enqueueUpsert(transaction, 'exercises', exercise.id, exerciseRemotePayload(exercise, changedAt));
      exercises[exerciseName] = exercise;
    }

    for (const workout of preview.workouts) {
      const workoutId = deterministicImportUuid(`${importNamespace}\u001fworkout\u001f${workout.sourceKey}`);
      const workoutPayload = {
        id: workoutId,
        title: workout.title,
        status: 'completed',
        performed_on: workout.performedOn,
        started_at: workout.startedAt,
        completed_at: workout.startedAt,
        scheduled_at: null,
        notes: workout.notes,
        plan_json: null,
        created_at: workout.startedAt,
        client_updated_at: changedAt,
        deleted_at: null,
      };
      const inserted = await transaction.runAsync(
        `INSERT OR IGNORE INTO workouts (
          id, title, status, performed_on, started_at, completed_at, notes,
          created_at, updated_at, client_updated_at
        ) VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)`,
        [workoutId, workout.title, workout.performedOn, workout.startedAt, workout.startedAt, workout.notes, workout.startedAt, changedAt, changedAt],
      );
      if (inserted.changes === 0) {
        skippedWorkouts += 1;
        continue;
      }
      await enqueueUpsert(transaction, 'workouts', workoutId, workoutPayload);
      importedWorkouts += 1;

      for (const [index, set] of workout.sets.entries()) {
        const exercise = exercises[set.exerciseName]!;
        const setId = deterministicImportUuid(`${importNamespace}\u001fset\u001f${workout.sourceKey}\u001f${index}\u001f${set.exerciseName}\u001f${set.setOrder}`);
        const setPayload = {
          id: setId,
          workout_id: workoutId,
          exercise_id: exercise.id,
          sort_order: index,
          kind: set.kind,
          reps: set.reps,
          load_value: set.loadValue,
          load_unit: set.loadUnit,
          rpe: set.rpe,
          primary_muscle_group: exercise.primaryMuscleGroup,
          secondary_muscle_groups: exercise.secondaryMuscleGroups,
          completed_at: workout.startedAt,
          notes: null,
          created_at: workout.startedAt,
          client_updated_at: changedAt,
          deleted_at: null,
        };
        await transaction.runAsync(
          `INSERT INTO workout_sets (
            id, workout_id, exercise_id, sort_order, kind, reps, load_value, load_unit,
            rpe, primary_muscle_group, secondary_muscle_groups, completed_at,
            created_at, updated_at, client_updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            setId, workoutId, exercise.id, index, set.kind, set.reps, set.loadValue, set.loadUnit,
            set.rpe, exercise.primaryMuscleGroup, JSON.stringify(exercise.secondaryMuscleGroups),
            workout.startedAt, workout.startedAt, changedAt, changedAt,
          ],
        );
        await enqueueUpsert(transaction, 'sets', setId, setPayload);
        importedSets += 1;
      }
    }
  });

  return { importedWorkouts, importedSets, skippedWorkouts };
}

async function getImportNamespace(database: SQLiteDatabase, changedAt: string): Promise<string> {
  const existing = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'workout_import_namespace'",
  );
  if (existing?.value.trim()) return existing.value.trim();
  const namespace = Crypto.randomUUID();
  await database.runAsync(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)',
    ['workout_import_namespace', namespace, changedAt],
  );
  return namespace;
}

function importedCustomExercise(importNamespace: string, source: WorkoutImportPreview['source'], name: string): Exercise {
  const trimmedName = name.trim() || 'Imported exercise';
  return {
    id: deterministicImportUuid(`${importNamespace}\u001fexercise\u001f${source}\u001f${trimmedName.toLowerCase()}`),
    name: trimmedName,
    movementPattern: 'other',
    primaryMuscleGroup: 'other',
    secondaryMuscleGroups: [],
    equipment: null,
    targetRepMin: 6,
    targetRepMax: 12,
    loadIncrement: 2.5,
    notes: `Created during ${source === 'hevy' ? 'Hevy' : 'Strong'} import. Review muscle targets before using progression guidance.`,
    isArchived: false,
  };
}
