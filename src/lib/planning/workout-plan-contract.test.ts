import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { fillBlankWorkoutLoads, latestValidWorkoutLoad, summarizeWorkoutDraft } from '../workout-draft.ts';
import { completePlannedWorkout, savePlannedWorkout, skipPlannedWorkout } from '../db/workouts.ts';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('planned workouts are local-first and use the same synced workout UUID when completed', () => {
  const migration = read('../db/migrate.ts');
  const repository = read('../db/workouts.ts');
  const remoteMigration = read('../../../supabase/migrations/20260815000100_planned_workouts.sql');
  assert.match(migration, /currentVersion < 10/);
  assert.match(migration, /scheduled_at/);
  assert.match(migration, /plan_json/);
  assert.match(remoteMigration, /alter table public\.workouts/);
  assert.match(remoteMigration, /workouts_upcoming_plan_idx/);
  assert.match(repository, /savePlannedWorkout[\s\S]*withExclusiveTransaction[\s\S]*enqueueUpsert\(db, 'workouts'/);
  assert.match(repository, /input\.sessionApproach[\s\S]*sessionApproach: input\.sessionApproach/);
  assert.match(repository, /completePlannedWorkout[\s\S]*WHERE id = \? AND status = 'planned'/);
  assert.match(repository, /workout_id: plannedWorkoutId/);
  assert.match(repository, /saveWorkout[\s\S]*clearRecoveryDraft\(db, input\.recoveryDraftKey\)/);
  assert.match(repository, /updateWorkout[\s\S]*clearRecoveryDraft\(db, input\.recoveryDraftKey\)/);
  assert.match(repository, /completePlannedWorkout[\s\S]*clearRecoveryDraft\(db, input\.recoveryDraftKey\)/);
  assert.match(repository, /reschedulePlannedWorkout[\s\S]*withExclusiveTransaction[\s\S]*enqueueUpsert\(transaction, 'workouts'/);
  assert.match(repository, /UPDATE workouts SET performed_on = \?, scheduled_at = \?/);
  assert.match(repository, /if \(input\.scheduledAt != null\)/);
  assert.match(repository, /CASE WHEN w\.scheduled_at IS NULL THEN 0 ELSE 1 END/);
  assert.match(repository, /listPlannedWorkoutsForDate[\s\S]*w\.scheduled_at IS NOT NULL/);
  assert.match(repository, /savePlannedWorkout[\s\S]*const updated = await db\.runAsync[\s\S]*updated\.changes !== 1[\s\S]*enqueueUpsert\(db, 'workouts'/);
  assert.match(repository, /skipPlannedWorkout[\s\S]*status = 'planned' AND deleted_at IS NULL[\s\S]*updated\.changes !== 1[\s\S]*enqueueUpsert\(db, 'workouts'/);
});

test('completed-workout choices flow into an editable local plan', () => {
  const detail = read('../../app/workouts/[id].tsx');
  const planner = read('../../app/workouts/plan.tsx');
  assert.match(detail, /SESSION_APPROACHES\.map/);
  assert.match(detail, /sourceWorkoutId: detail\.id/);
  assert.match(detail, /sessionApproach: nextApproach/);
  assert.match(planner, /getWorkoutDetail\(db, params\.sourceWorkoutId\)/);
  assert.match(planner, /buildPlanFromCompletedWorkout/);
  assert.match(planner, /sessionApproach,/);
});

test('calendar, start flow, and reminders all invalidate stale plans', () => {
  const calendar = read('../../app/(tabs)/today.tsx');
  const logger = read('../../app/workouts/new.tsx');
  const runtime = read('../../components/app-runtime.tsx');
  const notifications = read('../notifications/index.ts');
  assert.match(calendar, /listPlannedWorkoutsForDate/);
  assert.match(calendar, /pathname: '\/workouts\/plan'/);
  assert.match(logger, /completePlannedWorkout/);
  assert.match(logger, /planWorkoutId \? new Date\(\)\.toISOString\(\) : null/);
  assert.match(logger, /\(editWorkoutId \|\| planWorkoutId\) && editStartedAt/);
  assert.match(runtime, /subscribeToQueuedLocalWrites/);
  assert.match(notifications, /reconcileWorkoutPlanNotification/);
  assert.match(notifications, /cancelWorkoutPlanNotification/);
  assert.match(notifications, /scheduled_workout_plan_key/);
});

test('a concurrently changed plan is never queued as an edit or skip', async () => {
  for (const action of ['edit', 'skip'] as const) {
    let queueWrites = 0;
    const db = {
      getFirstAsync: async () => action === 'edit'
        ? { status: 'planned', created_at: '2026-09-04T01:00:00.000Z' }
        : {
            id: 'plan-race', title: 'Push', performed_on: '2026-09-04', scheduled_at: null,
            started_at: null, completed_at: null, notes: null, plan_json: null,
            created_at: '2026-09-04T01:00:00.000Z',
          },
      runAsync: async (sql: string) => {
        if (sql.includes('INSERT INTO sync_queue')) queueWrites += 1;
        return { changes: sql.includes('UPDATE workouts') ? 0 : 1 };
      },
      withTransactionAsync: async (task: () => Promise<void>) => task(),
    } as unknown as SQLiteDatabase;

    const operation = action === 'edit'
      ? savePlannedWorkout(db, {
          id: 'plan-race', title: 'Push', performedOn: '2026-09-04', scheduledAt: null,
          exercises: [{
            exerciseId: 'exercise-1', exerciseName: 'Chest press', primaryMuscleGroup: 'chest',
            targetRepMin: 8, targetRepMax: 12,
            sets: [{ loadValue: 40, loadUnit: 'kg', reps: 8 }],
            progression: { action: 'hold', reason: 'Hold.', cues: [] },
          }],
        })
      : skipPlannedWorkout(db, 'plan-race');

    await assert.rejects(operation, /changed before it could be (saved|skipped)/);
    assert.equal(queueWrites, 0, `${action} must not enqueue a state that SQLite rejected`);
  }
});

test('completing a plan preserves its recovered start and stamps the actual completion write', async () => {
  const queued = new Map<string, Record<string, unknown>>();
  const db = {
    getFirstAsync: async () => ({
      id: 'plan-complete', title: 'Push', scheduled_at: null, plan_json: null,
      notes: null, created_at: '2026-09-04T01:00:00.000Z', status: 'planned',
    }),
    runAsync: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO sync_queue')) {
        queued.set(String(params[1]), JSON.parse(String(params[3])) as Record<string, unknown>);
      }
      return { changes: 1 };
    },
    withTransactionAsync: async (task: () => Promise<void>) => task(),
  } as unknown as SQLiteDatabase;
  const startedAt = new Date(Date.now() - 5_000).toISOString();

  await completePlannedWorkout(db, 'plan-complete', {
    title: 'Push', startedAt,
    exercises: [{
      exercise: {
        id: 'exercise-1', name: 'Chest press', movementPattern: 'horizontal_push',
        primaryMuscleGroup: 'chest', secondaryMuscleGroups: ['triceps'], equipment: 'machine',
        targetRepMin: 8, targetRepMax: 12, loadIncrement: 2.5, notes: null, isArchived: false,
      },
      sets: [{ loadValue: 40, loadUnit: 'kg', reps: 8, kind: 'working' }],
    }],
  });

  const workout = queued.get('workouts');
  const set = queued.get('sets');
  assert.equal(workout?.started_at, startedAt);
  assert.notEqual(workout?.completed_at, startedAt);
  assert.equal(workout?.client_updated_at, workout?.completed_at);
  assert.equal(set?.completed_at, workout?.completed_at);
  assert.equal(set?.client_updated_at, workout?.completed_at);
});

test('workout entry shortcuts preserve explicit sets and copy only a valid load', () => {
  const original = [
    { load: '80', reps: '8', rpe: '8' },
    { load: '', reps: '8', rpe: '' },
    { load: '75', reps: '9', rpe: '9' },
    { load: '', reps: '', rpe: '' },
  ];
  const filled = fillBlankWorkoutLoads(original);
  assert.equal(filled.copiedLoad, '80');
  assert.equal(filled.filledCount, 2);
  assert.deepEqual(filled.sets.map((set) => set.load), ['80', '80', '75', '75']);
  assert.equal(latestValidWorkoutLoad(filled.sets), '75');
  assert.equal(original[1]!.load, '');
});

test('live workout summary matches the save boundary without inventing work', () => {
  const summary = summarizeWorkoutDraft([{ sets: [
    { load: '80', reps: '8', rpe: '8' },
    { load: '80', reps: '', rpe: '' },
    { load: 'nope', reps: '10', rpe: '' },
    { load: '0', reps: '12', rpe: '' },
    { load: '', reps: '', rpe: '' },
  ] }]);
  assert.deepEqual(summary, {
    completedSetCount: 2,
    needsAttentionCount: 2,
    blankSetCount: 1,
    work: 640,
  });
});

test('exercise history stays local, completed-only, session-bounded, and links back to its workout', () => {
  const repository = read('../db/workouts.ts');
  const screen = read('../../app/exercises/[id].tsx');
  assert.match(repository, /export async function getExerciseSessionHistory/);
  assert.match(repository, /w\.status = 'completed'/);
  assert.match(repository, /recent\.status = 'completed'/);
  assert.match(repository, /LIMIT \?/);
  assert.match(screen, /pathname: '\/workouts\/\[id\]'/);
  assert.match(screen, /Use latest session as template/);
  assert.doesNotMatch(screen, /1RM|max effort/i);
});
