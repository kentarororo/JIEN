import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
});

test('calendar, start flow, and reminders all invalidate stale plans', () => {
  const calendar = read('../../app/(tabs)/today.tsx');
  const logger = read('../../app/workouts/new.tsx');
  const runtime = read('../../components/app-runtime.tsx');
  const notifications = read('../notifications/index.ts');
  assert.match(calendar, /listPlannedWorkoutsForDate/);
  assert.match(calendar, /pathname: '\/workouts\/plan'/);
  assert.match(logger, /completePlannedWorkout/);
  assert.match(runtime, /subscribeToQueuedLocalWrites/);
  assert.match(notifications, /reconcileWorkoutPlanNotification/);
  assert.match(notifications, /cancelWorkoutPlanNotification/);
  assert.match(notifications, /scheduled_workout_plan_key/);
});
