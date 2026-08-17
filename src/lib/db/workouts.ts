import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { toLocalDateKey } from '@/lib/time';
import { calculateOverloadChangePercent, calculateSetVolumeKg, normalizeMuscleGroupKey } from '@/lib/progression';
import { parsePlannedWorkoutPlan } from '@/lib/planning/workout-plan';

import { exerciseRemotePayload } from './exercises';
import { withExclusiveTransaction } from './exclusive-transaction';
import { enqueueUpsert } from './sync-queue';
import type {
  LoadUnit,
  SaveWorkoutInput,
  SavePlannedWorkoutInput,
  SetKind,
  WorkoutDetail,
  WorkoutExportRow,
  VolumeHistorySet,
  WorkoutSet,
  WorkoutStatus,
  WorkoutSummary,
  WorkoutProgressComparison,
} from './types';

type WorkoutSummaryRow = {
  id: string;
  title: string;
  performed_on: string;
  started_at: string | null;
  completed_at: string | null;
  scheduled_at: string | null;
  plan_json: string | null;
  status: WorkoutStatus;
  set_count: number;
  exercise_count: number;
  total_volume_kg: number | null;
  muscle_groups: string | null;
};

function mapWorkoutSummary(row: WorkoutSummaryRow): WorkoutSummary {
  const plan = row.status === 'planned' ? parsePlannedWorkoutPlan(row.plan_json) : null;
  return {
    id: row.id,
    title: row.title,
    performedOn: row.performed_on,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    setCount: plan ? plan.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0) : row.set_count,
    exerciseCount: plan ? plan.exercises.length : row.exercise_count,
    totalVolumeKg: row.total_volume_kg ?? 0,
    muscleGroups: [...new Set((plan
      ? plan.exercises.map((exercise) => exercise.primaryMuscleGroup)
      : (row.muscle_groups ?? '').split(','))
      .map(normalizeMuscleGroupKey)
      .filter((group) => group !== 'other'))],
    scheduledAt: row.scheduled_at,
  };
}

const WORKOUT_SUMMARY_SELECT = `
  SELECT w.id, w.title, w.performed_on, w.started_at, w.completed_at, w.scheduled_at,
    w.status, w.notes, w.plan_json,
    COUNT(s.id) AS set_count,
    COUNT(DISTINCT s.exercise_id) AS exercise_count,
    GROUP_CONCAT(DISTINCT e.primary_muscle_group) AS muscle_groups,
    COALESCE(SUM(CASE
      WHEN s.kind = 'working' AND s.load_unit = 'lb' THEN s.load_value * 0.45359237 * s.reps
      WHEN s.kind = 'working' THEN s.load_value * s.reps
      ELSE 0 END), 0) AS total_volume_kg
  FROM workouts w
  LEFT JOIN workout_sets s ON s.workout_id = w.id AND s.deleted_at IS NULL
  LEFT JOIN exercises e ON e.id = s.exercise_id AND e.deleted_at IS NULL
`;

export async function listRecentWorkouts(
  db: SQLiteDatabase,
  limit = 20,
): Promise<WorkoutSummary[]> {
  const rows = await db.getAllAsync<WorkoutSummaryRow>(
    `${WORKOUT_SUMMARY_SELECT}
     WHERE w.status = 'completed' AND w.deleted_at IS NULL
     GROUP BY w.id
     ORDER BY w.performed_on DESC, w.started_at DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map(mapWorkoutSummary);
}

export async function listUpcomingPlannedWorkouts(
  db: SQLiteDatabase,
  limit = 20,
): Promise<WorkoutSummary[]> {
  const rows = await db.getAllAsync<WorkoutSummaryRow>(
    `${WORKOUT_SUMMARY_SELECT}
     WHERE w.status = 'planned' AND w.deleted_at IS NULL
     GROUP BY w.id
     ORDER BY w.scheduled_at ASC, w.performed_on ASC
     LIMIT ?`,
    [limit],
  );
  return rows.map(mapWorkoutSummary);
}

export async function getNextPlannedWorkout(
  db: SQLiteDatabase,
  now = new Date().toISOString(),
): Promise<WorkoutSummary | null> {
  const row = await db.getFirstAsync<WorkoutSummaryRow>(
    `${WORKOUT_SUMMARY_SELECT}
     WHERE w.status = 'planned' AND w.scheduled_at > ? AND w.deleted_at IS NULL
     GROUP BY w.id
     ORDER BY w.scheduled_at ASC, w.id ASC
     LIMIT 1`,
    [now],
  );
  return row ? mapWorkoutSummary(row) : null;
}

export async function listWorkoutsForDate(
  db: SQLiteDatabase,
  date: string,
): Promise<WorkoutSummary[]> {
  const rows = await db.getAllAsync<WorkoutSummaryRow>(
    `${WORKOUT_SUMMARY_SELECT}
     WHERE w.performed_on = ? AND w.status = 'completed' AND w.deleted_at IS NULL
     GROUP BY w.id
     ORDER BY w.started_at DESC, w.created_at DESC`,
    [date],
  );
  return rows.map(mapWorkoutSummary);
}

export async function listPlannedWorkoutsForDate(
  db: SQLiteDatabase,
  date: string,
): Promise<WorkoutSummary[]> {
  const rows = await db.getAllAsync<WorkoutSummaryRow>(
    `${WORKOUT_SUMMARY_SELECT}
     WHERE w.performed_on = ? AND w.status = 'planned' AND w.deleted_at IS NULL
     GROUP BY w.id
     ORDER BY w.scheduled_at ASC, w.created_at ASC`,
    [date],
  );
  return rows.map(mapWorkoutSummary);
}

export async function getWorkoutDetail(
  db: SQLiteDatabase,
  workoutId: string,
): Promise<WorkoutDetail | null> {
  const row = await db.getFirstAsync<WorkoutSummaryRow & { notes: string | null }>(
    `${WORKOUT_SUMMARY_SELECT}
     WHERE w.id = ? AND w.deleted_at IS NULL
     GROUP BY w.id`,
    [workoutId],
  );
  if (!row) return null;

  const setRows = await db.getAllAsync<{
    id: string;
    exercise_id: string;
    exercise_name: string;
    primary_muscle_group: string;
    secondary_muscle_groups: string;
    target_rep_min: number;
    target_rep_max: number;
    load_increment: number;
    reps: number;
    load_value: number;
    load_unit: LoadUnit;
    rpe: number | null;
    kind: SetKind;
    completed_at: string;
    sort_order: number;
  }>(
    `SELECT s.id, s.exercise_id, e.name AS exercise_name, e.primary_muscle_group,
      e.secondary_muscle_groups, e.target_rep_min, e.target_rep_max, e.load_increment,
      s.reps, s.load_value, s.load_unit, s.rpe, s.kind, s.completed_at, s.sort_order
     FROM workout_sets s
     JOIN exercises e ON e.id = s.exercise_id
     WHERE s.workout_id = ? AND s.deleted_at IS NULL
     ORDER BY s.sort_order`,
    [workoutId],
  );

  const sets: WorkoutSet[] = setRows.map((set) => ({
    id: set.id,
    exerciseId: set.exercise_id,
    exerciseName: set.exercise_name,
    primaryMuscleGroup: set.primary_muscle_group,
    secondaryMuscleGroups: JSON.parse(set.secondary_muscle_groups) as string[],
    targetRepMin: set.target_rep_min,
    targetRepMax: set.target_rep_max,
    loadIncrement: set.load_increment,
    reps: set.reps,
    loadValue: set.load_value,
    loadUnit: set.load_unit,
    rpe: set.rpe,
    kind: set.kind,
    completedAt: set.completed_at,
    sortOrder: set.sort_order,
  }));

  return {
    ...mapWorkoutSummary(row),
    notes: row.notes,
    sets,
    plan: parsePlannedWorkoutPlan(row.plan_json),
  };
}

export async function savePlannedWorkout(
  db: SQLiteDatabase,
  input: SavePlannedWorkoutInput,
): Promise<string> {
  if (!input.title.trim()) throw new Error('Give the planned session a name.');
  if (input.exercises.length === 0) throw new Error('Add at least one exercise to the plan.');
  if (new Set(input.exercises.map((exercise) => exercise.exerciseId)).size !== input.exercises.length) {
    throw new Error('Each exercise can appear once in a planned session.');
  }
  const scheduled = new Date(input.scheduledAt);
  if (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() <= Date.now()) {
    throw new Error('Choose a planned time in the future.');
  }
  if (toLocalDateKey(scheduled) !== input.performedOn) {
    throw new Error('The planned date and time do not match.');
  }

  const id = input.id ?? Crypto.randomUUID();
  const now = new Date().toISOString();
  const existing = await db.getFirstAsync<{ status: WorkoutStatus; created_at: string }>(
    'SELECT status, created_at FROM workouts WHERE id = ? AND deleted_at IS NULL',
    [id],
  );
  if (existing && existing.status !== 'planned') {
    throw new Error('Only an upcoming planned workout can be edited.');
  }
  const plan = { version: 1 as const, exercises: input.exercises };
  const payload = {
    id,
    title: input.title.trim(),
    status: 'planned',
    performed_on: input.performedOn,
    scheduled_at: input.scheduledAt,
    started_at: null,
    completed_at: null,
    notes: input.notes?.trim() || null,
    plan_json: plan,
    created_at: existing?.created_at ?? now,
    client_updated_at: now,
    deleted_at: null,
  };
  await withExclusiveTransaction(db, async (db) => {
    if (existing) {
      await db.runAsync(
        `UPDATE workouts SET title = ?, performed_on = ?, scheduled_at = ?, notes = ?,
          plan_json = ?, updated_at = ?, client_updated_at = ?
         WHERE id = ? AND status = 'planned' AND deleted_at IS NULL`,
        [payload.title, input.performedOn, input.scheduledAt, payload.notes, JSON.stringify(plan), now, now, id],
      );
    } else {
      await db.runAsync(
        `INSERT INTO workouts (
          id, title, status, performed_on, scheduled_at, started_at, completed_at,
          notes, plan_json, created_at, updated_at, client_updated_at
        ) VALUES (?, ?, 'planned', ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
        [id, payload.title, input.performedOn, input.scheduledAt, payload.notes, JSON.stringify(plan), now, now, now],
      );
    }
    await enqueueUpsert(db, 'workouts', id, payload);
  });
  return id;
}

export async function saveWorkout(
  db: SQLiteDatabase,
  input: SaveWorkoutInput,
): Promise<string> {
  if (input.exercises.length === 0 || input.exercises.some((entry) => entry.sets.length === 0)) {
    throw new Error('Add at least one exercise with a completed set.');
  }
  if (input.exercises.some((entry) => entry.sets.some((set) => set.reps <= 0 || set.loadValue < 0))) {
    throw new Error('Reps must be positive and load cannot be negative.');
  }

  const startedAt = new Date(input.startedAt);
  if (!Number.isFinite(startedAt.getTime()) || startedAt.getTime() > Date.now() + 60_000) {
    throw new Error('Completed workouts must use today or an earlier calendar date.');
  }

  const id = input.id ?? Crypto.randomUUID();
  const completedAt = input.startedAt;
  const performedOn = toLocalDateKey(startedAt);
  const workoutPayload = {
    id,
    title: input.title.trim() || 'Workout',
    status: 'completed',
    performed_on: performedOn,
    started_at: input.startedAt,
    completed_at: completedAt,
    scheduled_at: null,
    notes: input.notes?.trim() || null,
    plan_json: null,
    created_at: input.startedAt,
    client_updated_at: completedAt,
    deleted_at: null,
  };

  await withExclusiveTransaction(db, async (db) => {
    const insertResult = await db.runAsync(
      `INSERT OR IGNORE INTO workouts (
        id, title, status, performed_on, started_at, completed_at, notes,
        created_at, updated_at, client_updated_at
      ) VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        workoutPayload.title,
        performedOn,
        input.startedAt,
        completedAt,
        workoutPayload.notes,
        input.startedAt,
        completedAt,
        completedAt,
      ],
    );
    if (insertResult.changes === 0) return;
    await enqueueUpsert(db, 'workouts', id, workoutPayload);

    let sortOrder = 0;
    for (const entry of input.exercises) {
      await enqueueUpsert(db, 'exercises', entry.exercise.id, exerciseRemotePayload(entry.exercise, completedAt));
      for (const set of entry.sets) {
        const setId = Crypto.randomUUID();
        const setPayload = {
          id: setId,
          workout_id: id,
          exercise_id: entry.exercise.id,
          sort_order: sortOrder,
          kind: set.kind ?? 'working',
          reps: set.reps,
          load_value: set.loadValue,
          load_unit: set.loadUnit,
          rpe: set.rpe ?? null,
          completed_at: completedAt,
          notes: null,
          created_at: completedAt,
          client_updated_at: completedAt,
          deleted_at: null,
        };
        await db.runAsync(
          `INSERT INTO workout_sets (
            id, workout_id, exercise_id, sort_order, kind, reps, load_value, load_unit,
            rpe, completed_at, created_at, updated_at, client_updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            setId,
            id,
            entry.exercise.id,
            sortOrder,
            setPayload.kind,
            set.reps,
            set.loadValue,
            set.loadUnit,
            setPayload.rpe,
            completedAt,
            completedAt,
            completedAt,
            completedAt,
          ],
        );
        await enqueueUpsert(db, 'sets', setId, setPayload);
        sortOrder += 1;
      }
    }
  });

  return id;
}

export async function completePlannedWorkout(
  db: SQLiteDatabase,
  plannedWorkoutId: string,
  input: SaveWorkoutInput,
): Promise<string> {
  if (input.exercises.length === 0 || input.exercises.some((entry) => entry.sets.length === 0)) {
    throw new Error('Add at least one exercise with a completed set.');
  }
  if (input.exercises.some((entry) => entry.sets.some((set) => set.reps <= 0 || set.loadValue < 0))) {
    throw new Error('Reps must be positive and load cannot be negative.');
  }
  const existing = await db.getFirstAsync<{
    id: string;
    title: string;
    scheduled_at: string | null;
    plan_json: string | null;
    notes: string | null;
    created_at: string;
    status: WorkoutStatus;
  }>(
    `SELECT id, title, scheduled_at, plan_json, notes, created_at, status
     FROM workouts WHERE id = ? AND deleted_at IS NULL`,
    [plannedWorkoutId],
  );
  if (!existing || existing.status !== 'planned') {
    throw new Error('This planned workout is no longer available to complete.');
  }

  const startedAt = new Date(input.startedAt);
  if (!Number.isFinite(startedAt.getTime()) || startedAt.getTime() > Date.now() + 60_000) {
    throw new Error('Completed workouts must use the current time or earlier.');
  }
  const completedAt = input.startedAt;
  const performedOn = toLocalDateKey(startedAt);
  const workoutPayload = {
    id: plannedWorkoutId,
    title: input.title.trim() || existing.title,
    status: 'completed',
    performed_on: performedOn,
    scheduled_at: existing.scheduled_at,
    started_at: input.startedAt,
    completed_at: completedAt,
    notes: input.notes?.trim() || existing.notes,
    plan_json: parsePlannedWorkoutPlan(existing.plan_json),
    created_at: existing.created_at,
    client_updated_at: completedAt,
    deleted_at: null,
  };

  await withExclusiveTransaction(db, async (db) => {
    const updated = await db.runAsync(
      `UPDATE workouts SET title = ?, status = 'completed', performed_on = ?,
        started_at = ?, completed_at = ?, notes = ?, updated_at = ?, client_updated_at = ?
       WHERE id = ? AND status = 'planned' AND deleted_at IS NULL`,
      [workoutPayload.title, performedOn, input.startedAt, completedAt, workoutPayload.notes, completedAt, completedAt, plannedWorkoutId],
    );
    if (updated.changes !== 1) throw new Error('This planned workout changed before it could be saved.');
    await enqueueUpsert(db, 'workouts', plannedWorkoutId, workoutPayload);

    let sortOrder = 0;
    for (const entry of input.exercises) {
      await enqueueUpsert(db, 'exercises', entry.exercise.id, exerciseRemotePayload(entry.exercise, completedAt));
      for (const set of entry.sets) {
        const setId = Crypto.randomUUID();
        const setPayload = {
          id: setId,
          workout_id: plannedWorkoutId,
          exercise_id: entry.exercise.id,
          sort_order: sortOrder,
          kind: set.kind ?? 'working',
          reps: set.reps,
          load_value: set.loadValue,
          load_unit: set.loadUnit,
          rpe: set.rpe ?? null,
          completed_at: completedAt,
          notes: null,
          created_at: completedAt,
          client_updated_at: completedAt,
          deleted_at: null,
        };
        await db.runAsync(
          `INSERT INTO workout_sets (
            id, workout_id, exercise_id, sort_order, kind, reps, load_value, load_unit,
            rpe, completed_at, created_at, updated_at, client_updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            setId, plannedWorkoutId, entry.exercise.id, sortOrder, setPayload.kind,
            set.reps, set.loadValue, set.loadUnit, setPayload.rpe, completedAt,
            completedAt, completedAt, completedAt,
          ],
        );
        await enqueueUpsert(db, 'sets', setId, setPayload);
        sortOrder += 1;
      }
    }
  });
  return plannedWorkoutId;
}

export async function skipPlannedWorkout(db: SQLiteDatabase, workoutId: string): Promise<void> {
  const workout = await db.getFirstAsync<{
    id: string;
    title: string;
    performed_on: string;
    scheduled_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    notes: string | null;
    plan_json: string | null;
    created_at: string;
  }>(
    `SELECT id, title, performed_on, scheduled_at, started_at, completed_at, notes,
      plan_json, created_at FROM workouts
     WHERE id = ? AND status = 'planned' AND deleted_at IS NULL`,
    [workoutId],
  );
  if (!workout) return;
  const now = new Date().toISOString();
  await withExclusiveTransaction(db, async (db) => {
    await db.runAsync(
      `UPDATE workouts SET status = 'skipped', updated_at = ?, client_updated_at = ?
       WHERE id = ? AND status = 'planned'`,
      [now, now, workoutId],
    );
    await enqueueUpsert(db, 'workouts', workoutId, {
      ...workout,
      status: 'skipped',
      plan_json: parsePlannedWorkoutPlan(workout.plan_json),
      client_updated_at: now,
      deleted_at: null,
    });
  });
}

export async function deleteWorkout(db: SQLiteDatabase, workoutId: string): Promise<void> {
  const workout = await db.getFirstAsync<{
    id: string;
    title: string;
    status: WorkoutStatus;
    performed_on: string;
    started_at: string | null;
    completed_at: string | null;
    scheduled_at: string | null;
    notes: string | null;
    plan_json: string | null;
    created_at: string;
  }>(
    `SELECT id, title, status, performed_on, started_at, completed_at, scheduled_at,
      notes, plan_json, created_at
     FROM workouts WHERE id = ? AND deleted_at IS NULL`,
    [workoutId],
  );
  if (!workout) return;

  const sets = await db.getAllAsync<{
    id: string;
    workout_id: string;
    exercise_id: string;
    sort_order: number;
    kind: SetKind;
    reps: number;
    load_value: number;
    load_unit: LoadUnit;
    rpe: number | null;
    completed_at: string;
    notes: string | null;
    created_at: string;
  }>(
    `SELECT id, workout_id, exercise_id, sort_order, kind, reps, load_value, load_unit,
      rpe, completed_at, notes, created_at
     FROM workout_sets WHERE workout_id = ? AND deleted_at IS NULL`,
    [workoutId],
  );
  const deletedAt = new Date().toISOString();

  await withExclusiveTransaction(db, async (db) => {
    await db.runAsync(
      `UPDATE workouts SET deleted_at = ?, updated_at = ?, client_updated_at = ? WHERE id = ?`,
      [deletedAt, deletedAt, deletedAt, workoutId],
    );
    await enqueueUpsert(db, 'workouts', workoutId, {
      ...workout,
      plan_json: parsePlannedWorkoutPlan(workout.plan_json),
      client_updated_at: deletedAt,
      deleted_at: deletedAt,
    });

    for (const set of sets) {
      await db.runAsync(
        `UPDATE workout_sets SET deleted_at = ?, updated_at = ?, client_updated_at = ? WHERE id = ?`,
        [deletedAt, deletedAt, deletedAt, set.id],
      );
      await enqueueUpsert(db, 'sets', set.id, {
        ...set,
        client_updated_at: deletedAt,
        deleted_at: deletedAt,
      });
    }
  });
}

export async function getExerciseHistory(
  db: SQLiteDatabase,
  exerciseId: string,
  limit = 12,
): Promise<WorkoutSet[]> {
  const rows = await db.getAllAsync<{
    id: string;
    exercise_id: string;
    exercise_name: string;
    primary_muscle_group: string;
    secondary_muscle_groups: string;
    target_rep_min: number;
    target_rep_max: number;
    load_increment: number;
    reps: number;
    load_value: number;
    load_unit: LoadUnit;
    rpe: number | null;
    kind: SetKind;
    completed_at: string;
    sort_order: number;
  }>(
    `SELECT s.id, s.exercise_id, e.name AS exercise_name, e.primary_muscle_group,
      e.secondary_muscle_groups, e.target_rep_min, e.target_rep_max, e.load_increment,
      s.reps, s.load_value, s.load_unit, s.rpe, s.kind, s.completed_at, s.sort_order
     FROM workout_sets s
     JOIN exercises e ON e.id = s.exercise_id
     WHERE s.exercise_id = ? AND s.kind = 'working' AND s.deleted_at IS NULL
     ORDER BY s.completed_at DESC, s.sort_order ASC
     LIMIT ?`,
    [exerciseId, limit],
  );
  return rows.map((set) => ({
    id: set.id,
    exerciseId: set.exercise_id,
    exerciseName: set.exercise_name,
    primaryMuscleGroup: set.primary_muscle_group,
    secondaryMuscleGroups: JSON.parse(set.secondary_muscle_groups) as string[],
    targetRepMin: set.target_rep_min,
    targetRepMax: set.target_rep_max,
    loadIncrement: set.load_increment,
    reps: set.reps,
    loadValue: set.load_value,
    loadUnit: set.load_unit,
    rpe: set.rpe,
    kind: set.kind,
    completedAt: set.completed_at,
    sortOrder: set.sort_order,
  }));
}

export async function getLastExerciseSessionSets(
  db: SQLiteDatabase,
  exerciseId: string,
): Promise<WorkoutSet[]> {
  const latest = await db.getFirstAsync<{ workout_id: string }>(
    `SELECT s.workout_id
     FROM workout_sets s
     JOIN workouts w ON w.id = s.workout_id
     WHERE s.exercise_id = ?
       AND s.kind = 'working'
       AND s.deleted_at IS NULL
       AND w.deleted_at IS NULL
       AND w.status = 'completed'
     ORDER BY w.completed_at DESC
     LIMIT 1`,
    [exerciseId],
  );
  if (!latest) return [];
  const detail = await getWorkoutDetail(db, latest.workout_id);
  return detail?.sets.filter((set) => set.exerciseId === exerciseId && set.kind === 'working') ?? [];
}

export async function getWorkoutProgressComparison(
  db: SQLiteDatabase,
  workoutId?: string,
): Promise<WorkoutProgressComparison | null> {
  const targetId = workoutId ?? (await listRecentWorkouts(db, 1))[0]?.id;
  if (!targetId) return null;
  const workout = await getWorkoutDetail(db, targetId);
  if (!workout?.completedAt || workout.status !== 'completed') return null;

  const grouped = new Map<string, { exerciseName: string; currentVolumeKg: number }>();
  for (const set of workout.sets) {
    if (set.kind !== 'working') continue;
    const current = grouped.get(set.exerciseId) ?? { exerciseName: set.exerciseName, currentVolumeKg: 0 };
    current.currentVolumeKg += calculateSetVolumeKg(set);
    grouped.set(set.exerciseId, current);
  }

  const exercises = await Promise.all([...grouped.entries()].map(async ([exerciseId, current]) => {
    const previous = await db.getFirstAsync<{ volume_kg: number | null }>(
      `SELECT SUM(CASE
          WHEN s.load_unit = 'lb' THEN s.load_value * 0.45359237 * s.reps
          ELSE s.load_value * s.reps END) AS volume_kg
       FROM workout_sets s
       WHERE s.workout_id = (
         SELECT previous_workout.id
         FROM workouts previous_workout
         JOIN workout_sets previous_set ON previous_set.workout_id = previous_workout.id
         WHERE previous_set.exercise_id = ?
           AND previous_set.kind = 'working'
           AND previous_set.deleted_at IS NULL
           AND previous_workout.deleted_at IS NULL
           AND previous_workout.status = 'completed'
           AND previous_workout.completed_at < ?
         GROUP BY previous_workout.id
         ORDER BY previous_workout.completed_at DESC
         LIMIT 1
       )
         AND s.exercise_id = ?
         AND s.kind = 'working'
         AND s.deleted_at IS NULL`,
      [exerciseId, workout.completedAt, exerciseId],
    );
    const previousVolumeKg = previous?.volume_kg ?? null;
    return {
      exerciseId,
      exerciseName: current.exerciseName,
      currentVolumeKg: current.currentVolumeKg,
      previousVolumeKg,
      changePercent: previousVolumeKg == null
        ? null
        : calculateOverloadChangePercent(current.currentVolumeKg, previousVolumeKg),
    };
  }));

  const comparable = exercises.filter((exercise) => exercise.previousVolumeKg != null && exercise.previousVolumeKg > 0);
  const currentComparableVolumeKg = comparable.reduce((sum, exercise) => sum + exercise.currentVolumeKg, 0);
  const previousComparableVolumeKg = comparable.reduce((sum, exercise) => sum + (exercise.previousVolumeKg ?? 0), 0);
  return {
    workoutId: targetId,
    comparableExerciseCount: comparable.length,
    improvedExerciseCount: comparable.filter((exercise) => (exercise.changePercent ?? 0) > 0).length,
    currentComparableVolumeKg,
    previousComparableVolumeKg,
    overallChangePercent: calculateOverloadChangePercent(currentComparableVolumeKg, previousComparableVolumeKg),
    exercises,
  };
}

export async function listWorkoutExportRows(db: SQLiteDatabase): Promise<WorkoutExportRow[]> {
  const rows = await db.getAllAsync<{
    workout_id: string;
    performed_on: string;
    workout_title: string;
    exercise: string;
    muscle_group: string;
    set_number: number;
    kind: SetKind;
    reps: number;
    load_value: number;
    load_unit: LoadUnit;
    rpe: number | null;
    volume_kg: number;
  }>(
    `SELECT w.id AS workout_id, w.performed_on, w.title AS workout_title,
      e.name AS exercise, e.primary_muscle_group AS muscle_group,
      s.sort_order + 1 AS set_number, s.kind, s.reps, s.load_value, s.load_unit, s.rpe,
      CASE WHEN s.load_unit = 'lb' THEN s.load_value * 0.45359237 * s.reps
        ELSE s.load_value * s.reps END AS volume_kg
     FROM workout_sets s
     JOIN workouts w ON w.id = s.workout_id
     JOIN exercises e ON e.id = s.exercise_id
     WHERE s.deleted_at IS NULL AND w.deleted_at IS NULL
     ORDER BY w.performed_on, w.started_at, s.sort_order`,
  );
  return rows.map((row) => ({
    workoutId: row.workout_id,
    performedOn: row.performed_on,
    workoutTitle: row.workout_title,
    exercise: row.exercise,
    muscleGroup: row.muscle_group,
    setNumber: row.set_number,
    kind: row.kind,
    reps: row.reps,
    load: row.load_value,
    unit: row.load_unit,
    rpe: row.rpe,
    volumeKg: row.volume_kg,
  }));
}

export async function listVolumeHistory(
  db: SQLiteDatabase,
  since: Date = new Date(Date.now() - 70 * 86_400_000),
): Promise<VolumeHistorySet[]> {
  const rows = await db.getAllAsync<{
    reps: number;
    load_value: number;
    load_unit: LoadUnit;
    kind: SetKind;
    completed_at: string;
    movement_pattern: string;
    primary_muscle_group: string;
    secondary_muscle_groups: string;
  }>(
    `SELECT s.reps, s.load_value, s.load_unit, s.kind, s.completed_at,
      e.movement_pattern, e.primary_muscle_group, e.secondary_muscle_groups
     FROM workout_sets s
     JOIN workouts w ON w.id = s.workout_id
     JOIN exercises e ON e.id = s.exercise_id
     WHERE s.completed_at >= ? AND s.deleted_at IS NULL AND w.deleted_at IS NULL
     ORDER BY s.completed_at`,
    [since.toISOString()],
  );
  return rows.map((row) => ({
    reps: row.reps,
    loadValue: row.load_value,
    loadUnit: row.load_unit,
    kind: row.kind,
    completedAt: row.completed_at,
    movementPattern: row.movement_pattern,
    primaryMuscleGroup: row.primary_muscle_group,
    secondaryMuscleGroups: JSON.parse(row.secondary_muscle_groups) as string[],
  }));
}
