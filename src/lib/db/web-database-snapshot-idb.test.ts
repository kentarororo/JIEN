import assert from 'node:assert/strict';
import test from 'node:test';

import { WebDatabaseSnapshotStore, webDatabaseStorageName } from './web-database-snapshot.ts';

const OWNER = '11111111-1111-4111-8111-111111111111';

test('IndexedDB generations reject stale writers and preserve the committed image', async () => {
  const fake = installFakeIndexedDb();
  try {
    const first = await WebDatabaseSnapshotStore.open(OWNER);
    const stale = await WebDatabaseSnapshotStore.open(OWNER);
    assert.equal(await first.load(), null);
    assert.equal(await stale.load(), null);
    await first.save(Uint8Array.from([1, 2, 3]));
    await assert.rejects(stale.save(Uint8Array.from([9, 9, 9])), /stale/i);

    const restored = await WebDatabaseSnapshotStore.open(OWNER);
    assert.deepEqual([...((await restored.load()) ?? [])], [1, 2, 3]);
    await first.save(Uint8Array.from([4, 5, 6]));
    await assert.rejects(restored.save(Uint8Array.from([7, 8, 9])), /stale/i);

    const latest = await WebDatabaseSnapshotStore.open(OWNER);
    assert.deepEqual([...((await latest.load()) ?? [])], [4, 5, 6]);
  } finally {
    fake.restore();
  }
});

test('invalid active state is quarantined instead of deleting snapshot bytes', async () => {
  const fake = installFakeIndexedDb();
  try {
    const initial = await WebDatabaseSnapshotStore.open(OWNER);
    await initial.load();
    await initial.save(Uint8Array.from([1, 2, 3]));
    const records = fake.databases.get(webDatabaseStorageName(OWNER));
    assert.ok(records);
    const snapshotKeys = [...records.keys()].filter((key) => key.startsWith('snapshot:'));
    records.set('active', { key: 'active', ownerUserId: 'wrong-owner' });

    const recovery = await WebDatabaseSnapshotStore.open(OWNER);
    assert.equal(await recovery.load(), null);
    assert.equal(recovery.needsCloudRebuild, true);
    assert.deepEqual(records.get('active'), {
      key: 'active',
      kind: 'state',
      formatVersion: 1,
      ownerUserId: OWNER,
      epoch: (records.get('active') as { epoch: string }).epoch,
      generation: 0,
      activeSnapshotKey: null,
      previousSnapshotKey: null,
      quarantinedSnapshotKey: null,
      requiresCloudRebuild: true,
    });
    assert.equal(records.has('quarantined-active-state'), true);
    assert.ok(snapshotKeys.every((key) => records.has(key)));

    const reopened = await WebDatabaseSnapshotStore.open(OWNER);
    assert.equal(await reopened.load(), null);
    assert.equal(reopened.needsCloudRebuild, true);
  } finally {
    fake.restore();
  }
});

test('load keeps one atomic generation while two external saves advance the pointer', async () => {
  const fake = installFakeIndexedDb();
  try {
    const writer = await WebDatabaseSnapshotStore.open(OWNER);
    await writer.load();
    await writer.save(Uint8Array.from([1]));

    const reader = await WebDatabaseSnapshotStore.open(OWNER);
    fake.afterNextReadonlyActiveRead(OWNER, () => {
      fake.publishSnapshot(OWNER, Uint8Array.from([2]));
      fake.publishSnapshot(OWNER, Uint8Array.from([3]));
    });
    assert.deepEqual([...((await reader.load()) ?? [])], [1]);

    const latest = await WebDatabaseSnapshotStore.open(OWNER);
    assert.deepEqual([...((await latest.load()) ?? [])], [3]);
    assert.equal(latest.needsCloudRebuild, false);
  } finally {
    fake.restore();
  }
});

test('quarantine CAS wins atomically and rejects a concurrent stale save', async () => {
  const fake = installFakeIndexedDb();
  try {
    const writer = await WebDatabaseSnapshotStore.open(OWNER);
    await writer.load();
    await writer.save(Uint8Array.from([1]));
    const recovery = await WebDatabaseSnapshotStore.open(OWNER);
    assert.deepEqual([...((await recovery.load()) ?? [])], [1]);

    let concurrentSave: Promise<void> | null = null;
    fake.onNextActiveGet(OWNER, () => {
      concurrentSave = writer.save(Uint8Array.from([2]));
    });
    await recovery.quarantineCurrent('test_invalid_image');
    assert.ok(concurrentSave);
    await assert.rejects(concurrentSave, /stale/i);

    const latest = await WebDatabaseSnapshotStore.open(OWNER);
    assert.equal(await latest.load(), null);
    assert.equal(latest.needsCloudRebuild, true);
  } finally {
    fake.restore();
  }
});

test('a stale writer from a quarantined epoch cannot overwrite rebuilt generation one', async () => {
  const fake = installFakeIndexedDb();
  try {
    const initial = await WebDatabaseSnapshotStore.open(OWNER);
    await initial.load();
    await initial.save(Uint8Array.from([1]));
    const stale = await WebDatabaseSnapshotStore.open(OWNER);
    assert.deepEqual([...((await stale.load()) ?? [])], [1]);

    const records = fake.databases.get(webDatabaseStorageName(OWNER));
    assert.ok(records);
    records.set('active', { key: 'active', ownerUserId: 'broken-state' });
    const recovery = await WebDatabaseSnapshotStore.open(OWNER);
    assert.equal(await recovery.load(), null);
    await recovery.save(Uint8Array.from([8]));

    await assert.rejects(stale.save(Uint8Array.from([9])), /stale/i);
    const latest = await WebDatabaseSnapshotStore.open(OWNER);
    assert.deepEqual([...((await latest.load()) ?? [])], [8]);
  } finally {
    fake.restore();
  }
});

type FakeDatabaseState = {
  active: boolean;
  afterReadonlyActiveRead: (() => void) | null;
  nextActiveGet: (() => void) | null;
  queue: Array<{ start: () => void }>;
  records: Map<string, unknown>;
};

function installFakeIndexedDb(): {
  databases: Map<string, Map<string, unknown>>;
  afterNextReadonlyActiveRead: (name: string, callback: () => void) => void;
  onNextActiveGet: (name: string, callback: () => void) => void;
  publishSnapshot: (name: string, bytes: Uint8Array) => void;
  restore: () => void;
} {
  const databases = new Map<string, Map<string, unknown>>();
  const states = new Map<string, FakeDatabaseState>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const factory = {
    open(name: string) {
      const request: Record<string, unknown> = {};
      queueMicrotask(() => {
        const isNew = !states.has(name);
        const state = states.get(name) ?? {
          active: false,
          afterReadonlyActiveRead: null,
          nextActiveGet: null,
          queue: [],
          records: new Map<string, unknown>(),
        };
        states.set(name, state);
        databases.set(name, state.records);
        request.result = createFakeDatabase(state);
        if (isNew) (request.onupgradeneeded as (() => void) | undefined)?.();
        (request.onsuccess as (() => void) | undefined)?.();
      });
      return request;
    },
  };
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory });
  return {
    databases,
    afterNextReadonlyActiveRead: (name, callback) => {
      const state = states.get(webDatabaseStorageName(name)) ?? states.get(name);
      assert.ok(state);
      state.afterReadonlyActiveRead = callback;
    },
    onNextActiveGet: (name, callback) => {
      const state = states.get(webDatabaseStorageName(name)) ?? states.get(name);
      assert.ok(state);
      state.nextActiveGet = callback;
    },
    publishSnapshot: (name, bytes) => {
      const state = states.get(webDatabaseStorageName(name)) ?? states.get(name);
      assert.ok(state);
      publishSnapshot(state.records, bytes);
    },
    restore: () => {
      if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
      else delete (globalThis as { indexedDB?: unknown }).indexedDB;
    },
  };
}

function createFakeDatabase(state: FakeDatabaseState): IDBDatabase {
  return {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    close: () => undefined,
    onversionchange: null,
    transaction: (_name: string, mode: IDBTransactionMode) => createFakeTransaction(state, mode),
  } as unknown as IDBDatabase;
}

function createFakeTransaction(state: FakeDatabaseState, mode: IDBTransactionMode): IDBTransaction {
  type Operation = { execute: () => unknown; request: Record<string, unknown> };
  let working = new Map<string, unknown>();
  const operations: Operation[] = [];
  let started = false;
  let processing = false;
  let aborted = false;
  let completed = false;
  let readActive = false;
  let completionTimer: ReturnType<typeof setTimeout> | null = null;
  const transaction = {
    error: null as DOMException | null,
    oncomplete: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onabort: null as (() => void) | null,
    abort() {
      if (aborted || completed) return;
      aborted = true;
      transaction.error = new DOMException('aborted', 'AbortError');
      if (completionTimer) clearTimeout(completionTimer);
      setTimeout(() => {
        transaction.onabort?.();
        releaseTransaction(state);
      }, 0);
    },
    objectStore() {
      return {
        get: (key: string) => request(() => {
          const value = working.get(key);
          if (key === 'active') {
            readActive = true;
            const hook = state.nextActiveGet;
            state.nextActiveGet = null;
            hook?.();
          }
          return value;
        }),
        put: (value: { key: string }) => request(() => {
          working.set(value.key, structuredClone(value));
          return value.key;
        }),
        delete: (key: string) => request(() => working.delete(key)),
      };
    },
  };
  const schedule = () => {
    if (!started || processing || aborted || completed) return;
    if (completionTimer) clearTimeout(completionTimer);
    const operation = operations.shift();
    if (!operation) {
      completionTimer = setTimeout(() => {
        if (aborted || completed || operations.length) return;
        completed = true;
        if (mode === 'readwrite') replaceRecords(state.records, working);
        if (mode === 'readonly' && readActive) {
          const hook = state.afterReadonlyActiveRead;
          state.afterReadonlyActiveRead = null;
          hook?.();
        }
        transaction.oncomplete?.();
        releaseTransaction(state);
      }, 0);
      return;
    }
    processing = true;
    queueMicrotask(() => {
      if (aborted) return;
      try {
        operation.request.result = operation.execute();
        (operation.request.onsuccess as (() => void) | undefined)?.();
      } catch (cause) {
        operation.request.error = cause;
        (operation.request.onerror as (() => void) | undefined)?.();
        transaction.abort();
      } finally {
        processing = false;
        schedule();
      }
    });
  };
  const request = (operation: () => unknown) => {
    const result: Record<string, unknown> = {};
    operations.push({ execute: operation, request: result });
    schedule();
    return result;
  };
  state.queue.push({
    start: () => {
      started = true;
      working = new Map([...state.records].map(([key, value]) => [key, structuredClone(value)]));
      schedule();
    },
  });
  pumpTransactions(state);
  return transaction as unknown as IDBTransaction;
}

function pumpTransactions(state: FakeDatabaseState): void {
  if (state.active) return;
  const next = state.queue.shift();
  if (!next) return;
  state.active = true;
  next.start();
}

function releaseTransaction(state: FakeDatabaseState): void {
  state.active = false;
  pumpTransactions(state);
}

function replaceRecords(target: Map<string, unknown>, source: Map<string, unknown>): void {
  target.clear();
  for (const [key, value] of source) target.set(key, structuredClone(value));
}

let externalSnapshotSequence = 0;

function publishSnapshot(records: Map<string, unknown>, bytes: Uint8Array): void {
  const current = records.get('active') as {
    activeSnapshotKey: string | null;
    epoch: string;
    generation: number;
    previousSnapshotKey: string | null;
    quarantinedSnapshotKey: string | null;
  };
  assert.ok(current?.epoch);
  const generation = current.generation + 1;
  const snapshotKey = `snapshot:${generation}:external-${externalSnapshotSequence += 1}`;
  records.set(snapshotKey, {
    key: snapshotKey,
    kind: 'snapshot',
    formatVersion: 1,
    ownerUserId: OWNER,
    generation,
    savedAt: new Date().toISOString(),
    bytes: bytes.slice().buffer,
  });
  records.set('active', {
    key: 'active',
    kind: 'state',
    formatVersion: 1,
    ownerUserId: OWNER,
    epoch: current.epoch,
    generation,
    activeSnapshotKey: snapshotKey,
    previousSnapshotKey: current.activeSnapshotKey ?? current.previousSnapshotKey,
    quarantinedSnapshotKey: current.quarantinedSnapshotKey,
    requiresCloudRebuild: false,
  });
  if (current.activeSnapshotKey && current.previousSnapshotKey
    && current.previousSnapshotKey !== current.quarantinedSnapshotKey) {
    records.delete(current.previousSnapshotKey);
  }
}
