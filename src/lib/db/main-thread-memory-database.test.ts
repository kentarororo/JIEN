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
import { exerciseTargetsNeedReview, updateExerciseTargetsAtomically } from './exercise-targets.ts';
import { resolveDatabaseJournalMode } from './database-journal-mode.ts';
import { withExclusiveTransaction } from './exclusive-transaction.ts';
import { saveNutritionTargetAtomically } from './nutrition-target-save.ts';
import { savePrivateFood } from './private-food.ts';
import { listVolumeHistory, saveWorkout, updateWorkout } from './workouts.ts';
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
    assert.equal(resolveDatabaseJournalMode(database), 'DELETE');
    assert.equal(resolveDatabaseJournalMode({}), 'WAL');
    await migrateDatabase(database);
    const version = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const exercises = await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM exercises');
    const foodColumns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(food_items)');
    const targetColumns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(nutrition_targets)');
    const setColumns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(workout_sets)');
    assert.equal(version?.user_version, 14);
    assert.ok((exercises?.count ?? 0) >= 50);
    assert.equal(foodColumns.some((column) => column.name === 'desired_weekly_weight_change_percent'), false);
    assert.equal(targetColumns.some((column) => column.name === 'desired_weekly_weight_change_percent'), true);
    assert.equal(setColumns.some((column) => column.name === 'primary_muscle_group'), true);
    assert.equal(setColumns.some((column) => column.name === 'secondary_muscle_groups'), true);
    assert.deepEqual(
      await database.getFirstAsync(
        `SELECT name, source, source_ref AS sourceRef, calories_kcal AS caloriesKcal
         FROM food_catalog_cache WHERE id = 'usda-2708418'`,
      ),
      { name: 'Congee', source: 'usda_fdc', sourceRef: '2708418', caloriesKcal: 39 },
    );
    await database.runAsync(`DELETE FROM food_catalog_cache WHERE id = 'usda-2708418'`);
    await database.execAsync('PRAGMA user_version = 12;');
    await migrateDatabase(database);
    assert.equal(
      (await database.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM food_catalog_cache
         WHERE id = 'usda-2708418' AND source = 'usda_fdc' AND source_ref = '2708418'`,
      ))?.count,
      1,
      'the v13 upgrade should add regional starter foods to an existing database',
    );
    assert.equal(exerciseTargetsNeedReview({ primaryMuscleGroup: 'arms', secondaryMuscleGroups: [] }), true);
    assert.equal(exerciseTargetsNeedReview({ primaryMuscleGroup: 'biceps', secondaryMuscleGroups: ['forearms'] }), false);

    const privateFood = await savePrivateFood(database, {
      id: 'custom-protein-cereal',
      name: '  Protein cereal  ',
      servingQuantity: 55,
      servingUnit: 'g',
      caloriesKcal: 210,
      proteinG: 20,
      carbohydrateG: 24,
      fatG: 4,
      fibreG: 7,
    });
    assert.equal(privateFood.source, 'custom');
    assert.equal(privateFood.name, 'Protein cereal');
    assert.deepEqual(
      await database.getAllAsync(
        `SELECT id, name, source, calories_kcal AS caloriesKcal
         FROM food_catalog_cache WHERE name LIKE ? COLLATE NOCASE`,
        ['%protein cereal%'],
      ),
      [{ id: 'custom-protein-cereal', name: 'Protein cereal', source: 'custom', caloriesKcal: 210 }],
    );
    await savePrivateFood(database, {
      id: privateFood.id,
      name: privateFood.name,
      servingQuantity: 55,
      servingUnit: 'g',
      caloriesKcal: 215,
      proteinG: 21,
      carbohydrateG: 24,
      fatG: 4,
      fibreG: 7,
    });
    assert.deepEqual(
      await database.getFirstAsync(
        `SELECT COUNT(*) AS count, MAX(calories_kcal) AS calories_kcal
         FROM food_catalog_cache WHERE id = ? AND source = 'custom'`,
        [privateFood.id],
      ),
      { count: 1, calories_kcal: 215 },
      'updating a private food must replace its reusable serving instead of creating a duplicate',
    );

    await updateExerciseTargetsAtomically(database, '10000000-0000-4000-8000-000000000004', {
      primaryMuscleGroup: 'front delts',
      secondaryMuscleGroups: ['triceps', 'front_delts', 'triceps'],
    }, {
      now: () => '2026-08-24T08:00:00.000Z',
      enqueue: async (transactionDb, exercise, changedAt) => {
        await transactionDb.runAsync(
          `INSERT INTO sync_queue (id, table_name, entity_id, operation, payload_json, created_at)
           VALUES (?, 'exercises', ?, 'upsert', ?, ?)`,
          ['exercise-target-test', exercise.id, JSON.stringify({
            id: exercise.id,
            name: exercise.name,
            movement_pattern: exercise.movementPattern,
            primary_muscle_group: exercise.primaryMuscleGroup,
            secondary_muscle_groups: exercise.secondaryMuscleGroups,
            equipment: exercise.equipment,
            target_rep_min: exercise.targetRepMin,
            target_rep_max: exercise.targetRepMax,
            load_increment: exercise.loadIncrement,
            notes: exercise.notes,
            is_archived: exercise.isArchived,
            client_updated_at: changedAt,
            deleted_at: null,
          }), changedAt],
        );
      },
    });
    assert.deepEqual(
      await database.getFirstAsync(
        'SELECT primary_muscle_group, secondary_muscle_groups FROM exercises WHERE id = ?',
        ['10000000-0000-4000-8000-000000000004'],
      ),
      { primary_muscle_group: 'front_delts', secondary_muscle_groups: '["triceps"]' },
    );
    const exerciseQueue = await database.getFirstAsync<{ payload_json: string }>(
      `SELECT payload_json FROM sync_queue
       WHERE table_name = 'exercises' AND entity_id = ?`,
      ['10000000-0000-4000-8000-000000000004'],
    );
    assert.deepEqual(JSON.parse(exerciseQueue?.payload_json ?? '{}'), {
      id: '10000000-0000-4000-8000-000000000004',
      name: 'Machine Shoulder Press',
      movement_pattern: 'vertical_push',
      primary_muscle_group: 'front_delts',
      secondary_muscle_groups: ['triceps'],
      equipment: 'machine',
      target_rep_min: 8,
      target_rep_max: 12,
      load_increment: 2.5,
      notes: null,
      is_archived: false,
      client_updated_at: JSON.parse(exerciseQueue!.payload_json).client_updated_at,
      deleted_at: null,
    });

    const workoutTimestamp = new Date().toISOString();
    await saveWorkout(database, {
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Snapshot test',
      startedAt: workoutTimestamp,
      exercises: [{
        exercise: {
          id: '10000000-0000-4000-8000-000000000001',
          name: 'Machine Chest Press',
          movementPattern: 'horizontal_push',
          primaryMuscleGroup: 'chest',
          secondaryMuscleGroups: ['triceps', 'front_delts'],
          equipment: 'machine',
          targetRepMin: 8,
          targetRepMax: 12,
          loadIncrement: 2.5,
          notes: null,
          isArchived: false,
        },
        sets: [{ reps: 10, loadValue: 40, loadUnit: 'kg', rpe: 8 }],
      }],
    });
    await updateExerciseTargetsAtomically(database, '10000000-0000-4000-8000-000000000001', {
      primaryMuscleGroup: 'front_delts',
      secondaryMuscleGroups: ['triceps'],
    }, { now: () => new Date().toISOString(), enqueue: async () => undefined });
    const snapshotHistory = await listVolumeHistory(database, new Date(Date.now() - 86_400_000));
    const snapshotSet = snapshotHistory.find((set) => set.movementPattern === 'horizontal_push');
    assert.equal(snapshotSet?.primaryMuscleGroup, 'chest', 'exercise edits must not reclassify saved sets');
    assert.deepEqual(snapshotSet?.secondaryMuscleGroups, ['triceps', 'front_delts']);
    const savedSet = await database.getFirstAsync<{ id: string }>(
      'SELECT id FROM workout_sets WHERE workout_id = ?',
      ['33333333-3333-4333-8333-333333333333'],
    );
    await updateWorkout(database, '33333333-3333-4333-8333-333333333333', {
      title: 'Snapshot test edited',
      startedAt: workoutTimestamp,
      exercises: [{
        exercise: {
          id: '10000000-0000-4000-8000-000000000001',
          name: 'Machine Chest Press',
          movementPattern: 'horizontal_push',
          primaryMuscleGroup: 'front_delts',
          secondaryMuscleGroups: ['triceps'],
          equipment: 'machine',
          targetRepMin: 8,
          targetRepMax: 12,
          loadIncrement: 2.5,
          notes: null,
          isArchived: false,
        },
        sets: [{ id: savedSet!.id, reps: 11, loadValue: 40, loadUnit: 'kg', rpe: 8 }],
      }],
    });
    const editedHistory = await listVolumeHistory(database, new Date(Date.now() - 86_400_000));
    const editedSet = editedHistory.find((set) => set.movementPattern === 'horizontal_push');
    assert.equal(editedSet?.primaryMuscleGroup, 'chest', 'editing reps must retain the recorded target snapshot');
    assert.deepEqual(editedSet?.secondaryMuscleGroups, ['triceps', 'front_delts']);
    const queuedSet = await database.getFirstAsync<{ payload_json: string }>(
      `SELECT payload_json FROM sync_queue WHERE table_name = 'sets' AND entity_id IN (
        SELECT id FROM workout_sets WHERE workout_id = ?
      )`,
      ['33333333-3333-4333-8333-333333333333'],
    );
    assert.equal(JSON.parse(queuedSet?.payload_json ?? '{}').primary_muscle_group, 'chest');

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

    let releaseNutritionSaves!: () => void;
    let markNutritionBlockerStarted!: () => void;
    const nutritionSavesMayStart = new Promise<void>((resolve) => { releaseNutritionSaves = resolve; });
    const nutritionBlockerStarted = new Promise<void>((resolve) => { markNutritionBlockerStarted = resolve; });
    const nutritionBlocker = withExclusiveTransaction(database, async () => {
      markNutritionBlockerStarted();
      await nutritionSavesMayStart;
    });
    await nutritionBlockerStarted;

    const queuedPayloads: Array<{ entityId: string; payload: Record<string, unknown> }> = [];
    let createdIdCount = 0;
    const nutritionDependencies = {
      createId: () => {
        createdIdCount += 1;
        return '22222222-2222-4222-8222-222222222222';
      },
      now: () => new Date('2099-01-10T08:00:00.000Z'),
      toLocalDateKey: (date = new Date('2099-01-10T08:00:00.000Z')) => date.toISOString().slice(0, 10),
      enqueueUpsert: async (_database: SQLiteDatabase, entityId: string, payload: Record<string, unknown>) => {
        queuedPayloads.push({ entityId, payload });
      },
    };
    const firstTargetSave = saveNutritionTargetAtomically(database, {
      caloriesKcal: 2_200,
      proteinG: 150,
      carbohydrateG: 250,
      fatG: 70,
      fibreG: 30,
      desiredWeeklyWeightChangePercent: 0,
    }, { source: 'manual' }, nutritionDependencies);
    const secondTargetSave = saveNutritionTargetAtomically(database, {
      caloriesKcal: 2_300,
      proteinG: 155,
      carbohydrateG: 260,
      fatG: 72,
      fibreG: 32,
      desiredWeeklyWeightChangePercent: 0.1,
    }, { source: 'adaptive', rationale: '  deterministic retry  ' }, nutritionDependencies);
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseNutritionSaves();
    const [, firstTarget, secondTarget] = await Promise.all([
      nutritionBlocker,
      firstTargetSave,
      secondTargetSave,
    ]);
    assert.equal(createdIdCount, 1);
    assert.equal(firstTarget.id, secondTarget.id);
    assert.equal(firstTarget.id, '22222222-2222-4222-8222-222222222222');
    assert.deepEqual(
      await database.getAllAsync(
        `SELECT id, effective_from, effective_to, calories_kcal, source, rationale
         FROM nutrition_targets WHERE effective_to IS NULL AND deleted_at IS NULL`,
      ),
      [{
        id: '22222222-2222-4222-8222-222222222222',
        effective_from: '2099-01-10',
        effective_to: null,
        calories_kcal: 2_300,
        source: 'adaptive',
        rationale: 'deterministic retry',
      }],
    );
    assert.equal(queuedPayloads.length, 2);
    assert.deepEqual(queuedPayloads.map(({ entityId }) => entityId), [firstTarget.id, firstTarget.id]);
    assert.equal(queuedPayloads.at(-1)?.payload.calories_kcal, 2_300);
    assert.equal(queuedPayloads.at(-1)?.payload.effective_to, null);

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
    assert.deepEqual(
      await restored.getFirstAsync(
        'SELECT name, calories_kcal, protein_g, source FROM food_catalog_cache WHERE id = ?',
        ['custom-protein-cereal'],
      ),
      { name: 'Protein cereal', calories_kcal: 215, protein_g: 21, source: 'custom' },
      'private foods must survive a durable database close and fresh SQLite lifecycle',
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

test('classifies a synchronous WASM serialize trap as committed but not durable', async () => {
  const database = new MainThreadMemoryDatabase({
    serialize: () => { throw new WebAssembly.RuntimeError('out of bounds memory access'); },
  } as unknown as MainThreadSQLiteApi, 1, { close: () => undefined }, { done: 101, row: 100 }, {
    save: async () => undefined,
    close: async () => undefined,
  });
  await assert.rejects(
    database.persistAsync(),
    (cause: unknown) => cause instanceof WebDatabaseDurabilityError
      && cause.committed
      && cause.code === 'WEB_DATABASE_NOT_DURABLE'
      && cause.cause instanceof WebAssembly.RuntimeError,
  );
  await assert.rejects(database.persistAsync(), /Do not retry/i);
});

test('persists a MemoryVFS file snapshot without calling the fragile WASM serialize bridge', async () => {
  let saved: Uint8Array | null = null;
  const database = new MainThreadMemoryDatabase({
    serialize: () => { throw new WebAssembly.RuntimeError('serialize must not run'); },
  } as unknown as MainThreadSQLiteApi, 1, {
    close: () => undefined,
    snapshotDatabase: () => new Uint8Array([83, 81, 76, 105, 116, 101]),
  }, { done: 101, row: 100 }, {
    save: async (bytes) => { saved = bytes; },
    close: async () => undefined,
  });

  await database.persistAsync();
  assert.deepEqual(saved, new Uint8Array([83, 81, 76, 105, 116, 101]));
});

test('restores a durable database from raw MemoryVFS bytes in a fresh WASM lifecycle', async () => {
  const wasmBinary = readFileSync(new URL(
    '../../../node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.wasm',
    import.meta.url,
  ));
  const createFileDatabase = async (
    vfsName: string,
    savedImage: Uint8Array | null,
    save: (bytes: Uint8Array) => Promise<void>,
  ) => {
    const module = await WaSQLiteFactory({ wasmBinary });
    const sqlite = SQLite.Factory(module);
    const vfs = await MemoryVFS.create(vfsName, module) as MemoryVFS & {
      mapNameToFile: Map<string, { pathname: string; flags: number; size: number; data: ArrayBuffer }>;
      snapshotDatabase: () => Uint8Array | null;
    };
    if (savedImage) {
      vfs.mapNameToFile.set('/jien.db', {
        pathname: '/jien.db',
        flags: 0,
        size: savedImage.byteLength,
        data: savedImage.slice().buffer,
      });
    }
    vfs.snapshotDatabase = () => {
      const file = vfs.mapNameToFile.get('/jien.db');
      return file ? new Uint8Array(file.data, 0, file.size) : null;
    };
    sqlite.vfs_register(vfs, false);
    const pointer = await sqlite.open_v2(
      'jien.db',
      SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
      vfsName,
    );
    return new MainThreadMemoryDatabase(
      sqlite as MainThreadSQLiteApi,
      pointer,
      vfs,
      { done: SQLITE_DONE, row: SQLITE_ROW },
      { save, close: async () => undefined },
    ) as unknown as SQLiteDatabase;
  };

  let durableImage: Uint8Array | null = null;
  const first = await createFileDatabase(
    'jien-raw-file-first',
    null,
    async (bytes) => { durableImage = bytes.slice(); },
  );
  await migrateDatabase(first);
  await first.runAsync(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
    ['raw_vfs_restore', 'ready'],
  );
  const capturedImage = durableImage as Uint8Array | null;
  assert.ok(capturedImage);
  assert.equal(new TextDecoder().decode(capturedImage.slice(0, 16)), 'SQLite format 3\0');
  await first.closeAsync();

  const restored = await createFileDatabase(
    'jien-raw-file-restored',
    capturedImage,
    async () => undefined,
  );
  assert.deepEqual(
    await restored.getFirstAsync('SELECT value FROM app_settings WHERE key = ?', ['raw_vfs_restore']),
    { value: 'ready' },
  );
  assert.deepEqual(await restored.getFirstAsync('PRAGMA integrity_check'), { integrity_check: 'ok' });
  await restored.closeAsync();
});
