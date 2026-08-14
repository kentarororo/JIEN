import assert from 'node:assert/strict';
import test from 'node:test';

import { localTimestampForDate, toLocalDateKey } from './time.ts';

test('creates a local timestamp on the selected calendar day', () => {
  const timestamp = localTimestampForDate('2026-07-12', new Date(2026, 7, 14, 18, 25, 30));
  assert.equal(toLocalDateKey(new Date(timestamp)), '2026-07-12');
  assert.equal(new Date(timestamp).getHours(), 18);
});

test('rejects calendar rollover dates', () => {
  assert.throws(() => localTimestampForDate('2026-02-30'), /valid calendar date/);
});
