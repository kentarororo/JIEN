import WaSQLiteFactory from '@jien/wa-sqlite';
import * as SQLite from '@jien/wa-sqlite-api';
import {
  SQLITE_DONE,
  SQLITE_OPEN_CREATE,
  SQLITE_OPEN_READWRITE,
  SQLITE_OK,
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
import { hasSQLiteFileHeader, WebDatabaseSnapshotStore } from './web-database-snapshot';

type WaSQLiteApi = MainThreadSQLiteApi & {
  deserialize: (database: number, schema: string, bytes: Uint8Array) => number;
  open_v2: (path: string, flags: number, vfs: string) => Promise<number>;
  vfs_register: (vfs: MemoryVFS, makeDefault: boolean) => void;
};

const VFS_NAME = 'jien-main-thread-memory';
const DatabaseContext = createContext<SQLiteDatabase | null>(null);

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
  const snapshotStore = await WebDatabaseSnapshotStore.open(account.user.id);
  let sqlite: WaSQLiteApi | null = null;
  let vfs: MemoryVFS | null = null;
  let pointer: number | null = null;
  try {
    const savedImage = await snapshotStore.load();
    const module = await WaSQLiteFactory({ locateFile: () => wasmModule });
    sqlite = SQLite.Factory(module) as WaSQLiteApi;
    vfs = await MemoryVFS.create(VFS_NAME, module);
    sqlite.vfs_register(vfs, false);
    pointer = await sqlite.open_v2(
      ':memory:',
      SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
      VFS_NAME,
    );
    if (savedImage) {
      let restored = false;
      if (hasSQLiteFileHeader(savedImage)) {
        try {
          restored = sqlite.deserialize(pointer, 'main', savedImage) === SQLITE_OK;
        } catch {
          restored = false;
        }
      }
      if (restored) {
        const restoredDatabase = new MainThreadMemoryDatabase(sqlite, pointer, vfs, {
          done: SQLITE_DONE,
          row: SQLITE_ROW,
        }, snapshotStore, true);
        if (await restoredDatabaseIsSafe(restoredDatabase, account.user.id)) {
          return restoredDatabase as unknown as SQLiteDatabase;
        }
      }
      await sqlite.close(pointer).catch(() => undefined);
      pointer = null;
      await snapshotStore.quarantineCurrent('sqlite_validation_failed');
      pointer = await sqlite.open_v2(
        ':memory:',
        SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
        VFS_NAME,
      );
    }
    return new MainThreadMemoryDatabase(sqlite, pointer, vfs, {
      done: SQLITE_DONE,
      row: SQLITE_ROW,
    }, snapshotStore, true) as unknown as SQLiteDatabase;
  } catch (cause) {
    if (sqlite && pointer != null) await sqlite.close(pointer).catch(() => undefined);
    vfs?.close();
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
