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
import { withExclusiveTransaction } from './exclusive-transaction.ts';
import { MainThreadMemoryDatabase, WebDatabaseDurabilityError, type MainThreadSQLiteApi } from './main-thread-memory-database.ts';

test('main-thread database persists committed work and isolates delayed transactions from standalone operations', async () => {
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
  const persistedImages: Uint8Array[] = [];
  let failNextSave = false;
  const database = new MainThreadMemoryDatabase(
    sqlite as MainThreadSQLiteApi,
    pointer,
    vfs,
    { done: SQLITE_DONE, row: SQLITE_ROW },
    {
      save: async (bytes) => {
        if (failNextSave) {
          failNextSave = false;
          throw new Error('quota');
        }
        persistedImages.push(bytes.slice());
      },
      close: async () => undefined,
    },
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

    const beforeCommittedTransaction = persistedImages.length;
    await withExclusiveTransaction(database, async (database) => {
      await database.runAsync(
        'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        ['committed_a', 'yes'],
      );
      await database.runAsync(
        'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        ['committed_b', 'yes'],
      );
    });
    assert.equal(persistedImages.length, beforeCommittedTransaction + 1);

    const beforeRollback = persistedImages.length;
    await assert.rejects(withExclusiveTransaction(database, async (database) => {
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
    assert.equal(persistedImages.length, beforeRollback);
    assert.ok(persistedImages.at(-1)?.byteLength);

    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const transactionOrder: string[] = [];
    const first = withExclusiveTransaction(database, async (database) => {
      transactionOrder.push('first:start');
      await firstMayFinish;
      await database.runAsync(
        'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        ['concurrent_first', 'yes'],
      );
      transactionOrder.push('first:end');
    });
    const second = withExclusiveTransaction(database, async (database) => {
      transactionOrder.push('second:start');
      await database.runAsync(
        'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        ['concurrent_second', 'yes'],
      );
      await database.runAsync(
        `INSERT INTO meal_photo_jobs (
          id, image_base64, media_type, source_label, description, status,
          attempt_count, retryable, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        ['11111111-1111-4111-8111-111111111111', 'Zm9v', 'image/jpeg', 'library', 'restore me'],
      );
      transactionOrder.push('second:end');
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(transactionOrder, ['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(transactionOrder, ['first:start', 'first:end', 'second:start', 'second:end']);

    let releaseDelayed!: () => void;
    let markDelayedStarted!: () => void;
    const delayedMayFinish = new Promise<void>((resolve) => { releaseDelayed = resolve; });
    const delayedStarted = new Promise<void>((resolve) => { markDelayedStarted = resolve; });
    const delayed = withExclusiveTransaction(database, async (transactionDatabase) => {
      await transactionDatabase.runAsync(
        'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        ['exclusive_transaction', 'committing'],
      );
      markDelayedStarted();
      await delayedMayFinish;
    });
    await delayedStarted;

    let standaloneMutationFinished = false;
    let standaloneReadFinished = false;
    const standaloneMutation = database.runAsync(
      'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      ['standalone_after_transaction', 'yes'],
    ).then((result) => {
      standaloneMutationFinished = true;
      return result;
    });
    const standaloneRead = database.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = ?',
      ['standalone_after_transaction'],
    ).then((result) => {
      standaloneReadFinished = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(standaloneMutationFinished, false);
    assert.equal(standaloneReadFinished, false);

    releaseDelayed();
    const [, , standaloneValue] = await Promise.all([delayed, standaloneMutation, standaloneRead]);
    assert.deepEqual(standaloneValue, { value: 'yes' });

    const restoredPointer = await sqlite.open_v2(
      ':memory:',
      SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
      vfsName,
    );
    const restoredImage = persistedImages.at(-1);
    assert.ok(restoredImage);
    assert.equal(sqlite.deserialize(restoredPointer, 'main', restoredImage), 0);
    const restored = new MainThreadMemoryDatabase(
      sqlite as MainThreadSQLiteApi,
      restoredPointer,
      { close: () => undefined },
      { done: SQLITE_DONE, row: SQLITE_ROW },
    ) as unknown as SQLiteDatabase;
    assert.deepEqual(
      await restored.getFirstAsync(
        'SELECT description, status FROM meal_photo_jobs WHERE id = ?',
        ['11111111-1111-4111-8111-111111111111'],
      ),
      { description: 'restore me', status: 'pending' },
    );
    assert.deepEqual(await restored.getFirstAsync('PRAGMA integrity_check'), { integrity_check: 'ok' });
    assert.deepEqual(await restored.getAllAsync('PRAGMA foreign_key_check'), []);
    await restored.closeAsync();

    failNextSave = true;
    await assert.rejects(
      database.runAsync(
        'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        ['committed_not_durable', 'yes'],
      ),
      (error) => error instanceof WebDatabaseDurabilityError && error.committed,
    );
    assert.deepEqual(
      await database.getFirstAsync('SELECT value FROM app_settings WHERE key = ?', ['committed_not_durable']),
      { value: 'yes' },
    );
    await assert.rejects(
      database.runAsync(
        'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        ['must_not_retry', 'no'],
      ),
      /Do not retry/i,
    );
    assert.equal(
      await database.getFirstAsync('SELECT value FROM app_settings WHERE key = ?', ['must_not_retry']),
      null,
    );
  } finally {
    database.closeSync();
  }
});
