import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { fillBlankWorkoutLoads, latestValidWorkoutLoad, summarizeWorkoutDraft } from '../workout-draft.ts';

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
