import type { SQLiteDatabase } from 'expo-sqlite';

import { hasAccountConflict, needsFullReconciliation, preserveLocalAiMetadata, serializeCloudValue } from './cloud-sync-mappers';
import { getSetting, setSetting } from './settings';
import { getSupabaseClient } from './supabase';
import { syncPendingChanges, type SyncResult } from './sync-queue';
import type { FitnessGoal, LoadUnit, TrainingExperience } from './types';

const ACCOUNT_OWNER_KEY = 'cloud_owner_user_id';
const LAST_FULL_RECONCILE_KEY = 'cloud_last_full_reconcile_at';
const PAGE_SIZE = 250;
const FULL_RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;

type PullTable =
  | 'exercises'
  | 'workouts'
  | 'sets'
  | 'meals'
  | 'food_items'
  | 'nutrition_targets'
  | 'wellness_logs'
  | 'ai_conversations'
  | 'ai_messages'
  | 'notification_preferences';

const PULL_TABLES: PullTable[] = [
  'exercises',
  'workouts',
  'meals',
  'nutrition_targets',
  'wellness_logs',
  'ai_conversations',
  'notification_preferences',
  'sets',
  'food_items',
  'ai_messages',
];

const LOCAL_TABLE: Record<PullTable, string> = {
  exercises: 'exercises',
  workouts: 'workouts',
  sets: 'workout_sets',
  meals: 'meals',
  food_items: 'food_items',
  nutrition_targets: 'nutrition_targets',
  wellness_logs: 'wellness_logs',
  ai_conversations: 'ai_conversations',
  ai_messages: 'ai_messages',
  notification_preferences: 'notification_preferences',
};

type RemoteProfile = {
  training_experience: TrainingExperience | null;
  available_equipment: string[] | null;
  injury_flags: unknown;
  goals: FitnessGoal[] | null;
  typical_diet_pattern: string | null;
  preferred_load_unit: LoadUnit;
  ai_data_consent: boolean;
  ai_data_consented_at: string | null;
  medical_disclaimer_acknowledged_at: string | null;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
  client_updated_at: string;
};

type ColumnInfo = { name: string };
type RemoteRow = Record<string, unknown> & { id: string; client_updated_at: string };
type PullCursor = { clientUpdatedAt: string; id: string };

export type AccountSyncResult =
  | { state: 'synced'; pushed: number; pulled: number; profileRestored: boolean }
  | { state: 'offline' | 'not_configured' | 'signed_out'; pushed: 0; pulled: 0; profileRestored: false }
  | { state: 'partial'; pushed: number; pulled: number; profileRestored: boolean; error: string }
  | { state: 'account_conflict'; pushed: 0; pulled: 0; profileRestored: false };

let activeAccountSync: Promise<AccountSyncResult> | null = null;

function isCompleteProfile(row: RemoteProfile | null): row is RemoteProfile & {
  training_experience: TrainingExperience;
  typical_diet_pattern: string;
  onboarding_completed_at: string;
} {
  return Boolean(
    row?.training_experience
    && row.typical_diet_pattern?.trim()
    && row.onboarding_completed_at
    && Array.isArray(row.available_equipment)
    && row.available_equipment.length > 0
    && Array.isArray(row.goals)
    && row.goals.length > 0,
  );
}

async function restoreProfile(db: SQLiteDatabase, userId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    .select('training_experience,available_equipment,injury_flags,goals,typical_diet_pattern,preferred_load_unit,ai_data_consent,ai_data_consented_at,medical_disclaimer_acknowledged_at,onboarding_completed_at,created_at,updated_at,client_updated_at')
    .eq('id', userId)
    .maybeSingle<RemoteProfile>();
  if (error) throw error;
  if (!isCompleteProfile(data)) return false;

  await db.runAsync(
    `INSERT INTO user_profile (
      id, training_experience, available_equipment, injury_flags, goals,
      typical_diet_pattern, preferred_load_unit, ai_data_consent,
      ai_data_consented_at, medical_disclaimer_acknowledged_at,
      onboarding_completed_at, created_at, updated_at, client_updated_at
    ) VALUES ('current', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      training_experience = excluded.training_experience,
      available_equipment = excluded.available_equipment,
      injury_flags = excluded.injury_flags,
      goals = excluded.goals,
      typical_diet_pattern = excluded.typical_diet_pattern,
      preferred_load_unit = excluded.preferred_load_unit,
      ai_data_consent = excluded.ai_data_consent,
      ai_data_consented_at = excluded.ai_data_consented_at,
      medical_disclaimer_acknowledged_at = excluded.medical_disclaimer_acknowledged_at,
      onboarding_completed_at = excluded.onboarding_completed_at,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      client_updated_at = excluded.client_updated_at
    WHERE julianday(excluded.client_updated_at) >= julianday(user_profile.client_updated_at)`,
    [
      data.training_experience,
      JSON.stringify(data.available_equipment),
      JSON.stringify(Array.isArray(data.injury_flags) ? data.injury_flags : []),
      JSON.stringify(data.goals),
      data.typical_diet_pattern.trim(),
      data.preferred_load_unit,
      data.ai_data_consent ? 1 : 0,
      data.ai_data_consented_at,
      data.medical_disclaimer_acknowledged_at,
      data.onboarding_completed_at,
      data.created_at,
      data.updated_at,
      data.client_updated_at,
    ],
  );
  return true;
}

async function applyRemoteRows(
  db: SQLiteDatabase,
  remoteTable: PullTable,
  rows: RemoteRow[],
  cursor: PullCursor,
): Promise<void> {
  if (rows.length === 0) return;
  const localTable = LOCAL_TABLE[remoteTable];
  const columnInfo = await db.getAllAsync<ColumnInfo>(`PRAGMA table_info("${localTable}")`);
  const localColumns = new Set(columnInfo.map((column) => column.name));

  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      let columns = Object.keys(row).filter((column) => localColumns.has(column));
      if (remoteTable === 'ai_messages') {
        const existing = await db.getFirstAsync<{ local_status: string }>(
          'SELECT local_status FROM ai_messages WHERE id = ?',
          [row.id],
        );
        if (preserveLocalAiMetadata(existing?.local_status)) {
          columns = columns.filter((column) => column !== 'metadata');
        }
      }
      if (!columns.includes('id') || !columns.includes('client_updated_at')) continue;
      const quotedColumns = columns.map((column) => `"${column}"`);
      const updates = columns
        .filter((column) => column !== 'id')
        .map((column) => `"${column}" = excluded."${column}"`);
      await db.runAsync(
        `INSERT INTO "${localTable}" (${quotedColumns.join(', ')})
         VALUES (${columns.map(() => '?').join(', ')})
         ON CONFLICT("id") DO UPDATE SET ${updates.join(', ')}
         WHERE julianday(excluded."client_updated_at") >= julianday("${localTable}"."client_updated_at")`,
        columns.map((column) => serializeCloudValue(row[column]) as string | number | null),
      );
    }
    await setSetting(db, `cloud_pull_cursor_${remoteTable}`, JSON.stringify(cursor));
  });
}

async function pullTable(
  db: SQLiteDatabase,
  userId: string,
  table: PullTable,
  fullReconcile: boolean,
): Promise<number> {
  const supabase = getSupabaseClient();
  let pulled = 0;
  const storedCursor = await getSetting(db, `cloud_pull_cursor_${table}`);
  let cursor: PullCursor | null = null;
  if (storedCursor && !fullReconcile) {
    try {
      const parsed = JSON.parse(storedCursor) as PullCursor;
      if (parsed.clientUpdatedAt && parsed.id) cursor = parsed;
    } catch {
      cursor = null;
    }
  }

  while (true) {
    let query = supabase
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .order('client_updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
    if (cursor) {
      query = query.or(
        `client_updated_at.gt.${cursor.clientUpdatedAt},and(client_updated_at.eq.${cursor.clientUpdatedAt},id.gt.${cursor.id})`,
      );
    }
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as RemoteRow[];
    if (rows.length === 0) break;
    const last = rows[rows.length - 1]!;
    cursor = { clientUpdatedAt: last.client_updated_at, id: last.id };
    await applyRemoteRows(db, table, rows, cursor);
    pulled += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }
  return pulled;
}

function mapPushFailure(result: Exclude<SyncResult, { state: 'synced' }>): AccountSyncResult {
  if (result.state === 'partial') {
    return { state: 'partial', pushed: result.processed, pulled: 0, profileRestored: false, error: result.error };
  }
  return { state: result.state, pushed: 0, pulled: 0, profileRestored: false };
}

async function runAccountSync(db: SQLiteDatabase): Promise<AccountSyncResult> {
  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch {
    return { state: 'not_configured', pushed: 0, pulled: 0, profileRestored: false };
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    return { state: 'partial', pushed: 0, pulled: 0, profileRestored: false, error: sessionError.message };
  }
  const userId = sessionData.session?.user.id;
  if (!userId) return { state: 'signed_out', pushed: 0, pulled: 0, profileRestored: false };

  const ownerId = await getSetting(db, ACCOUNT_OWNER_KEY);
  if (hasAccountConflict(ownerId, userId)) {
    await supabase.auth.signOut();
    return { state: 'account_conflict', pushed: 0, pulled: 0, profileRestored: false };
  }
  if (!ownerId) await setSetting(db, ACCOUNT_OWNER_KEY, userId);

  const pushResult = await syncPendingChanges(db);
  if (pushResult.state !== 'synced') return mapPushFailure(pushResult);

  try {
    const profileRestored = await restoreProfile(db, userId);
    const lastFullReconcile = await getSetting(db, LAST_FULL_RECONCILE_KEY);
    const fullReconcile = needsFullReconciliation(
      lastFullReconcile,
      Date.now(),
      FULL_RECONCILE_INTERVAL_MS,
    );
    let pulled = 0;
    for (const table of PULL_TABLES) pulled += await pullTable(db, userId, table, fullReconcile);
    if (fullReconcile) await setSetting(db, LAST_FULL_RECONCILE_KEY, new Date().toISOString());
    return { state: 'synced', pushed: pushResult.processed, pulled, profileRestored };
  } catch (cause) {
    return {
      state: 'partial',
      pushed: pushResult.processed,
      pulled: 0,
      profileRestored: false,
      error: cause instanceof Error ? cause.message : 'Cloud restore failed',
    };
  }
}

export async function syncAccountData(db: SQLiteDatabase): Promise<AccountSyncResult> {
  if (activeAccountSync) return activeAccountSync;
  activeAccountSync = runAccountSync(db);
  try {
    return await activeAccountSync;
  } finally {
    activeAccountSync = null;
  }
}
