import type { SQLiteDatabase } from 'expo-sqlite';

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
] as const;

export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');

  if ((version?.user_version ?? 0) >= 1) {
    return;
  }

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
