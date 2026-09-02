import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAccountSyncHealth,
  parseAccountSyncHealth,
  recordAccountSyncHealth,
  subscribeToAccountSyncHealth,
} from './sync-health.ts';

test('a successful account sync records its exact local outcome', () => {
  const health = buildAccountSyncHealth(null, {
    state: 'synced',
    pushed: 3,
    pulled: 8,
    profileRestored: true,
  }, '2026-09-02T02:00:00.000Z');

  assert.deepEqual(health, {
    schemaVersion: 1,
    state: 'synced',
    lastAttemptAt: '2026-09-02T02:00:00.000Z',
    lastSuccessAt: '2026-09-02T02:00:00.000Z',
    pushed: 3,
    pulled: 8,
    profileRestored: true,
    code: null,
    safeMessage: null,
  });
});

test('a later failure preserves the last successful sync time and only stores safe details', () => {
  const previous = buildAccountSyncHealth(null, { state: 'synced' }, '2026-09-02T02:00:00.000Z');
  const health = buildAccountSyncHealth(previous, {
    state: 'action_required',
    error: 'Your sign-in needs attention. Sign in again, then retry sync.',
    code: 'AUTHENTICATION',
  }, '2026-09-02T03:00:00.000Z');

  assert.equal(health.lastSuccessAt, previous.lastSuccessAt);
  assert.equal(health.safeMessage, 'Your sign-in needs attention. Sign in again, then retry sync.');
  assert.equal(health.code, 'AUTHENTICATION');
});

test('stored sync health is strictly parsed and malformed diagnostics are ignored', () => {
  const valid = parseAccountSyncHealth(JSON.stringify({
    schemaVersion: 1,
    state: 'offline',
    lastAttemptAt: '2026-09-02T03:00:00Z',
    lastSuccessAt: '2026-09-02T02:00:00Z',
    pushed: 0,
    pulled: 0,
    profileRestored: false,
    code: null,
    safeMessage: null,
  }));
  assert.equal(valid?.lastAttemptAt, '2026-09-02T03:00:00.000Z');
  assert.equal(parseAccountSyncHealth('{broken'), null);
  assert.equal(parseAccountSyncHealth(JSON.stringify({ schemaVersion: 1, state: 'invented', lastAttemptAt: 'now' })), null);
});

test('committing sync health notifies the mounted status surface once', async () => {
  const settings = new Map<string, string>();
  const db = {
    getFirstAsync: async (_sql: string, key: string[]) => {
      const value = settings.get(key[0]!);
      return value == null ? null : { value };
    },
    runAsync: async (_sql: string, values: string[]) => {
      settings.set(values[0]!, values[1]!);
      return { changes: 1, lastInsertRowId: 0 };
    },
  };
  let notifications = 0;
  const unsubscribe = subscribeToAccountSyncHealth(() => { notifications += 1; });
  await recordAccountSyncHealth(db as never, { state: 'synced' }, '2026-09-02T04:00:00.000Z');
  unsubscribe();
  await recordAccountSyncHealth(db as never, { state: 'offline' }, '2026-09-02T05:00:00.000Z');
  assert.equal(notifications, 1);
});
