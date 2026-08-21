import assert from 'node:assert/strict';
import test from 'node:test';

import { averageSleepDuration, formatSleepDuration, normalizeSleepInput } from './sleep-record.ts';

test('normalizes a useful manual sleep entry without inventing values', () => {
  assert.deepEqual(normalizeSleepInput({
    sleepDurationMinutes: 455,
    sleepQualityScore: 4,
    notes: '  Woke once.  ',
  }), {
    sleepDurationMinutes: 455,
    sleepQualityScore: 4,
    notes: 'Woke once.',
  });
});

test('rejects empty, impossible, and coercible sleep records', () => {
  assert.throws(
    () => normalizeSleepInput({ sleepDurationMinutes: null, sleepQualityScore: null, notes: '   ' }),
    /Add sleep duration/,
  );
  assert.throws(
    () => normalizeSleepInput({ sleepDurationMinutes: 1_441, sleepQualityScore: null, notes: '' }),
    /between 0 and 24 hours/,
  );
  assert.throws(
    () => normalizeSleepInput({ sleepDurationMinutes: 450.5, sleepQualityScore: null, notes: '' }),
    /between 0 and 24 hours/,
  );
  assert.throws(
    () => normalizeSleepInput({ sleepDurationMinutes: null, sleepQualityScore: 0, notes: '' }),
    /from 1 to 5/,
  );
});

test('formats and averages sleep durations for compact history cards', () => {
  assert.equal(formatSleepDuration(455), '7 hr 35 min');
  assert.equal(formatSleepDuration(480), '8 hr');
  assert.equal(formatSleepDuration(null), 'Duration not entered');
  assert.equal(averageSleepDuration([
    { sleepDurationMinutes: 420 },
    { sleepDurationMinutes: null },
    { sleepDurationMinutes: 480 },
  ]), 450);
  assert.equal(averageSleepDuration([{ sleepDurationMinutes: null }]), null);
});
