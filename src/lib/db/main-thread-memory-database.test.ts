import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

// @ts-expect-error Expo bundles these JavaScript modules without public declarations.
import { MemoryVFS } from '../../../node_modules/expo-sqlite/web/wa-sqlite/MemoryVFS.js';
// @ts-expect-error Expo bundles these JavaScript modules without public declarations.
import * as SQLite from '../../../node_modules/expo-sqlite/web/wa-sqlite/sqlite-api.js';
// @ts-expect-error Expo bundles these JavaScript modules without public declarations.
import { SQLITE_DONE, SQLITE_OPEN_CREATE, SQLITE_OPEN_READWRITE, SQLITE_ROW } from '../../../node_modules/expo-sqlite/web/wa-sqlite/sqlite-constants.js';
// @ts-expect-error Expo bundles this JavaScript module without a public declaration.
import WaSQLiteFactory from '../../../node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.js';
import { migrateDatabase } from './migrate.ts';
import { MainThreadMemoryDatabase, type MainThreadSQLiteApi } from './main-thread-memory-database.ts';

test('main-thread database runs all JIEN migrations and bound repository queries', async () => {
  const wasmBinary = readFileSync(new URL(
    '../../../node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.wasm',
    import.meta.url,
  ));
  const module = await WaSQLiteFactory({ wasmBinary });
  const sqlite = SQLite.Factory(module);
  const vfsName = 'jien-node-migration-memory';
  const vfs = await MemoryVFS.create(vfsName, module);
  sqlite.vfs_register(vfs, false);
  const pointer = await sqlite.open_v2(
    ':memory:',
    SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
    vfsName,
  );
  const database = new MainThreadMemoryDatabase(
    sqlite as MainThreadSQLiteApi,
    pointer,
    vfs,
    { done: SQLITE_DONE, row: SQLITE_ROW },
  ) as unknown as SQLiteDatabase;

  try {
    await migrateDatabase(database);
    const version = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const exercises = await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM exercises');
    assert.equal(version?.user_version, 10);
    assert.ok((exercises?.count ?? 0) >= 50);

    await database.runAsync(
      'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      ['main_thread_smoke', 'ready'],
    );
    assert.deepEqual(
      await database.getFirstAsync('SELECT value FROM app_settings WHERE key = ?', ['main_thread_smoke']),
      { value: 'ready' },
    );

    await assert.rejects(database.withTransactionAsync(async () => {
      await database.runAsync(
        'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        ['rolled_back', 'yes'],
      );
      throw new Error('rollback');
    }));
    assert.equal(
      await database.getFirstAsync('SELECT value FROM app_settings WHERE key = ?', ['rolled_back']),
      null,
    );
  } finally {
    database.closeSync();
  }
});
