import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWebSQLiteHandoffRequest,
  createWebSQLitePageLifecycle,
  requestWebSQLiteLease,
  shouldYieldWebSQLiteOwnership,
  WEB_SQLITE_LOCK_NAME,
} from './web-sqlite-lifecycle.ts';

test('a newer page wins SQLite ownership without two pages yielding at once', () => {
  const older = { startedAt: 100, pageId: 'older' };
  const newer = { startedAt: 101, pageId: 'newer' };

  assert.equal(
    shouldYieldWebSQLiteOwnership(older, createWebSQLiteHandoffRequest(newer)),
    true,
  );
  assert.equal(
    shouldYieldWebSQLiteOwnership(newer, createWebSQLiteHandoffRequest(older)),
    false,
  );
});

test('page ID deterministically breaks a same-millisecond ownership tie', () => {
  const first = { startedAt: 100, pageId: 'a' };
  const second = { startedAt: 100, pageId: 'b' };

  assert.equal(
    shouldYieldWebSQLiteOwnership(first, createWebSQLiteHandoffRequest(second)),
    true,
  );
  assert.equal(
    shouldYieldWebSQLiteOwnership(second, createWebSQLiteHandoffRequest(first)),
    false,
  );
  assert.equal(shouldYieldWebSQLiteOwnership(first, { type: 'request-ownership' }), false);
});

test('holds the origin lease until the database owner releases it', async () => {
  const events: string[] = [];
  let finishLock!: () => void;
  const lockFinished = new Promise<void>((resolve) => {
    finishLock = resolve;
  });
  const lease = requestWebSQLiteLease(async (name, callback) => {
    events.push(`request:${name}`);
    await callback({ name });
    events.push('released');
    finishLock();
  });

  await lease.acquired;
  assert.deepEqual(events, [`request:${WEB_SQLITE_LOCK_NAME}`]);

  lease.release();
  await lockFinished;
  await lease.finished;
  assert.deepEqual(events, [`request:${WEB_SQLITE_LOCK_NAME}`, 'released']);
});

test('closes the database before releasing the page lease', () => {
  const events: string[] = [];
  const lifecycle = createWebSQLitePageLifecycle({
    closeDatabaseSync: () => events.push('close'),
    terminateWorkers: () => events.push('terminate'),
    releaseLease: () => events.push('release'),
    reload: () => events.push('reload'),
  });

  lifecycle.closeForPageTransition();
  lifecycle.closeForPageTransition();

  assert.deepEqual(events, ['close', 'terminate', 'release']);
});

test('can own the page before SQLite opens and register its closer later', () => {
  const events: string[] = [];
  const lifecycle = createWebSQLitePageLifecycle({
    terminateWorkers: () => events.push('terminate'),
    releaseLease: () => events.push('release'),
    reload: () => events.push('reload'),
  });
  lifecycle.registerDatabaseCloser(() => events.push('close'));

  lifecycle.closeForPageTransition();

  assert.deepEqual(events, ['close', 'terminate', 'release']);
});

test('a startup handoff still terminates workers and releases the lease', () => {
  const events: string[] = [];
  const lifecycle = createWebSQLitePageLifecycle({
    terminateWorkers: () => events.push('terminate'),
    releaseLease: () => events.push('release'),
    reload: () => events.push('reload'),
  });

  lifecycle.closeForPageTransition();
  lifecycle.registerDatabaseCloser(() => events.push('late-close'));

  assert.deepEqual(events, ['terminate', 'release']);
});

test('releases the page lease even if SQLite close reports an error', () => {
  const events: string[] = [];
  const lifecycle = createWebSQLitePageLifecycle({
    closeDatabaseSync: () => {
      events.push('close');
      throw new Error('already closed');
    },
    terminateWorkers: () => events.push('terminate'),
    releaseLease: () => events.push('release'),
    reload: () => events.push('reload'),
  });

  assert.throws(() => lifecycle.closeForPageTransition(), /already closed/);
  assert.deepEqual(events, ['close', 'terminate', 'release']);
});

test('reloads a restored page whose database was closed for pagehide', () => {
  let reloads = 0;
  const lifecycle = createWebSQLitePageLifecycle({
    closeDatabaseSync: () => undefined,
    terminateWorkers: () => undefined,
    releaseLease: () => undefined,
    reload: () => {
      reloads += 1;
    },
  });

  lifecycle.restoreAfterPageTransition();
  assert.equal(reloads, 0);

  lifecycle.closeForPageTransition();
  lifecycle.restoreAfterPageTransition();
  assert.equal(reloads, 1);
});
