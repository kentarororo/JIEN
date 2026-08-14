import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { addColumnIfMissing } from './migration-utils';

const DEFAULT_EXERCISES = [
  ['10000000-0000-4000-8000-000000000001', 'Machine Chest Press', 'horizontal_push', 'chest', '["triceps","front_delts"]', 'machine', 8, 12, 2.5],
  ['10000000-0000-4000-8000-000000000002', 'Lat Pulldown', 'vertical_pull', 'lats', '["biceps","upper_back"]', 'cable', 8, 12, 2.5],
  ['10000000-0000-4000-8000-000000000003', 'Seated Cable Row', 'horizontal_pull', 'upper_back', '["lats","biceps"]', 'cable', 8, 12, 2.5],
  ['10000000-0000-4000-8000-000000000004', 'Machine Shoulder Press', 'vertical_push', 'shoulders', '["triceps","front_delts"]', 'machine', 8, 12, 2.5],
  ['10000000-0000-4000-8000-000000000005', 'Cable Lateral Raise', 'shoulder_abduction', 'side_delts', '[]', 'cable', 10, 15, 1.25],
  ['10000000-0000-4000-8000-000000000006', 'Reverse Pec Deck', 'horizontal_abduction', 'rear_delts', '["upper_back"]', 'machine', 12, 20, 2.5],
  ['10000000-0000-4000-8000-000000000007', 'Leg Press', 'knee_dominant', 'quads', '["glutes"]', 'machine', 8, 12, 5],
  ['10000000-0000-4000-8000-000000000008', 'Seated Leg Curl', 'knee_flexion', 'hamstrings', '[]', 'machine', 10, 15, 2.5],
  ['10000000-0000-4000-8000-000000000009', 'Cable Pull-through', 'hip_hinge', 'glutes', '["hamstrings"]', 'cable', 10, 15, 2.5],
  ['10000000-0000-4000-8000-000000000010', 'Cable Crunch', 'spinal_flexion', 'core', '[]', 'cable', 12, 20, 2.5],
  ['10000000-0000-4000-8000-000000000011', 'Pallof Press', 'anti_rotation', 'core', '[]', 'cable', 10, 15, 1.25],
  ['10000000-0000-4000-8000-000000000012', 'Cable Curl', 'elbow_flexion', 'biceps', '[]', 'cable', 10, 15, 1.25],
  ['10000000-0000-4000-8000-000000000013', 'Rope Pressdown', 'elbow_extension', 'triceps', '[]', 'cable', 10, 15, 1.25],
  ['10000000-0000-4000-8000-000000000014', 'Standing Calf Raise', 'plantar_flexion', 'calves', '[]', 'machine', 10, 15, 2.5],
  ['10000000-0000-4000-8000-000000000015', 'Pec Deck', 'horizontal_adduction', 'chest', '[]', 'machine', 10, 15, 2.5],
  ['10000000-0000-4000-8000-000000000016', 'Cable Fly', 'horizontal_adduction', 'chest', '[]', 'cable', 10, 15, 1.25],
  ['10000000-0000-4000-8000-000000000017', 'Incline Machine Chest Press', 'incline_push', 'upper_chest', '["triceps","front_delts"]', 'machine', 8, 12, 2.5],
  ['10000000-0000-4000-8000-000000000018', 'Assisted Dip', 'vertical_push', 'triceps', '["chest"]', 'machine', 8, 12, 2.5],
  ['10000000-0000-4000-8000-000000000019', 'Neutral-grip Lat Pulldown', 'vertical_pull', 'lats', '["biceps","upper_back"]', 'cable', 8, 12, 2.5],
  ['10000000-0000-4000-8000-000000000020', 'Chest-supported Machine Row', 'horizontal_pull', 'upper_back', '["lats","biceps"]', 'machine', 8, 12, 2.5],
  ['10000000-0000-4000-8000-000000000021', 'Single-arm Cable Row', 'horizontal_pull', 'lats', '["upper_back","biceps"]', 'cable', 8, 12, 1.25],
  ['10000000-0000-4000-8000-000000000022', 'Machine High Row', 'diagonal_pull', 'upper_back', '["lats","biceps","rear_delts"]', 'machine', 8, 12, 2.5],
  ['10000000-0000-4000-8000-000000000023', 'Straight-arm Pulldown', 'shoulder_extension', 'lats', '[]', 'cable', 10, 15, 1.25],
  ['10000000-0000-4000-8000-000000000024', 'Machine Lateral Raise', 'shoulder_abduction', 'side_delts', '[]', 'machine', 10, 15, 2.5],
  ['10000000-0000-4000-8000-000000000025', 'Cable Rear-delt Fly', 'horizontal_abduction', 'rear_delts', '["upper_back"]', 'cable', 12, 20, 1.25],
  ['10000000-0000-4000-8000-000000000026', 'Rope Face Pull', 'horizontal_abduction', 'rear_delts', '["upper_back","external_rotators"]', 'cable', 12, 20, 1.25],
  ['10000000-0000-4000-8000-000000000027', 'Leg Extension', 'knee_extension', 'quads', '[]', 'machine', 10, 15, 2.5],
  ['10000000-0000-4000-8000-000000000028', 'Lying Leg Curl', 'knee_flexion', 'hamstrings', '[]', 'machine', 10, 15, 2.5],
  ['10000000-0000-4000-8000-000000000029', 'Hack Squat', 'knee_dominant', 'quads', '["glutes"]', 'machine', 8, 12, 5],
  ['10000000-0000-4000-8000-000000000030', 'Smith Machine Squat', 'knee_dominant', 'quads', '["glutes"]', 'smith_machine', 8, 12, 2.5],
  ['10000000-0000-4000-8000-000000000031', 'Machine Hip Thrust', 'hip_extension', 'glutes', '["hamstrings"]', 'machine', 8, 12, 5],
  ['10000000-0000-4000-8000-000000000032', 'Cable Glute Kickback', 'hip_extension', 'glutes', '[]', 'cable', 10, 15, 1.25],
  ['10000000-0000-4000-8000-000000000033', 'Hip Abduction Machine', 'hip_abduction', 'glutes', '[]', 'machine', 12, 20, 2.5],
  ['10000000-0000-4000-8000-000000000034', 'Hip Adduction Machine', 'hip_adduction', 'adductors', '[]', 'machine', 12, 20, 2.5],
  ['10000000-0000-4000-8000-000000000035', 'Seated Calf Raise', 'plantar_flexion', 'calves', '[]', 'machine', 10, 15, 2.5],
  ['10000000-0000-4000-8000-000000000036', 'Machine Preacher Curl', 'elbow_flexion', 'biceps', '[]', 'machine', 10, 15, 2.5],
  ['10000000-0000-4000-8000-000000000037', 'Rope Hammer Curl', 'elbow_flexion', 'biceps', '["forearms"]', 'cable', 10, 15, 1.25],
  ['10000000-0000-4000-8000-000000000038', 'Overhead Cable Triceps Extension', 'elbow_extension', 'triceps', '[]', 'cable', 10, 15, 1.25],
  ['10000000-0000-4000-8000-000000000039', 'Machine Triceps Dip', 'elbow_extension', 'triceps', '["chest"]', 'machine', 8, 12, 2.5],
  ['10000000-0000-4000-8000-000000000040', 'Ab Crunch Machine', 'spinal_flexion', 'core', '[]', 'machine', 12, 20, 2.5],
  ['10000000-0000-4000-8000-000000000041', 'Hanging Knee Raise', 'hip_flexion', 'core', '[]', 'bodyweight', 12, 20, 1],
  ['10000000-0000-4000-8000-000000000042', 'Back Extension', 'hip_hinge', 'lower_back', '["glutes","hamstrings"]', 'bodyweight', 10, 15, 2.5],
  ['10000000-0000-4000-8000-000000000043', 'Dumbbell Bench Press', 'horizontal_push', 'chest', '["triceps","front_delts"]', 'dumbbell', 8, 12, 2],
  ['10000000-0000-4000-8000-000000000044', 'One-arm Dumbbell Row', 'horizontal_pull', 'lats', '["upper_back","biceps"]', 'dumbbell', 8, 12, 2],
  ['10000000-0000-4000-8000-000000000045', 'Goblet Squat', 'knee_dominant', 'quads', '["glutes"]', 'dumbbell', 8, 12, 2],
  ['10000000-0000-4000-8000-000000000046', 'Dumbbell Romanian Deadlift', 'hip_hinge', 'hamstrings', '["glutes","lower_back"]', 'dumbbell', 8, 12, 2],
  ['10000000-0000-4000-8000-000000000047', 'Push-up', 'horizontal_push', 'chest', '["triceps","front_delts"]', 'bodyweight', 8, 15, 1],
  ['10000000-0000-4000-8000-000000000048', 'Assisted Pull-up', 'vertical_pull', 'lats', '["biceps","upper_back"]', 'machine', 8, 12, 2.5],
  ['10000000-0000-4000-8000-000000000049', 'Cable External Rotation', 'external_rotation', 'rotator_cuff', '["rear_delts"]', 'cable', 12, 20, 0.5],
  ['10000000-0000-4000-8000-000000000050', 'Cable Wood Chop', 'rotation', 'core', '[]', 'cable', 10, 15, 1.25],
] as const;

const STARTER_FOODS = [
  ['starter-chicken-breast', 'Chicken breast, cooked', null, 100, 'g', 165, 31, 0, 3.6, 0],
  ['starter-white-rice', 'White rice, cooked', null, 100, 'g', 130, 2.7, 28.2, 0.3, 0.4],
  ['starter-brown-rice', 'Brown rice, cooked', null, 100, 'g', 123, 2.7, 25.6, 1, 1.6],
  ['starter-egg', 'Whole egg', null, 1, 'large egg', 72, 6.3, 0.4, 4.8, 0],
  ['starter-banana', 'Banana', null, 1, 'medium', 105, 1.3, 27, 0.4, 3.1],
  ['starter-oats', 'Rolled oats, dry', null, 40, 'g', 152, 5.1, 27.1, 3.2, 4],
  ['starter-greek-yogurt', 'Greek yogurt, plain nonfat', null, 170, 'g', 100, 17, 6, 0.7, 0],
  ['starter-tofu', 'Firm tofu', null, 100, 'g', 144, 17.3, 2.8, 8.7, 2.3],
  ['starter-salmon', 'Salmon, cooked', null, 100, 'g', 206, 22.1, 0, 12.4, 0],
  ['starter-broccoli', 'Broccoli, cooked', null, 100, 'g', 35, 2.4, 7.2, 0.4, 3.3],
  ['starter-milk', 'Milk, 2%', null, 250, 'ml', 125, 8.3, 12, 5, 0],
  ['starter-peanut-butter', 'Peanut butter', null, 32, 'g', 188, 8, 6.9, 16, 1.9],
] as const;

export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  // A single browser worker owns the OPFS database. DELETE journaling avoids
  // retaining a second WAL file/access handle across navigation reloads.
  await db.execAsync(
    Platform.OS === 'web'
      ? 'PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE;'
      : 'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;',
  );
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');

  const currentVersion = version?.user_version ?? 0;

  if (currentVersion < 1) {
    await db.execAsync(`
    CREATE TABLE IF NOT EXISTS exercises (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT,
      name TEXT NOT NULL,
      movement_pattern TEXT NOT NULL,
      primary_muscle_group TEXT NOT NULL,
      secondary_muscle_groups TEXT NOT NULL DEFAULT '[]',
      equipment TEXT,
      target_rep_min INTEGER NOT NULL DEFAULT 8,
      target_rep_max INTEGER NOT NULL DEFAULT 12,
      load_increment REAL NOT NULL DEFAULT 2.5,
      notes TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      client_updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS workouts (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      performed_on TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      client_updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS workout_sets (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT,
      workout_id TEXT NOT NULL REFERENCES workouts(id),
      exercise_id TEXT NOT NULL REFERENCES exercises(id),
      sort_order INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'working',
      reps INTEGER NOT NULL,
      load_value REAL NOT NULL,
      load_unit TEXT NOT NULL DEFAULT 'kg',
      rpe REAL,
      completed_at TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      client_updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS meals (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT,
      name TEXT NOT NULL,
      type TEXT,
      eaten_on TEXT NOT NULL,
      eaten_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      client_updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS food_items (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT,
      meal_id TEXT NOT NULL REFERENCES meals(id),
      sort_order INTEGER NOT NULL,
      name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      calories_kcal REAL NOT NULL,
      protein_g REAL NOT NULL,
      carbohydrate_g REAL NOT NULL,
      fat_g REAL NOT NULL,
      fibre_g REAL,
      source TEXT NOT NULL DEFAULT 'manual',
      confidence REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      client_updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS nutrition_targets (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      calories_kcal REAL NOT NULL,
      protein_g REAL NOT NULL,
      carbohydrate_g REAL NOT NULL,
      fat_g REAL NOT NULL,
      fibre_g REAL,
      source TEXT NOT NULL DEFAULT 'manual',
      rationale TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      client_updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS notification_preferences (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT,
      type TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 0,
      quiet_hours_start TEXT,
      quiet_hours_end TEXT,
      timezone TEXT NOT NULL,
      minimum_interval_minutes INTEGER NOT NULL DEFAULT 720,
      last_notified_at TEXT,
      conditions TEXT NOT NULL DEFAULT '{}',
      scheduled_notification_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      client_updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY NOT NULL,
      table_name TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL DEFAULT 'upsert',
      payload_json TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      created_at TEXT NOT NULL,
      last_error TEXT,
      UNIQUE(table_name, entity_id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS workouts_timeline_idx ON workouts(performed_on DESC, started_at DESC);
    CREATE INDEX IF NOT EXISTS workout_sets_workout_idx ON workout_sets(workout_id, sort_order);
    CREATE INDEX IF NOT EXISTS workout_sets_exercise_idx ON workout_sets(exercise_id, completed_at DESC);
    CREATE INDEX IF NOT EXISTS meals_timeline_idx ON meals(eaten_on DESC, eaten_at DESC);
    CREATE INDEX IF NOT EXISTS food_items_meal_idx ON food_items(meal_id, sort_order);
    CREATE INDEX IF NOT EXISTS sync_queue_retry_idx ON sync_queue(next_attempt_at, created_at);
    `);

    const now = new Date().toISOString();
    await db.withTransactionAsync(async () => {
      for (const exercise of DEFAULT_EXERCISES) {
        await db.runAsync(
          `INSERT OR IGNORE INTO exercises (
            id, name, movement_pattern, primary_muscle_group, secondary_muscle_groups,
            equipment, target_rep_min, target_rep_max, load_increment,
            created_at, updated_at, client_updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...exercise, now, now, now],
        );
      }
      await db.execAsync('PRAGMA user_version = 1;');
    });
  }

  if (currentVersion < 2) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS user_profile (
        id TEXT PRIMARY KEY NOT NULL CHECK (id = 'current'),
        training_experience TEXT NOT NULL,
        available_equipment TEXT NOT NULL DEFAULT '[]',
        injury_flags TEXT NOT NULL DEFAULT '[]',
        goals TEXT NOT NULL DEFAULT '[]',
        typical_diet_pattern TEXT NOT NULL,
        preferred_load_unit TEXT NOT NULL DEFAULT 'kg',
        ai_data_consent INTEGER NOT NULL DEFAULT 0,
        ai_data_consented_at TEXT,
        onboarding_completed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        client_updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 2;
    `);
  }

  if (currentVersion < 3) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS wellness_logs (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT,
        kind TEXT NOT NULL,
        logged_on TEXT NOT NULL,
        logged_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        mood_score INTEGER,
        energy_score INTEGER,
        stress_score INTEGER,
        soreness_score INTEGER,
        motivation_score INTEGER,
        sleep_duration_minutes INTEGER,
        sleep_quality_score INTEGER,
        body_weight_kg REAL,
        injury_flags TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        client_updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS wellness_logs_timeline_idx ON wellness_logs(kind, logged_at DESC);
      PRAGMA user_version = 3;
    `);
  }

  if (currentVersion < 4) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS food_catalog_cache (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        brand TEXT,
        serving_quantity REAL NOT NULL,
        serving_unit TEXT NOT NULL,
        calories_kcal REAL NOT NULL,
        protein_g REAL NOT NULL,
        carbohydrate_g REAL NOT NULL,
        fat_g REAL NOT NULL,
        fibre_g REAL,
        source TEXT NOT NULL,
        source_ref TEXT,
        barcode TEXT,
        updated_at TEXT NOT NULL,
        last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS food_catalog_name_idx ON food_catalog_cache(name);
      CREATE UNIQUE INDEX IF NOT EXISTS food_catalog_source_ref_idx ON food_catalog_cache(source, source_ref) WHERE source_ref IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS food_catalog_barcode_idx ON food_catalog_cache(barcode) WHERE barcode IS NOT NULL;
    `);
    const foodNow = new Date().toISOString();
    await db.withTransactionAsync(async () => {
      for (const food of STARTER_FOODS) {
        await db.runAsync(
          `INSERT OR IGNORE INTO food_catalog_cache (
            id, name, brand, serving_quantity, serving_unit, calories_kcal,
            protein_g, carbohydrate_g, fat_g, fibre_g, source, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'starter', ?)`,
          [...food, foodNow],
        );
      }
      await db.execAsync('PRAGMA user_version = 4;');
    });
  }

  if (currentVersion < 5) {
    // A browser can be closed between individual schema statements. Inspect the
    // table before ALTER so an interrupted v5 upgrade remains safe to retry.
    await addColumnIfMissing(
      db,
      'user_profile',
      'medical_disclaimer_acknowledged_at',
      'TEXT',
    );
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS ai_conversations (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT,
        purpose TEXT NOT NULL DEFAULT 'wellness',
        title TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        last_message_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        client_updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS ai_messages (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT,
        conversation_id TEXT NOT NULL REFERENCES ai_conversations(id),
        sequence INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        structured_content TEXT NOT NULL DEFAULT '{}',
        metadata TEXT NOT NULL DEFAULT '{}',
        model TEXT,
        provider_message_id TEXT,
        local_status TEXT NOT NULL DEFAULT 'complete',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        client_updated_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE(conversation_id, sequence)
      );

      CREATE INDEX IF NOT EXISTS ai_conversations_recent_idx
        ON ai_conversations(status, last_message_at DESC);
      CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx
        ON ai_messages(conversation_id, sequence);
      PRAGMA user_version = 5;
    `);
  }

  if (currentVersion < 6) {
    const exerciseNow = new Date().toISOString();
    await db.withTransactionAsync(async () => {
      for (const exercise of DEFAULT_EXERCISES) {
        await db.runAsync(
          `INSERT OR IGNORE INTO exercises (
            id, name, movement_pattern, primary_muscle_group, secondary_muscle_groups,
            equipment, target_rep_min, target_rep_max, load_increment,
            created_at, updated_at, client_updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...exercise, exerciseNow, exerciseNow, exerciseNow],
        );
      }
      await db.execAsync('PRAGMA user_version = 6;');
    });
  }

  if (currentVersion < 7) {
    await addColumnIfMissing(db, 'meals', 'is_user_edited', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(db, 'food_items', 'original_source', 'TEXT');
    await addColumnIfMissing(db, 'food_items', 'original_confidence', 'REAL');
    await addColumnIfMissing(db, 'food_items', 'is_user_edited', 'INTEGER NOT NULL DEFAULT 0');
    await db.withTransactionAsync(async () => {
      await db.runAsync(`UPDATE food_items
        SET original_source = COALESCE(original_source, source),
            original_confidence = COALESCE(original_confidence, confidence)
        WHERE original_source IS NULL OR (original_confidence IS NULL AND confidence IS NOT NULL)`);
      await db.execAsync('PRAGMA user_version = 7;');
    });
  }

  if (currentVersion < 8) {
    await addColumnIfMissing(db, 'sync_queue', 'failure_kind', 'TEXT');
    await addColumnIfMissing(db, 'sync_queue', 'failure_code', 'TEXT');
    await addColumnIfMissing(db, 'sync_queue', 'retry_paused', 'INTEGER NOT NULL DEFAULT 0');
    await db.runAsync(
      `UPDATE sync_queue
       SET failure_kind = COALESCE(failure_kind, 'transient'),
           failure_code = COALESCE(failure_code, 'LEGACY_RETRY'),
           last_error = 'A previous cloud sync attempt is waiting to retry.'
       WHERE attempt_count > 0`,
    );
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS sync_queue_pause_retry_idx
        ON sync_queue(retry_paused, next_attempt_at, created_at);
      PRAGMA user_version = 8;
    `);
  }
}
