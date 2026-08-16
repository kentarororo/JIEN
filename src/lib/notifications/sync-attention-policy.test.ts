import assert from 'node:assert/strict';
import test from 'node:test';

import { getSyncAttentionTrigger } from './sync-attention-policy.ts';

test('sync attention requires explicit opt-in and an action-required failure', () => {
  const now = new Date('2026-08-15T12:00:00');
  assert.equal(getSyncAttentionTrigger({ enabled: false, actionRequiredCount: 2, quietHoursStart: '22:00', quietHoursEnd: '08:00', now }), null);
  assert.equal(getSyncAttentionTrigger({ enabled: true, actionRequiredCount: 0, quietHoursStart: '22:00', quietHoursEnd: '08:00', now }), null);
  assert.equal(getSyncAttentionTrigger({ enabled: true, actionRequiredCount: 2, quietHoursStart: '22:00', quietHoursEnd: '08:00', now })?.getTime(), now.getTime() + 5_000);
});

test('sync attention waits until overnight quiet hours end', () => {
  const evening = new Date('2026-08-15T23:30:00');
  const morning = new Date('2026-08-15T07:30:00');
  const eveningTrigger = getSyncAttentionTrigger({ enabled: true, actionRequiredCount: 1, quietHoursStart: '22:00', quietHoursEnd: '08:00', now: evening });
  const morningTrigger = getSyncAttentionTrigger({ enabled: true, actionRequiredCount: 1, quietHoursStart: '22:00', quietHoursEnd: '08:00', now: morning });
  assert.equal(eveningTrigger?.getHours(), 8);
  assert.equal(eveningTrigger?.getDate(), 16);
  assert.equal(morningTrigger?.getHours(), 8);
  assert.equal(morningTrigger?.getDate(), 15);
});

test('Supabase time strings and fractional seconds define quiet hours precisely', () => {
  const evening = new Date('2026-08-15T23:30:00');
  const canonicalTrigger = getSyncAttentionTrigger({
    enabled: true,
    actionRequiredCount: 1,
    quietHoursStart: '22:00:00',
    quietHoursEnd: '08:00:00',
    now: evening,
  });
  const fractionalTrigger = getSyncAttentionTrigger({
    enabled: true,
    actionRequiredCount: 1,
    quietHoursStart: '22:00:00.000000',
    quietHoursEnd: '08:00:00.500000',
    now: evening,
  });

  assert.equal(canonicalTrigger?.getDate(), 16);
  assert.equal(canonicalTrigger?.getHours(), 8);
  assert.equal(canonicalTrigger?.getMinutes(), 0);
  assert.equal(fractionalTrigger?.getMilliseconds(), 500);
});

test('invalid and timezone-qualified quiet-hour clocks are rejected', () => {
  const now = new Date('2026-08-15T23:30:00');
  const expected = now.getTime() + 5_000;
  for (const invalidStart of [
    '24:00:00',
    '22:60:00',
    '22:00:60',
    '22:00:00Z',
    '22:00:00.',
  ]) {
    assert.equal(getSyncAttentionTrigger({
      enabled: true,
      actionRequiredCount: 1,
      quietHoursStart: invalidStart,
      quietHoursEnd: '08:00:00',
      now,
    })?.getTime(), expected);
  }
  assert.equal(getSyncAttentionTrigger({
    enabled: true,
    actionRequiredCount: 1,
    quietHoursStart: '22:00:00',
    quietHoursEnd: '08:00:00+08',
    now,
  })?.getTime(), expected);
});

test('sync attention observes the configured delivery cooldown', () => {
  const trigger = getSyncAttentionTrigger({
    enabled: true,
    actionRequiredCount: 1,
    quietHoursStart: null,
    quietHoursEnd: null,
    lastNotifiedAt: '2026-08-15T11:30:00.000Z',
    minimumIntervalMinutes: 120,
    now: new Date('2026-08-15T12:00:00.000Z'),
  });
  assert.equal(trigger?.toISOString(), '2026-08-15T13:30:00.000Z');
});
