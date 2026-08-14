import assert from 'node:assert/strict';
import test from 'node:test';

import {
  needsFullReconciliation,
  hasAccountConflict,
  preserveLocalAiMetadata,
  serializeCloudValue,
} from './cloud-sync-mappers.ts';

test('serializes Supabase arrays and json objects for SQLite', () => {
  assert.equal(serializeCloudValue(['cable', 'machine']), '["cable","machine"]');
  assert.equal(serializeCloudValue({ heightCm: 175 }), '{"heightCm":175}');
});

test('serializes Postgres booleans without changing scalar values', () => {
  assert.equal(serializeCloudValue(true), 1);
  assert.equal(serializeCloudValue(false), 0);
  assert.equal(serializeCloudValue('2026-08-14T00:00:00Z'), '2026-08-14T00:00:00Z');
  assert.equal(serializeCloudValue(null), null);
});

test('preserves device-only AI retry metadata until a request completes', () => {
  assert.equal(preserveLocalAiMetadata('pending'), true);
  assert.equal(preserveLocalAiMetadata('failed'), true);
  assert.equal(preserveLocalAiMetadata('complete'), false);
});

test('runs periodic full reconciliation for late offline rows', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-08-14T12:00:00Z');
  assert.equal(needsFullReconciliation(null, now, day), true);
  assert.equal(needsFullReconciliation('invalid', now, day), true);
  assert.equal(needsFullReconciliation('2026-08-13T11:59:59Z', now, day), true);
  assert.equal(needsFullReconciliation('2026-08-14T11:00:00Z', now, day), false);
});

test('blocks only a different account from an already-owned local database', () => {
  assert.equal(hasAccountConflict(null, 'user-a'), false);
  assert.equal(hasAccountConflict('user-a', 'user-a'), false);
  assert.equal(hasAccountConflict('user-a', 'user-b'), true);
});
