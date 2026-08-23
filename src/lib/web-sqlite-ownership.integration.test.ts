import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWebSQLiteHandoffRequest,
  createWebSQLiteOwnershipCoordinator,
  WEB_SQLITE_LOCK_NAME,
  type WebSQLiteOwnershipChannel,
} from './web-sqlite-lifecycle.ts';
import { WebWorkerRegistry } from './web-worker-registry.ts';

function createPageEvents() {
  const pageHideListeners = new Set<() => void>();
  const pageShowListeners = new Set<(persisted: boolean) => void>();
  return {
    emitPageHide: () => pageHideListeners.forEach((listener) => listener()),
    emitPageShow: (persisted: boolean) => pageShowListeners.forEach((listener) => listener(persisted)),
    listenPageHide(listener: () => void) {
      pageHideListeners.add(listener);
      return () => pageHideListeners.delete(listener);
    },
    listenPageShow(listener: (persisted: boolean) => void) {
      pageShowListeners.add(listener);
      return () => pageShowListeners.delete(listener);
    },
  };
}

function createChannelHarness() {
  let listener: ((message: unknown) => void) | null = null;
  let closed = false;
  const channel: WebSQLiteOwnershipChannel = {
    close: () => {
      closed = true;
    },
    listen(nextListener) {
      listener = nextListener;
      return () => {
        if (listener === nextListener) listener = null;
      };
    },
    postMessage: () => undefined,
  };
  return {
    channel,
    emit: (message: unknown) => listener?.(message),
    get closed() {
      return closed;
    },
  };
}

test('the integrated owner waits for the Web Lock and tears down pagehide in order', async () => {
  const events: string[] = [];
  const pageEvents = createPageEvents();
  let acquireLock!: () => void;
  let finishLock!: () => void;
  const lockFinished = new Promise<void>((resolve) => {
    finishLock = resolve;
  });
  const requestLock = (name: string, callback: (lock: unknown) => Promise<void>) => {
    events.push(`request:${name}`);
    return new Promise<void>((resolve, reject) => {
      acquireLock = () => {
        events.push('acquire');
        void callback({ name }).then(() => {
          events.push('release-lock');
          resolve();
          finishLock();
        }, reject);
      };
    });
  };
  class FakeWorker {
    terminate() {
      events.push('terminate-worker');
    }
  }
  const scope = { Worker: FakeWorker };
  const registry = new WebWorkerRegistry<FakeWorker>();
  const coordinator = createWebSQLiteOwnershipCoordinator({
    owner: { startedAt: 100, pageId: 'owner' },
    requestLock,
    installWorkerTracking: () => {
      events.push('install-tracking');
      registry.install(scope);
    },
    terminateWorkers: () => registry.shutdown(),
    reload: () => events.push('reload'),
    listenPageHide: pageEvents.listenPageHide,
    listenPageShow: pageEvents.listenPageShow,
    waitForHandoff: async () => {
      events.push('settle');
    },
    onReady: () => events.push('ready'),
    onDisplaced: () => events.push('displaced'),
    onFailure: () => events.push('failure'),
  });

  await Promise.resolve();
  assert.deepEqual(events, ['install-tracking', `request:${WEB_SQLITE_LOCK_NAME}`]);

  acquireLock();
  await coordinator.startup;
  new scope.Worker();
  coordinator.registerDatabaseCloser(() => events.push('close-database'));
  pageEvents.emitPageHide();
  await lockFinished;

  assert.deepEqual(events, [
    'install-tracking',
    `request:${WEB_SQLITE_LOCK_NAME}`,
    'acquire',
    'settle',
    'ready',
    'close-database',
    'terminate-worker',
    'release-lock',
  ]);

  pageEvents.emitPageShow(true);
  assert.equal(events.at(-1), 'reload');
  coordinator.dispose();
});

test('a newer-tab handoff closes SQLite, kills late workers, and releases ownership', async () => {
  const events: string[] = [];
  const pageEvents = createPageEvents();
  const channelHarness = createChannelHarness();
  class FakeWorker {
    terminated = false;

    terminate() {
      this.terminated = true;
      events.push('terminate-worker');
    }
  }
  const scope = { Worker: FakeWorker };
  const registry = new WebWorkerRegistry<FakeWorker>();
  const coordinator = createWebSQLiteOwnershipCoordinator({
    owner: { startedAt: 100, pageId: 'older' },
    requestLock: async (_name, callback) => {
      await callback({});
      events.push('release-lock');
    },
    installWorkerTracking: () => registry.install(scope),
    terminateWorkers: () => registry.shutdown(),
    reload: () => events.push('reload'),
    listenPageHide: pageEvents.listenPageHide,
    listenPageShow: pageEvents.listenPageShow,
    createChannel: () => channelHarness.channel,
    waitForHandoff: () => Promise.resolve(),
    onReady: () => events.push('ready'),
    onDisplaced: () => events.push('displaced'),
    onFailure: () => events.push('failure'),
  });

  await coordinator.startup;
  const sqliteWorker = new scope.Worker();
  coordinator.registerDatabaseCloser(() => events.push('close-database'));
  channelHarness.emit(createWebSQLiteHandoffRequest({ startedAt: 101, pageId: 'newer' }));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(events, [
    'ready',
    'close-database',
    'terminate-worker',
    'displaced',
    'release-lock',
  ]);
  assert.equal(sqliteWorker.terminated, true);

  const lateWorker = new scope.Worker();
  assert.equal(lateWorker.terminated, true);
  assert.equal(registry.size, 0);
  coordinator.dispose();
  assert.equal(channelHarness.closed, true);
});

test('startup failure and explicit retry both shut down tracking before navigation', async () => {
  const events: string[] = [];
  const pageEvents = createPageEvents();
  class FakeWorker {
    terminate() {
      events.push('terminate-worker');
    }
  }
  const scope = { Worker: FakeWorker };
  const registry = new WebWorkerRegistry<FakeWorker>();
  const coordinator = createWebSQLiteOwnershipCoordinator({
    owner: { startedAt: 100, pageId: 'owner' },
    requestLock: () => Promise.reject(new Error('lock unavailable')),
    installWorkerTracking: () => {
      registry.install(scope);
      new scope.Worker();
    },
    terminateWorkers: () => {
      events.push('shutdown-tracking');
      registry.shutdown();
    },
    reload: () => events.push('reload'),
    listenPageHide: pageEvents.listenPageHide,
    listenPageShow: pageEvents.listenPageShow,
    waitForHandoff: () => Promise.resolve(),
    onReady: () => events.push('ready'),
    onDisplaced: () => events.push('displaced'),
    onFailure: () => events.push('failure'),
  });

  await coordinator.startup;
  assert.deepEqual(events, ['shutdown-tracking', 'terminate-worker', 'failure']);

  coordinator.closeBeforeReload();
  events.push('navigate');
  assert.deepEqual(events, ['shutdown-tracking', 'terminate-worker', 'failure', 'navigate']);
  coordinator.dispose();
});
