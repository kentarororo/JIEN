import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSyncQueueFailureUpdate,
  classifySyncFailure,
  computeSyncRetryDelayMs,
  shouldResetPausedSyncFailures,
  SYNC_RETRY_MAX_MS,
} from './sync-policy.ts';

test('classifies network, timeout, rate limit, and server failures as transient', () => {
  assert.equal(classifySyncFailure(Object.assign(new TypeError('Failed to fetch'), { code: 'NETWORK_ERROR', status: 0 })).category, 'network');
  assert.equal(classifySyncFailure({ status: 408, message: 'Request timed out' }).category, 'timeout');
  assert.equal(classifySyncFailure({ status: 429, message: 'Too many requests' }).category, 'rate_limited');
  assert.equal(classifySyncFailure({ status: 503, message: 'Provider unavailable' }).category, 'server');
  for (const cause of [
    Object.assign(new TypeError('Failed to fetch'), { code: 'NETWORK_ERROR' }),
    { status: 408 }, { status: 429 }, { status: 503 },
  ]) assert.equal(classifySyncFailure(cause).disposition, 'transient');
});

test('classifies auth, RLS, validation, schema, and configuration failures as action-required', () => {
  const cases = [
    [{ status: 401, message: 'JWT expired' }, 'authentication'],
    [{ code: '42501', message: 'new row violates row-level security policy' }, 'authorization'],
    [{ status: 422, message: 'invalid payload' }, 'validation'],
    [{ code: '42703', message: 'column does not exist' }, 'schema'],
    [new Error('Supabase is not configured.'), 'configuration'],
  ] as const;
  for (const [cause, category] of cases) {
    const result = classifySyncFailure(cause);
    assert.equal(result.disposition, 'action_required');
    assert.equal(result.category, category);
    assert.doesNotMatch(result.safeMessage, /jwt|row-level|42703/i);
  }
});

test('uses bounded exponential backoff with deterministic jitter injection', () => {
  assert.equal(computeSyncRetryDelayMs(1, () => 0), 45_000);
  assert.equal(computeSyncRetryDelayMs(1, () => 0.5), 60_000);
  assert.equal(computeSyncRetryDelayMs(2, () => 1), 150_000);
  assert.equal(computeSyncRetryDelayMs(99, () => 1), SYNC_RETRY_MAX_MS);
});

test('transient rows receive a future retry while permanent rows pause without being discarded', () => {
  const transient = buildSyncQueueFailureUpdate(
    1,
    { status: 503, message: 'raw provider output' },
    Date.parse('2026-08-14T00:00:00.000Z'),
    () => 0.5,
  );
  assert.equal(transient.attemptCount, 2);
  assert.equal(transient.retryPaused, false);
  assert.equal(transient.nextAttemptAt, '2026-08-14T00:02:00.000Z');
  assert.doesNotMatch(transient.safeMessage, /raw provider output/);

  const permanent = buildSyncQueueFailureUpdate(0, { status: 401, message: 'secret token expired' });
  assert.equal(permanent.attemptCount, 1);
  assert.equal(permanent.retryPaused, true);
  assert.equal(permanent.nextAttemptAt, null);
  assert.equal(permanent.failureCode, 'AUTHENTICATION');
  assert.doesNotMatch(permanent.safeMessage, /secret token/);
});

test('only deliberate manual or authentication changes reset paused rows', () => {
  assert.equal(shouldResetPausedSyncFailures('background'), false);
  assert.equal(shouldResetPausedSyncFailures('manual'), true);
  assert.equal(shouldResetPausedSyncFailures('auth_state_change'), true);
});
