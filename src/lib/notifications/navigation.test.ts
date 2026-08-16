import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getDeliveredNotificationType, getNotificationHref } from './navigation.ts';

test('notification navigation accepts only exact in-app destinations', () => {
  assert.equal(getNotificationHref({ href: '/meals/new' }), '/meals/new');
  assert.equal(getNotificationHref({ href: '/settings' }), '/settings');
  assert.equal(getNotificationHref({ href: '/workouts/8e243ba0-24d7-4e91-9a31-b16ea1f47a80' }), '/workouts/8e243ba0-24d7-4e91-9a31-b16ea1f47a80');
  assert.equal(getNotificationHref({ href: 'https://example.com' }), null);
  assert.equal(getNotificationHref({ href: '/settings/account' }), null);
  assert.equal(getNotificationHref({ href: '/workouts/not-a-uuid' }), null);
  assert.equal(getNotificationHref(null), null);
});

test('delivery telemetry accepts only the three configured categories', () => {
  assert.equal(getDeliveredNotificationType({ type: 'meal_gap' }), 'meal_gap');
  assert.equal(getDeliveredNotificationType({ type: 'workout_plan' }), 'workout_plan');
  assert.equal(getDeliveredNotificationType({ type: 'sync_issue' }), 'sync_issue');
  assert.equal(getDeliveredNotificationType({ type: 'new_category' }), null);
  assert.equal(getDeliveredNotificationType(null), null);
});

test('the app runtime opens only validated notification destinations', () => {
  const runtime = readFileSync(new URL('../../components/app-runtime.tsx', import.meta.url), 'utf8');
  const notifications = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(runtime, /addNotificationResponseReceivedListener/);
  assert.match(runtime, /addNotificationReceivedListener/);
  assert.match(runtime, /getPresentedNotificationsAsync/);
  assert.match(runtime, /getNotificationHref/);
  assert.match(runtime, /markNotificationDelivered/);
  assert.match(notifications, /href: '\/meals\/new'/);
  assert.match(notifications, /href: '\/settings'/);
  assert.match(notifications, /href: `\/workouts\/\$\{planned\.id\}`/);
});

test('meal, workout, plan, and sync outcomes all signal notification reconciliation', () => {
  const nutrition = readFileSync(new URL('../db/nutrition.ts', import.meta.url), 'utf8');
  const workouts = readFileSync(new URL('../db/workouts.ts', import.meta.url), 'utf8');
  const syncQueue = readFileSync(new URL('../db/sync-queue.ts', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../../components/app-runtime.tsx', import.meta.url), 'utf8');

  assert.match(nutrition, /export async function saveMeal[\s\S]*?enqueueUpsert\(db, 'meals'/);
  assert.match(nutrition, /export async function updateMeal[\s\S]*?enqueueUpsert\(db, 'meals'/);
  assert.match(nutrition, /export async function deleteMeal[\s\S]*?enqueueUpsert\(db, 'meals'/);
  assert.match(workouts, /export async function savePlannedWorkout[\s\S]*?enqueueUpsert\(db, 'workouts'/);
  assert.match(workouts, /export async function completePlannedWorkout[\s\S]*?enqueueUpsert\(db, 'workouts'/);
  assert.match(workouts, /export async function skipPlannedWorkout[\s\S]*?enqueueUpsert\(db, 'workouts'/);
  assert.match(syncQueue, /DELETE FROM sync_queue[\s\S]*?announceQueuedLocalWrite\(\)/);
  assert.match(syncQueue, /UPDATE sync_queue[\s\S]*?announceQueuedLocalWrite\(\)/);
  assert.match(runtime, /subscribeToQueuedLocalWrites[\s\S]*?reconcile\(\)/);
});
