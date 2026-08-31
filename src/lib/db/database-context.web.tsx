import type { SQLiteDatabase } from 'expo-sqlite';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';

import { getAccountState } from '@/lib/auth';
import { withWebSQLiteStartupTimeout } from '@/lib/web-sqlite-bootstrap';

import { openWebIndexedDbDatabase } from './web-indexeddb-database';

const DatabaseContext = createContext<SQLiteDatabase | null>(null);
const WEB_SQLITE_STARTUP_TIMEOUT_MS = 30_000;

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
    const opening = getAccountState()
      .then((account) => {
        if (!account.configured || !account.user) {
          throw new Error('Sign in before opening durable web storage.');
        }
        return openWebIndexedDbDatabase(account.user.id);
      });
    const startup = opening.then(async (next) => {
      opened = next;
      await onInit?.(next);
      return next;
    });
    void withWebSQLiteStartupTimeout(startup, WEB_SQLITE_STARTUP_TIMEOUT_MS)
      .then((next) => {
        if (active) setDatabase(next);
        else next.closeSync();
      })
      .catch((cause) => {
        opened?.closeSync();
        if (!opened) {
          void opening.then((lateDatabase) => lateDatabase.closeSync()).catch(() => undefined);
        }
        opened = null;
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
