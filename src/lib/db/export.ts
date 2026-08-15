import type { SQLiteDatabase } from 'expo-sqlite';

export type ExportDatabaseRow = Record<string, unknown>;

export type CompleteExportSnapshot = {
  databaseSchemaVersion: number;
  cloudOwnerUserId: string | null;
  profile: ExportDatabaseRow | null;
  exercises: ExportDatabaseRow[];
  workouts: ExportDatabaseRow[];
  workoutSets: ExportDatabaseRow[];
  meals: ExportDatabaseRow[];
  foodItems: ExportDatabaseRow[];
  nutritionTargets: ExportDatabaseRow[];
  wellnessLogs: ExportDatabaseRow[];
  aiConversations: ExportDatabaseRow[];
  aiMessages: ExportDatabaseRow[];
  notificationPreferences: ExportDatabaseRow[];
};

/**
 * Read the complete user-facing export snapshot from SQLite.
 *
 * This deliberately selects logical data columns rather than `SELECT *`: auth
 * credentials, sync queue internals, device notification IDs, and pull cursors
 * must never become part of a portable health-data export. Tombstones are not
 * included; the JSON envelope documents that active-record policy.
 */
export async function getCompleteExportSnapshot(
  db: SQLiteDatabase,
): Promise<CompleteExportSnapshot> {
  const [
    version,
    owner,
    profile,
    exercises,
    workouts,
    workoutSets,
    meals,
    foodItems,
    nutritionTargets,
    wellnessLogs,
    aiConversations,
    aiMessages,
    notificationPreferences,
  ] = await Promise.all([
    db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'),
    db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'cloud_owner_user_id'`,
    ),
    db.getFirstAsync<ExportDatabaseRow>(
      `SELECT training_experience, available_equipment, injury_flags, goals,
              typical_diet_pattern, preferred_load_unit, ai_data_consent,
              ai_data_consented_at, medical_disclaimer_acknowledged_at,
              onboarding_completed_at, created_at, updated_at, client_updated_at
       FROM user_profile WHERE id = 'current'`,
    ),
    db.getAllAsync<ExportDatabaseRow>(
      `SELECT id, user_id, name, movement_pattern, primary_muscle_group,
              secondary_muscle_groups, equipment, target_rep_min, target_rep_max,
              load_increment, notes, is_archived, created_at, updated_at,
              client_updated_at, deleted_at
       FROM exercises
       WHERE deleted_at IS NULL
       ORDER BY name COLLATE NOCASE ASC, id ASC`,
    ),
    db.getAllAsync<ExportDatabaseRow>(
      `SELECT id, title, status, performed_on, scheduled_at, started_at, completed_at,
              notes, plan_json,
              created_at, updated_at, client_updated_at, deleted_at
       FROM workouts
       WHERE deleted_at IS NULL
       ORDER BY performed_on ASC, COALESCE(started_at, '') ASC, id ASC`,
    ),
    db.getAllAsync<ExportDatabaseRow>(
      `SELECT id, workout_id, exercise_id, sort_order, kind, reps, load_value,
              load_unit, rpe, completed_at, notes, created_at, updated_at,
              client_updated_at, deleted_at
       FROM workout_sets
       WHERE deleted_at IS NULL
       ORDER BY workout_id ASC, sort_order ASC, id ASC`,
    ),
    db.getAllAsync<ExportDatabaseRow>(
      `SELECT id, name, type, eaten_on, eaten_at, source, notes, is_user_edited,
              created_at, updated_at, client_updated_at, deleted_at
       FROM meals
       WHERE deleted_at IS NULL
       ORDER BY eaten_on ASC, eaten_at ASC, id ASC`,
    ),
    db.getAllAsync<ExportDatabaseRow>(
      `SELECT id, meal_id, sort_order, name, quantity, unit, calories_kcal,
              protein_g, carbohydrate_g, fat_g, fibre_g, source, confidence,
              original_source, original_confidence, is_user_edited, created_at,
              updated_at, client_updated_at, deleted_at
       FROM food_items
       WHERE deleted_at IS NULL
       ORDER BY meal_id ASC, sort_order ASC, id ASC`,
    ),
    db.getAllAsync<ExportDatabaseRow>(
      `SELECT id, effective_from, effective_to, calories_kcal, protein_g,
              carbohydrate_g, fat_g, fibre_g, source, rationale, created_at,
              updated_at, client_updated_at, deleted_at
       FROM nutrition_targets
       WHERE deleted_at IS NULL
       ORDER BY effective_from ASC, id ASC`,
    ),
    db.getAllAsync<ExportDatabaseRow>(
      `SELECT id, kind, logged_on, logged_at, source, mood_score, energy_score,
              stress_score, soreness_score, motivation_score,
              sleep_duration_minutes, sleep_quality_score, body_weight_kg,
              injury_flags, notes, metadata, created_at, updated_at,
              client_updated_at, deleted_at
       FROM wellness_logs
       WHERE deleted_at IS NULL
       ORDER BY logged_at ASC, id ASC`,
    ),
    db.getAllAsync<ExportDatabaseRow>(
      `SELECT id, purpose, title, status, last_message_at, created_at, updated_at,
              client_updated_at, deleted_at
       FROM ai_conversations
       WHERE deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`,
    ),
    db.getAllAsync<ExportDatabaseRow>(
      `SELECT id, conversation_id, sequence, role, content, structured_content,
              metadata, model, provider_message_id, local_status, created_at,
              updated_at, client_updated_at, deleted_at
       FROM ai_messages
       WHERE deleted_at IS NULL
       ORDER BY conversation_id ASC, sequence ASC, id ASC`,
    ),
    db.getAllAsync<ExportDatabaseRow>(
      `SELECT id, type, enabled, quiet_hours_start, quiet_hours_end, timezone,
              minimum_interval_minutes, last_notified_at, conditions, created_at,
              updated_at, client_updated_at, deleted_at
       FROM notification_preferences
       WHERE deleted_at IS NULL
       ORDER BY type ASC, id ASC`,
    ),
  ]);

  return {
    databaseSchemaVersion: version?.user_version ?? 0,
    cloudOwnerUserId: owner?.value ?? null,
    profile,
    exercises,
    workouts,
    workoutSets,
    meals,
    foodItems,
    nutritionTargets,
    wellnessLogs,
    aiConversations,
    aiMessages,
    notificationPreferences,
  };
}
