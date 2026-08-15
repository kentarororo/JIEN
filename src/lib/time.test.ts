import assert from 'node:assert/strict';
import test from 'node:test';

import { localTimestampForDate, localTimestampForDateAndTime, toLocalDateKey } from './time.ts';

test('creates a local timestamp on the selected calendar day', () => {
  const timestamp = localTimestampForDate('2026-07-12', new Date(2026, 7, 14, 18, 25, 30));
  assert.equal(toLocalDateKey(new Date(timestamp)), '2026-07-12');
  assert.equal(new Date(timestamp).getHours(), 18);
});

test('rejects calendar rollover dates', () => {
  assert.throws(() => localTimestampForDate('2026-02-30'), /valid calendar date/);
});

test('creates a local scheduled timestamp from a calendar day and clock time', () => {
  const value = localTimestampForDateAndTime('2026-08-20', '18:30');
  const date = new Date(value);
  assert.equal(toLocalDateKey(date), '2026-08-20');
  assert.equal(date.getHours(), 18);
  assert.equal(date.getMinutes(), 30);
});

test('rejects invalid planned-workout times', () => {
  assert.throws(() => localTimestampForDateAndTime('2026-08-20', '25:00'));
  assert.throws(() => localTimestampForDateAndTime('2026-08-20', '6pm'));
});
