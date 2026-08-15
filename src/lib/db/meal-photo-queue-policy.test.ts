import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canRetryMealPhoto,
  MAX_MEAL_PHOTO_ATTEMPTS,
  nextMealPhotoAttemptAt,
} from './meal-photo-queue-policy.ts';

test('queued meal photos use bounded exponential retry timing', () => {
  const start = Date.parse('2026-08-15T00:00:00.000Z');
  assert.equal(nextMealPhotoAttemptAt(1, start), '2026-08-15T00:01:00.000Z');
  assert.equal(nextMealPhotoAttemptAt(2, start), '2026-08-15T00:02:00.000Z');
  assert.equal(nextMealPhotoAttemptAt(5, start), '2026-08-15T00:16:00.000Z');
  assert.equal(nextMealPhotoAttemptAt(99, start), '2026-08-15T00:16:00.000Z');
});

test('automatic photo retries stop after the bounded attempt count', () => {
  assert.equal(canRetryMealPhoto(true, MAX_MEAL_PHOTO_ATTEMPTS - 1), true);
  assert.equal(canRetryMealPhoto(true, MAX_MEAL_PHOTO_ATTEMPTS), false);
  assert.equal(canRetryMealPhoto(false, 1), false);
});

test('runtime and migration keep the photo queue local and recoverable', () => {
  const migration = readFileSync(new URL('./migrate.ts', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../../components/app-runtime.tsx', import.meta.url), 'utf8');
  const sync = readFileSync(new URL('./cloud-sync.ts', import.meta.url), 'utf8');
  const queue = readFileSync(new URL('./meal-photo-queue.ts', import.meta.url), 'utf8');
  const foodScreen = readFileSync(new URL('../../app/(tabs)/food.tsx', import.meta.url), 'utf8');
  const mealScreen = readFileSync(new URL('../../app/meals/new.tsx', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS meal_photo_jobs/);
  assert.match(runtime, /processPendingMealPhotoJobs/);
  assert.doesNotMatch(sync, /meal_photo_jobs/, 'raw queued images must never enter Supabase row sync');
  assert.match(queue, /SET image_base64 = '', status = 'completed'/, 'successful jobs must clear raw photos');
  assert.match(foodScreen, /Review latest result/);
  assert.match(mealScreen, /consumeQueuedMealPhotoResult/);
});
