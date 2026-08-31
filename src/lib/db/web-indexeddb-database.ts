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

type SnapshotMemoryFile = {
  name: string;
  flags: number;
  size: number;
  data: ArrayBuffer;
};

type SnapshotMemoryVfs = MemoryVFS & {
  mapNameToFile: Map<string, SnapshotMemoryFile>;
  snapshotDatabase?: () => Uint8Array | null;
};

export type WebDatabaseStorageMode = 'indexeddb-vfs' | 'snapshot';

export function resolveWebDatabaseStorageMode(
  userAgent = globalThis.navigator?.userAgent ?? '',
  maxTouchPoints = globalThis.navigator?.maxTouchPoints ?? 0,
): WebDatabaseStorageMode {
  const isAppleWebKit = /AppleWebKit\//i.test(userAgent);
  const isIos = /\b(iPad|iPhone|iPod)\b/i.test(userAgent)
    || (/\bMacintosh\b/i.test(userAgent) && maxTouchPoints > 1);
  const isChromiumFamily = /\b(Chrome|Chromium|CriOS|Edg|EdgiOS|OPR)\//i.test(userAgent);
  return isAppleWebKit && (isIos || !isChromiumFamily) ? 'snapshot' : 'indexeddb-vfs';
}

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
    console.warn('Unreadable legacy web snapshot retained for recovery', error);
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
    request.onblocked = () => reject(new Error('Another tab is updating local storage. Close it, then retry.'));
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

type IndexedDbVfsBlock = {
  path: string;
  offset: number;
  version: number;
  data: Uint8Array;
  fileSize?: number;
};

async function loadIndexedDbVfsImage(databaseName: string): Promise<Uint8Array | null> {
  const database = await openIndexedDbVfsStore(databaseName);
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const transaction = database.transaction('blocks', 'readonly');
      const blocks = transaction.objectStore('blocks');
      const path = `/${DATABASE_PATH}`;
      let image: Uint8Array | null = null;
      let failed = false;

      const fail = () => {
        failed = true;
        transaction.abort();
      };
      const block0Request = blocks.get(IDBKeyRange.bound(
        [path, 0, -Infinity],
        [path, 0, Infinity],
      ));
      block0Request.onerror = fail;
      block0Request.onsuccess = () => {
        const block0 = block0Request.result as IndexedDbVfsBlock | undefined;
        const fileSize = block0?.fileSize;
        if (!block0 || !Number.isSafeInteger(fileSize) || Number(fileSize) <= 0) return;
        const firstPage = block0.data instanceof Uint8Array
          ? block0.data
          : new Uint8Array(block0.data as unknown as ArrayBuffer);
        if (!hasSQLiteFileHeader(firstPage)) return;
        const pageSizeView = new DataView(firstPage.buffer, firstPage.byteOffset, firstPage.byteLength);
        let pageSize = pageSizeView.getUint16(16);
        if (pageSize === 1) pageSize = 65_536;
        if (!Number.isSafeInteger(pageSize) || pageSize < 512 || pageSize > 65_536) return;

        image = new Uint8Array(Number(fileSize));
        image.set(firstPage.subarray(0, Math.min(firstPage.byteLength, image.byteLength)), 0);
        let fileOffset = pageSize;
        const readNextPage = () => {
          if (!image || fileOffset >= image.byteLength) return;
          const storedOffset = -fileOffset;
          const request = blocks.get(IDBKeyRange.bound(
            [path, storedOffset, block0.version],
            [path, storedOffset, Infinity],
          ));
          request.onerror = fail;
          request.onsuccess = () => {
            const block = request.result as IndexedDbVfsBlock | undefined;
            if (!block) {
              image = null;
              return;
            }
            const bytes = block.data instanceof Uint8Array
              ? block.data
              : new Uint8Array(block.data as unknown as ArrayBuffer);
            const target = image;
            if (!target) return;
            target.set(bytes.subarray(0, Math.min(bytes.byteLength, target.byteLength - fileOffset)), fileOffset);
            fileOffset += pageSize;
            readNextPage();
          };
        };
        readNextPage();
      };
      transaction.oncomplete = () => resolve(image && hasSQLiteFileHeader(image) ? image : null);
      transaction.onerror = () => reject(transaction.error ?? new Error('Durable web storage could not be read.'));
      transaction.onabort = () => {
        if (failed) reject(transaction.error ?? new Error('Durable web storage could not be read.'));
        else resolve(null);
      };
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
  options: { wasmBinary?: Uint8Array; storageMode?: WebDatabaseStorageMode } = {},
): Promise<SQLiteDatabase> {
  const module = await WaSQLiteFactory(options.wasmBinary
    ? { wasmBinary: options.wasmBinary }
    : { locateFile: () => wasmModule });
  const sqlite = SQLite.Factory(module) as WaSQLiteApi;
  const databaseName = webIndexedDbDatabaseName(ownerUserId);
  const storageMode = options.storageMode ?? resolveWebDatabaseStorageMode();
  if (storageMode === 'snapshot') {
    return openWebSnapshotDatabase(sqlite, ownerUserId, databaseName);
  }
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

async function openWebSnapshotDatabase(
  sqlite: WaSQLiteApi,
  ownerUserId: string,
  indexedDbVfsName: string,
): Promise<SQLiteDatabase> {
  const store = await WebDatabaseSnapshotStore.open(ownerUserId);
  const vfs = new MemoryVFS() as SnapshotMemoryVfs;
  vfs.name = `jien-webkit-memory-${ownerUserId}`;
  let pointer: number | null = null;
  try {
    const savedImage = await store.load();
    const indexedDbImage = savedImage ? null : await loadIndexedDbVfsImage(indexedDbVfsName)
      .catch((error) => {
        console.warn('Existing page-store bytes remain available but could not be imported', error);
        return null;
      });
    const initialImage = savedImage ?? indexedDbImage;
    if (initialImage && hasSQLiteFileHeader(initialImage)) {
      vfs.mapNameToFile.set(DATABASE_PATH, {
        name: DATABASE_PATH,
        flags: 0,
        size: initialImage.byteLength,
        data: initialImage.slice().buffer,
      });
    }
    vfs.snapshotDatabase = () => {
      const file = (vfs.mapNameToFile.get(DATABASE_PATH)
        ?? vfs.mapNameToFile.get(`/${DATABASE_PATH}`)) as SnapshotMemoryFile | undefined;
      return file ? new Uint8Array(file.data, 0, file.size) : null;
    };
    sqlite.vfs_register(vfs, false);
    pointer = await sqlite.open_v2(
      DATABASE_PATH,
      SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
      vfs.name,
    );
    const database = new MainThreadMemoryDatabase(
      sqlite,
      pointer,
      vfs,
      { done: SQLITE_DONE, row: SQLITE_ROW },
      store,
      true,
    );
    const version = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if ((version?.user_version ?? 0) > 0 && !(await databaseImageBelongsToOwner(database, ownerUserId, false))) {
      throw new Error('The account-scoped web database failed its ownership or integrity check. Existing bytes were preserved.');
    }
    return database as unknown as SQLiteDatabase;
  } catch (cause) {
    if (pointer != null) await sqlite.close(pointer).catch(() => undefined);
    await Promise.resolve(vfs.close()).catch(() => undefined);
    await store.close().catch(() => undefined);
    throw cause;
  }
}
