import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wellnessSource = readFileSync(new URL('./wellness.ts', import.meta.url), 'utf8');
const calendarSource = readFileSync(new URL('./calendar.ts', import.meta.url), 'utf8');
const todaySource = readFileSync(new URL('../../app/(tabs)/today.tsx', import.meta.url), 'utf8');

test('sleep create, edit, and removal stay inside the offline-first write boundary', () => {
  assert.match(wellnessSource, /export async function saveSleepLog[\s\S]*?withExclusiveTransaction[\s\S]*?enqueueUpsert\(db, 'wellness_logs'/);
  assert.match(wellnessSource, /export async function updateSleepLog[\s\S]*?withExclusiveTransaction[\s\S]*?enqueueUpsert\(db, 'wellness_logs'/);
  assert.match(wellnessSource, /export async function deleteSleepLog[\s\S]*?SET deleted_at = \?[\s\S]*?enqueueUpsert\(db, 'wellness_logs'/);
  assert.match(wellnessSource, /kind: 'sleep'/);
  assert.match(wellnessSource, /existing\.source !== 'manual'[\s\S]*?Imported sleep entries are read-only/);
});

test('calendar sleep activity excludes tombstones and opens itemized edit records', () => {
  assert.match(calendarSource, /kind = 'sleep'[\s\S]*?deleted_at IS NULL/);
  assert.match(calendarSource, /sleepLogCount: row\.sleep_count/);
  assert.match(todaySource, /listSleepLogsForDate/);
  assert.match(todaySource, /pathname: '\/wellness\/sleep', params: \{ id: sleep\.id, date: sleep\.loggedOn \}/);
  assert.match(todaySource, /Review · Edit/);
});
