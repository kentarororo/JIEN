import assert from 'node:assert/strict';
import test from 'node:test';

import { getWorkoutPlanTrigger } from './workout-plan-policy.ts';

test('planned workout reminder uses the configured lead time', () => {
  const trigger = getWorkoutPlanTrigger({
    enabled: true,
    scheduledAt: '2026-08-20T10:00:00.000Z',
    leadMinutes: 60,
    quietHoursStart: null,
    quietHoursEnd: null,
    now: new Date('2026-08-20T06:00:00.000Z'),
  });
  assert.equal(trigger?.toISOString(), '2026-08-20T09:00:00.000Z');
});

test('past, disabled, and quiet-hour-stale plans do not notify', () => {
  const now = new Date(2026, 7, 20, 23, 0);
  assert.equal(getWorkoutPlanTrigger({ enabled: false, scheduledAt: new Date(now.getTime() + 60_000).toISOString(), leadMinutes: 0, quietHoursStart: null, quietHoursEnd: null, now }), null);
  assert.equal(getWorkoutPlanTrigger({ enabled: true, scheduledAt: new Date(now.getTime() - 60_000).toISOString(), leadMinutes: 0, quietHoursStart: null, quietHoursEnd: null, now }), null);
  assert.equal(getWorkoutPlanTrigger({ enabled: true, scheduledAt: new Date(2026, 7, 21, 7, 0).toISOString(), leadMinutes: 60, quietHoursStart: '22:00', quietHoursEnd: '08:00', now }), null);
});

test('planned workout cooldown moves delivery only while the plan is still actionable', () => {
  const delayed = getWorkoutPlanTrigger({
    enabled: true,
    scheduledAt: '2026-08-20T10:00:00.000Z',
    leadMinutes: 60,
    quietHoursStart: null,
    quietHoursEnd: null,
    lastNotifiedAt: '2026-08-20T08:30:00.000Z',
    minimumIntervalMinutes: 60,
    now: new Date('2026-08-20T06:00:00.000Z'),
  });
  const stale = getWorkoutPlanTrigger({
    enabled: true,
    scheduledAt: '2026-08-20T10:00:00.000Z',
    leadMinutes: 60,
    quietHoursStart: null,
    quietHoursEnd: null,
    lastNotifiedAt: '2026-08-20T09:30:00.000Z',
    minimumIntervalMinutes: 60,
    now: new Date('2026-08-20T06:00:00.000Z'),
  });
  assert.equal(delayed?.toISOString(), '2026-08-20T09:30:00.000Z');
  assert.equal(stale, null);
});
