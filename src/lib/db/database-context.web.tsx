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

import {
  MainThreadMemoryDatabase,
  type MainThreadSQLiteApi,
} from './main-thread-memory-database';

type WaSQLiteApi = MainThreadSQLiteApi & {
  open_v2: (path: string, flags: number, vfs: string) => Promise<number>;
  vfs_register: (vfs: MemoryVFS, makeDefault: boolean) => void;
};

const VFS_NAME = 'jien-main-thread-memory';
const DatabaseContext = createContext<SQLiteDatabase | null>(null);

async function openMainThreadMemoryDatabase(): Promise<SQLiteDatabase> {
  const module = await WaSQLiteFactory({ locateFile: () => wasmModule });
  const sqlite = SQLite.Factory(module) as WaSQLiteApi;
  const vfs = await MemoryVFS.create(VFS_NAME, module);
  sqlite.vfs_register(vfs, false);
  const pointer = await sqlite.open_v2(
    ':memory:',
    SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
    VFS_NAME,
  );
  return new MainThreadMemoryDatabase(sqlite, pointer, vfs, {
    done: SQLITE_DONE,
    row: SQLITE_ROW,
  }) as unknown as SQLiteDatabase;
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
