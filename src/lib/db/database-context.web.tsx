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
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';

import { getAccountState } from '@/lib/auth';

import {
  MainThreadMemoryDatabase,
  type MainThreadSQLiteApi,
} from './main-thread-memory-database';
import { LATEST_DATABASE_VERSION } from './migrate';
import {
  restoreOrCreateDatabaseEngine,
  type RecoverableDatabaseEngine,
} from './web-database-recovery';
import { hasSQLiteFileHeader, WebDatabaseSnapshotStore } from './web-database-snapshot';

type WaSQLiteApi = MainThreadSQLiteApi & {
  open_v2: (path: string, flags: number, vfs: string) => Promise<number>;
  vfs_register: (vfs: MemoryVFS, makeDefault: boolean) => void;
};

const VFS_NAME = 'jien-main-thread-memory';
const DATABASE_PATH = 'jien.db';
const DATABASE_VFS_PATH = `/${DATABASE_PATH}`;
const DatabaseContext = createContext<SQLiteDatabase | null>(null);

type MemoryVfsFile = {
  pathname: string;
  flags: number;
  size: number;
  data: ArrayBuffer;
};

type SnapshotMemoryVfs = MemoryVFS & {
  mapNameToFile: Map<string, MemoryVfsFile>;
  snapshotDatabase: () => Uint8Array | null;
};

type MemoryDatabaseEngine = {
  sqlite: WaSQLiteApi;
  vfs: SnapshotMemoryVfs;
  pointer: number;
};

async function createMemoryDatabaseEngine(
  savedImage: Uint8Array | null,
): Promise<RecoverableDatabaseEngine<MemoryDatabaseEngine>> {
  const module = await WaSQLiteFactory({ locateFile: () => wasmModule });
  const sqlite = SQLite.Factory(module) as WaSQLiteApi;
  let vfs: SnapshotMemoryVfs | null = null;
  let pointer: number | null = null;
  try {
    vfs = await MemoryVFS.create(VFS_NAME, module) as SnapshotMemoryVfs;
    if (savedImage) {
      if (!hasSQLiteFileHeader(savedImage)) {
        throw new Error('The saved web database is not a valid SQLite file.');
      }
      const data = savedImage.byteOffset === 0
        && savedImage.byteLength === savedImage.buffer.byteLength
        && savedImage.buffer instanceof ArrayBuffer
        ? savedImage.buffer
        : savedImage.slice().buffer;
      vfs.mapNameToFile.set(DATABASE_VFS_PATH, {
        pathname: DATABASE_VFS_PATH,
        flags: 0,
        size: savedImage.byteLength,
        data,
      });
    }
    vfs.snapshotDatabase = () => {
      const file = vfs?.mapNameToFile.get(DATABASE_VFS_PATH);
      return file ? new Uint8Array(file.data, 0, file.size) : null;
    };
    sqlite.vfs_register(vfs, false);
    pointer = await sqlite.open_v2(
      DATABASE_PATH,
      SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
      VFS_NAME,
    );
    const engine = { sqlite, vfs, pointer };
    return {
      value: engine,
      dispose: async () => {
        await sqlite.close(engine.pointer).catch(() => undefined);
        try {
          engine.vfs.close();
        } catch {
          // A trapped WASM module may reject cleanup too. It is discarded below.
        }
      },
    };
  } catch (cause) {
    if (pointer != null) await sqlite.close(pointer).catch(() => undefined);
    try {
      vfs?.close();
    } catch {
      // Preserve the original startup error.
    }
    throw cause;
  }
}

async function restoredDatabaseIsSafe(
  database: MainThreadMemoryDatabase,
  ownerUserId: string,
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
      && owner?.value === ownerUserId;
  } catch {
    return false;
  }
}

async function openMainThreadMemoryDatabase(): Promise<SQLiteDatabase> {
  const account = await getAccountState();
  if (!account.configured || !account.user) {
    throw new Error('Sign in before opening durable web storage.');
  }
  const ownerUserId = account.user.id;
  const snapshotStore = await WebDatabaseSnapshotStore.open(ownerUserId);
  let openedEngine: RecoverableDatabaseEngine<MemoryDatabaseEngine> | null = null;
  try {
    const savedImage = await snapshotStore.load();
    openedEngine = await restoreOrCreateDatabaseEngine({
      savedImage,
      createEngine: createMemoryDatabaseEngine,
      validate: async ({ sqlite, pointer }) => {
        const restoredDatabase = new MainThreadMemoryDatabase(sqlite, pointer, {
          close: () => undefined,
        }, {
          done: SQLITE_DONE,
          row: SQLITE_ROW,
        }, null, true);
        return restoredDatabaseIsSafe(restoredDatabase, ownerUserId);
      },
      quarantine: () => snapshotStore.quarantineCurrent('sqlite_restore_or_validation_failed'),
    });
    const { sqlite, pointer, vfs } = openedEngine.value;
    const database = new MainThreadMemoryDatabase(sqlite, pointer, vfs, {
      done: SQLITE_DONE,
      row: SQLITE_ROW,
    }, snapshotStore, true) as unknown as SQLiteDatabase;
    openedEngine = null;
    return database;
  } catch (cause) {
    await openedEngine?.dispose().catch(() => undefined);
    await snapshotStore.close().catch(() => undefined);
    throw cause;
  }
}

export function SQLiteProvider({
  children,
  onError,
  onInit,
}: PropsWithChildren<{
  databaseName: string;
  onError?: (error: Error) => void;
  onInit?: (database: SQLiteDatabase) => Promise<void>;
}>) {
  const [database, setDatabase] = useState<SQLiteDatabase | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    let opened: SQLiteDatabase | null = null;
    void openMainThreadMemoryDatabase()
      .then(async (next) => {
        opened = next;
        await onInit?.(next);
        if (active) setDatabase(next);
        else next.closeSync();
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause : new Error(String(cause)));
      });
    return () => {
      active = false;
      opened?.closeSync();
    };
  }, [onInit]);

  if (error) {
    onError?.(error);
    throw error;
  }
  if (!database) return null;
  return <DatabaseContext.Provider value={database}>{children}</DatabaseContext.Provider>;
}

export function useSQLiteContext(): SQLiteDatabase {
  const database = useContext(DatabaseContext);
  if (!database) throw new Error('useSQLiteContext must be used inside SQLiteProvider.');
  return database;
}
