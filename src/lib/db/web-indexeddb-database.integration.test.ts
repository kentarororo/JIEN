import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import 'fake-indexeddb/auto';

import WaSQLiteFactory from '@jien/wa-sqlite';
import * as SQLite from '@jien/wa-sqlite-api';
import {
  SQLITE_DONE,
  SQLITE_OPEN_CREATE,
  SQLITE_OPEN_READWRITE,
  SQLITE_ROW,
} from '@jien/wa-sqlite-constants';
import { MemoryVFS } from '@jien/wa-sqlite-memory-vfs';

import { MainThreadMemoryDatabase, type MainThreadSQLiteApi } from './main-thread-memory-database.ts';
import { migrateDatabase } from './migrate.ts';
import { WebDatabaseSnapshotStore } from './web-database-snapshot.ts';
import {
  openWebIndexedDbDatabase,
  webIndexedDbDatabaseName,
} from './web-indexeddb-database.ts';

const OWNER = '11111111-1111-4111-8111-111111111111';
const LEGACY_OWNER = '22222222-2222-4222-8222-222222222222';

// Browsers accept DOMStringList directly here. fake-indexeddb deliberately
// implements the narrower Web IDL conversion, so normalize it for the real
// upstream VFS integration exercised below.
const originalTransaction = IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction = function transaction(storeNames, ...rest) {
  const normalized = typeof storeNames === 'string' || Array.isArray(storeNames)
    ? storeNames
    : Array.from(storeNames as unknown as Iterable<string>);
  return originalTransaction.call(this, normalized, ...rest);
};

type LockCallback<T> = (lock: { name: string; mode: 'exclusive' } | null) => Promise<T> | T;

class TestLockManager {
  private readonly held = new Set<string>();
  private readonly waiters = new Map<string, Array<() => void>>();

  async request<T>(
    name: string,
    optionsOrCallback: { ifAvailable?: boolean } | LockCallback<T>,
    possibleCallback?: LockCallback<T>,
  ): Promise<T> {
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : possibleCallback!;
    if (options.ifAvailable && this.held.has(name)) return callback(null);
    if (this.held.has(name)) {
      await new Promise<void>((resolve) => {
        const waiting = this.waiters.get(name) ?? [];
        waiting.push(resolve);
        this.waiters.set(name, waiting);
      });
    }
    this.held.add(name);
    try {
      return await callback({ name, mode: 'exclusive' });
    } finally {
      this.held.delete(name);
      this.waiters.get(name)?.shift()?.();
    }
  }

  async query() {
    return {
      held: [...this.held].map((name) => ({ name, mode: 'exclusive' as const })),
      pending: [],
    };
  }
}

test('the web runtime commits to account-scoped IndexedDB and reopens without OPFS', async () => {
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    value: new TestLockManager(),
  });
  const wasmBinary = readFileSync(new URL(
    '../../../node_modules/wa-sqlite/dist/wa-sqlite-async.wasm',
    import.meta.url,
  ));
  const originalSharedArrayBuffer = globalThis.SharedArrayBuffer;
  Object.defineProperty(globalThis, 'SharedArrayBuffer', { configurable: true, value: undefined });
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: false });
  try {
    const first = await openWebIndexedDbDatabase(OWNER, { wasmBinary });
    await migrateDatabase(first);
    await first.runAsync(
      'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      ['cloud_owner_user_id', OWNER],
    );
    await first.runAsync(
      'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      ['indexeddb_integration', 'committed'],
    );
    await first.closeAsync();

    const reopened = await openWebIndexedDbDatabase(OWNER, { wasmBinary });
    assert.deepEqual(
      await reopened.getFirstAsync('SELECT value FROM app_settings WHERE key = ?', ['indexeddb_integration']),
      { value: 'committed' },
    );
    assert.deepEqual(await reopened.getFirstAsync('PRAGMA integrity_check'), { integrity_check: 'ok' });
    assert.equal(webIndexedDbDatabaseName(OWNER), `jien-web-sqlite-v2:${OWNER}`);
    await reopened.closeAsync();
  } finally {
    Object.defineProperty(globalThis, 'SharedArrayBuffer', {
      configurable: true,
      value: originalSharedArrayBuffer,
    });
    Reflect.deleteProperty(globalThis, 'crossOriginIsolated');
  }
});

test('a valid account-owned legacy snapshot is imported without deleting its bytes', async () => {
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    value: new TestLockManager(),
  });
  const wasmBinary = readFileSync(new URL(
    '../../../node_modules/wa-sqlite/dist/wa-sqlite-async.wasm',
    import.meta.url,
  ));
  const module = await WaSQLiteFactory({ wasmBinary });
  const sqlite = SQLite.Factory(module) as MainThreadSQLiteApi & {
    open_v2: (path: string, flags: number, vfs: string) => Promise<number>;
    vfs_register: (vfs: unknown, makeDefault: boolean) => void;
  };
  const vfs = new MemoryVFS() as MemoryVFS & {
    mapNameToFile: Map<string, { name: string; flags: number; size: number; data: ArrayBuffer }>;
  };
  vfs.name = 'jien-legacy-integration-source';
  sqlite.vfs_register(vfs, false);
  const pointer = await sqlite.open_v2(
    'legacy-source.db',
    SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
    vfs.name,
  );
  const legacy = new MainThreadMemoryDatabase(
    sqlite,
    pointer,
    vfs,
    { done: SQLITE_DONE, row: SQLITE_ROW },
  );
  await migrateDatabase(legacy as never);
  await legacy.runAsync(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
    ['cloud_owner_user_id', LEGACY_OWNER],
  );
  await legacy.runAsync(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
    ['legacy_import', 'preserved'],
  );
  const file = vfs.mapNameToFile.get('legacy-source.db') as {
    data: ArrayBuffer;
    size: number;
  } | undefined;
  assert.ok(file);
  const legacyBytes = new Uint8Array(file.data, 0, file.size).slice();
  await legacy.closeAsync();

  const snapshotStore = await WebDatabaseSnapshotStore.open(LEGACY_OWNER);
  await snapshotStore.load();
  await snapshotStore.save(legacyBytes);
  await snapshotStore.close();

  const imported = await openWebIndexedDbDatabase(LEGACY_OWNER, { wasmBinary });
  assert.deepEqual(
    await imported.getFirstAsync('SELECT value FROM app_settings WHERE key = ?', ['legacy_import']),
    { value: 'preserved' },
  );
  const preservedStore = await WebDatabaseSnapshotStore.open(LEGACY_OWNER);
  assert.deepEqual(await preservedStore.load(), legacyBytes);
  await preservedStore.close();
  await imported.closeAsync();
});
