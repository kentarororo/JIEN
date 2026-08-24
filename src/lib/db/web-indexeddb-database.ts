import WaSQLiteFactory from '@jien/wa-sqlite';
import * as SQLite from '@jien/wa-sqlite-api';
import {
  SQLITE_DONE,
  SQLITE_OPEN_CREATE,
  SQLITE_OPEN_READWRITE,
  SQLITE_ROW,
} from '@jien/wa-sqlite-constants';
import { MemoryVFS } from '@jien/wa-sqlite-memory-vfs';
import wasmModule from '@jien/wa-sqlite-wasm';
import type { SQLiteDatabase } from 'expo-sqlite';
import { IDBBatchAtomicVFS } from 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js';

import {
  MainThreadMemoryDatabase,
  type MainThreadSQLiteApi,
  type MainThreadMemoryVfs,
} from './main-thread-memory-database.ts';
import { LATEST_DATABASE_VERSION } from './migrate.ts';
import { hasSQLiteFileHeader, WebDatabaseSnapshotStore } from './web-database-snapshot.ts';

const DATABASE_PATH = 'jien.db';
const LEGACY_DATABASE_PATH = 'legacy-jien.db';

type WaSQLiteApi = MainThreadSQLiteApi & {
  open_v2: (path: string, flags: number, vfs: string) => Promise<number>;
  vfs_register: (vfs: unknown, makeDefault: boolean) => void;
};

type SnapshotMemoryVfs = MemoryVFS & {
  mapNameToFile: Map<string, {
    name: string;
    flags: number;
    size: number;
    data: ArrayBuffer;
  }>;
};

export function webIndexedDbDatabaseName(ownerUserId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerUserId)) {
    throw new Error('A verified account is required for durable web storage.');
  }
  return `jien-web-sqlite-v2:${ownerUserId.toLowerCase()}`;
}

async function databaseImageBelongsToOwner(
  database: MainThreadMemoryDatabase,
  ownerUserId: string,
  requireRecordedOwner = true,
): Promise<boolean> {
  try {
    const [version, integrity, foreignKeys, owner] = await Promise.all([
      database.getFirstAsync<{ user_version: number }>('PRAGMA user_version'),
      database.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check'),
      database.getAllAsync('PRAGMA foreign_key_check'),
      database.getFirstAsync<{ value: string }>(
        'SELECT value FROM app_settings WHERE key = ?',
        ['cloud_owner_user_id'],
      ),
    ]);
    return (version?.user_version ?? 0) > 0
      && (version?.user_version ?? 0) <= LATEST_DATABASE_VERSION
      && integrity?.integrity_check === 'ok'
      && foreignKeys.length === 0
      && (owner?.value === ownerUserId || (!requireRecordedOwner && owner == null));
  } catch {
    return false;
  }
}

async function loadValidLegacySnapshot(
  sqlite: WaSQLiteApi,
  ownerUserId: string,
): Promise<Uint8Array | null> {
  let store: WebDatabaseSnapshotStore | null = null;
  let sourceVfs: SnapshotMemoryVfs | null = null;
  let sourcePointer: number | null = null;
  try {
    store = await WebDatabaseSnapshotStore.open(ownerUserId);
    const savedImage = await store.load();
    if (!savedImage || !hasSQLiteFileHeader(savedImage)) return null;

    const vfsName = `jien-legacy-import-${ownerUserId}`;
    sourceVfs = new MemoryVFS() as SnapshotMemoryVfs;
    sourceVfs.name = vfsName;
    sourceVfs.mapNameToFile.set(LEGACY_DATABASE_PATH, {
      name: LEGACY_DATABASE_PATH,
      flags: 0,
      size: savedImage.byteLength,
      data: savedImage.slice().buffer,
    });
    sqlite.vfs_register(sourceVfs, false);
    sourcePointer = await sqlite.open_v2(
      LEGACY_DATABASE_PATH,
      SQLITE_OPEN_READWRITE,
      vfsName,
    );
    const source = new MainThreadMemoryDatabase(sqlite, sourcePointer, {
      close: () => undefined,
    }, { done: SQLITE_DONE, row: SQLITE_ROW }, null, true);
    if (!(await databaseImageBelongsToOwner(source, ownerUserId))) return null;
    return savedImage;
  } catch (error) {
    console.warn('JIEN kept an unreadable legacy web snapshot for recovery', error);
    return null;
  } finally {
    if (sourcePointer != null) await sqlite.close(sourcePointer).catch(() => undefined);
    await Promise.resolve(sourceVfs?.close()).catch(() => undefined);
    await store?.close().catch(() => undefined);
  }
}

function openIndexedDbVfsStore(databaseName: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 5);
    request.onupgradeneeded = () => {
      const next = request.result;
      if (!next.objectStoreNames.contains('blocks')) {
        const blocks = next.createObjectStore('blocks', {
          keyPath: ['path', 'offset', 'version'],
        });
        blocks.createIndex('version', ['path', 'version']);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Durable web storage could not be opened.'));
    request.onblocked = () => reject(new Error('Another JIEN tab is updating local storage. Close it, then retry.'));
  });
}

async function indexedDbContainsDatabaseFile(databaseName: string): Promise<boolean> {
  const database = await openIndexedDbVfsStore(databaseName);
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const transaction = database.transaction('blocks', 'readonly');
      const request = transaction.objectStore('blocks').getKey(IDBKeyRange.bound(
        [`/${DATABASE_PATH}`, -Infinity, -Infinity],
        [`/${DATABASE_PATH}`, Infinity, Infinity],
      ));
      request.onsuccess = () => resolve(request.result != null);
      request.onerror = () => reject(request.error ?? new Error('Durable web storage could not be inspected.'));
    });
  } finally {
    database.close();
  }
}

async function seedIndexedDbIfEmpty(databaseName: string, image: Uint8Array): Promise<void> {
  const database = await openIndexedDbVfsStore(databaseName);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('blocks', 'readwrite');
      const blocks = transaction.objectStore('blocks');
      const filePath = `/${DATABASE_PATH}`;
      const existing = blocks.getKey(IDBKeyRange.bound(
        [filePath, -Infinity, -Infinity],
        [filePath, Infinity, Infinity],
      ));
      existing.onsuccess = () => {
        if (existing.result != null) return;
        const pageSizeView = new DataView(image.buffer, image.byteOffset, image.byteLength);
        let pageSize = pageSizeView.getUint16(16);
        if (pageSize === 1) pageSize = 65_536;
        if (!Number.isSafeInteger(pageSize) || pageSize < 512 || pageSize > 65_536) {
          transaction.abort();
          return;
        }
        for (let offset = 0; offset < image.byteLength; offset += pageSize) {
          blocks.put({
            path: filePath,
            offset: offset === 0 ? 0 : -offset,
            version: 0,
            data: image.slice(offset, Math.min(offset + pageSize, image.byteLength)),
            ...(offset === 0 ? { fileSize: image.byteLength } : {}),
          });
        }
      };
      existing.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('The web database could not be prepared.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('The legacy web database image is invalid.'));
    });
  } finally {
    database.close();
  }
}

export async function openWebIndexedDbDatabase(
  ownerUserId: string,
  options: { wasmBinary?: Uint8Array } = {},
): Promise<SQLiteDatabase> {
  const module = await WaSQLiteFactory(options.wasmBinary
    ? { wasmBinary: options.wasmBinary }
    : { locateFile: () => wasmModule });
  const sqlite = SQLite.Factory(module) as WaSQLiteApi;
  const databaseName = webIndexedDbDatabaseName(ownerUserId);
  if (!(await indexedDbContainsDatabaseFile(databaseName))) {
    const legacyImage = await loadValidLegacySnapshot(sqlite, ownerUserId);
    if (legacyImage) await seedIndexedDbIfEmpty(databaseName, legacyImage);
  }
  const vfs = new IDBBatchAtomicVFS(databaseName, {
    durability: 'strict',
    purge: 'manual',
  });
  let pointer: number | null = null;
  try {
    sqlite.vfs_register(vfs, false);
    pointer = await sqlite.open_v2(
      DATABASE_PATH,
      SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
      vfs.name,
    );
    const database = new MainThreadMemoryDatabase(
      sqlite,
      pointer,
      {
        close: async () => {
          await vfs.purge(`/${DATABASE_PATH}`).catch(() => undefined);
          await vfs.close();
        },
      } as MainThreadMemoryVfs,
      { done: SQLITE_DONE, row: SQLITE_ROW },
    );
    const version = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if ((version?.user_version ?? 0) > 0 && !(await databaseImageBelongsToOwner(database, ownerUserId, false))) {
      throw new Error('The account-scoped web database failed its ownership or integrity check. Existing bytes were preserved.');
    }
    return database as unknown as SQLiteDatabase;
  } catch (cause) {
    if (pointer != null) await sqlite.close(pointer).catch(() => undefined);
    await vfs.close().catch(() => undefined);
    throw cause;
  }
}
