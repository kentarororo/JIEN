import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveAccountEntry,
  retryableAuthFailure,
  routeForLocalEntry,
} from './account-entry.ts';

test('completed local profile enters the app even while signed out', () => {
  assert.deepEqual(resolveAccountEntry(true, { state: 'signed_out' }), { kind: 'app' });
});

test('returning signed-in account enters the app after cloud restore completes', () => {
  assert.deepEqual(
    resolveAccountEntry(true, { state: 'synced', profileRestored: true }),
    { kind: 'app' },
  );
});

test('signed-in account without a completed profile continues to onboarding', () => {
  assert.deepEqual(
    resolveAccountEntry(false, { state: 'synced', profileRestored: false }),
    { kind: 'onboarding' },
  );
});

test('an incomplete restored profile continues to onboarding instead of account entry', () => {
  assert.deepEqual(
    resolveAccountEntry(false, { state: 'synced', profileRestored: true }),
    { kind: 'onboarding' },
  );
});

test('fresh device opens account-first welcome instead of onboarding', () => {
  assert.deepEqual(
    resolveAccountEntry(false, { state: 'signed_out' }),
    { kind: 'welcome', notice: null, noticeTone: 'neutral' },
  );
});

test('explicit local setup is the only welcome action that opens onboarding', () => {
  assert.equal(routeForLocalEntry(false), '/onboarding');
  assert.equal(routeForLocalEntry(true), '/(tabs)/today');
});

test('authentication failures remain retryable', () => {
  assert.deepEqual(retryableAuthFailure(new Error('OAuth was cancelled')), {
    message: 'OAuth was cancelled',
    retryable: true,
  });
});

test('account conflict is visible and never authorizes a cloud write', () => {
  const decision = resolveAccountEntry(true, { state: 'account_conflict' });
  assert.equal(decision.kind, 'account_conflict');
  if (decision.kind === 'account_conflict') {
    assert.equal(decision.mayWriteToCloud, false);
    assert.match(decision.message, /No records were merged or uploaded/i);
  }
});

test('offline restore falls back to a usable welcome path', () => {
  const decision = resolveAccountEntry(false, { state: 'offline' });
  assert.equal(decision.kind, 'welcome');
  if (decision.kind === 'welcome') assert.match(decision.notice ?? '', /continue locally/i);
});

test('action-required restore failures stay visible on the welcome path', () => {
  const decision = resolveAccountEntry(false, {
    state: 'action_required',
    error: 'Cloud sync needs an app or database update before it can continue.',
  });
  assert.equal(decision.kind, 'welcome');
  if (decision.kind === 'welcome') {
    assert.equal(decision.noticeTone, 'warning');
    assert.match(decision.notice ?? '', /database update/i);
  }
});
