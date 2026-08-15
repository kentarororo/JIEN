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
