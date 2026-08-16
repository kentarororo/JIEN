import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseWebDatabaseSnapshot,
  parseWebDatabaseSnapshotState,
  hasSQLiteFileHeader,
  webDatabaseStorageName,
  type WebDatabaseSnapshot,
  type WebDatabaseSnapshotState,
} from './web-database-snapshot.ts';

const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';

test('web database storage is account-scoped and rejects unverified identifiers', () => {
  assert.equal(webDatabaseStorageName(OWNER_A), `jien-web-sqlite-v1:${OWNER_A}`);
  assert.notEqual(webDatabaseStorageName(OWNER_A), webDatabaseStorageName(OWNER_B));
  assert.throws(() => webDatabaseStorageName('someone@example.com'), /verified account/i);
});

test('snapshot envelope restores only the authenticated owner and supported format', () => {
  const bytes = Uint8Array.from([83, 81, 76, 105, 116, 101]).buffer;
  const snapshot: WebDatabaseSnapshot = {
    key: 'snapshot:4:test',
    kind: 'snapshot',
    formatVersion: 1,
    ownerUserId: OWNER_A,
    generation: 4,
    savedAt: '2026-08-16T00:00:00.000Z',
    bytes,
  };

  assert.equal(parseWebDatabaseSnapshot(snapshot, OWNER_A)?.generation, 4);
  assert.throws(() => parseWebDatabaseSnapshot(snapshot, OWNER_B), /does not belong/i);
  assert.throws(
    () => parseWebDatabaseSnapshot({ ...snapshot, formatVersion: 2 }, OWNER_A),
    /app version/i,
  );
});

test('active snapshot state is account-scoped and points to immutable generations', () => {
  const state: WebDatabaseSnapshotState = {
    key: 'active',
    kind: 'state',
    formatVersion: 1,
    ownerUserId: OWNER_A,
    epoch: 'epoch-a',
    generation: 4,
    activeSnapshotKey: 'snapshot:4:test',
    previousSnapshotKey: 'snapshot:3:test',
    quarantinedSnapshotKey: null,
    requiresCloudRebuild: false,
  };
  assert.equal(parseWebDatabaseSnapshotState(state, OWNER_A)?.activeSnapshotKey, 'snapshot:4:test');
  assert.throws(() => parseWebDatabaseSnapshotState(state, OWNER_B), /does not belong/i);
  assert.throws(() => parseWebDatabaseSnapshotState({ ...state, activeSnapshotKey: 4 }, OWNER_A));
  assert.throws(() => parseWebDatabaseSnapshotState({ ...state, epoch: '' }, OWNER_A));
});

test('snapshot parser rejects corrupt generations and byte payloads', () => {
  const base = {
    key: 'snapshot:0:test',
    kind: 'snapshot',
    formatVersion: 1,
    ownerUserId: OWNER_A,
    generation: 0,
    savedAt: '2026-08-16T00:00:00.000Z',
    bytes: new ArrayBuffer(1),
  };
  assert.throws(() => parseWebDatabaseSnapshot({ ...base, generation: -1 }, OWNER_A));
  assert.throws(() => parseWebDatabaseSnapshot({ ...base, bytes: [1, 2, 3] }, OWNER_A));
});

test('SQLite images must have the canonical file header before deserialization', () => {
  assert.equal(hasSQLiteFileHeader(new TextEncoder().encode('SQLite format 3\0payload')), true);
  assert.equal(hasSQLiteFileHeader(new TextEncoder().encode('<html>not sqlite</html>')), false);
  assert.equal(hasSQLiteFileHeader(new Uint8Array()), false);
});
