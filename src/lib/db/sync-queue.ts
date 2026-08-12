import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getSupabaseClient } from './supabase';
import type { SyncStatus } from './types';

export type RemoteTable =
  | 'users'
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

type QueueRow = {
  id: string;
  table_name: RemoteTable;
  entity_id: string;
  operation: 'upsert';
  payload_json: string;
  attempt_count: number;
};

const TABLE_PRIORITY: Record<RemoteTable, number> = {
  users: 0,
  exercises: 0,
  workouts: 1,
  meals: 1,
  nutrition_targets: 1,
  wellness_logs: 1,
  ai_conversations: 1,
  notification_preferences: 1,
  sets: 2,
  food_items: 2,
  ai_messages: 2,
};

export async function enqueueUpsert(
  db: SQLiteDatabase,
  table: RemoteTable,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO sync_queue (
      id, table_name, entity_id, operation, payload_json, created_at
    ) VALUES (?, ?, ?, 'upsert', ?, ?)
    ON CONFLICT(table_name, entity_id) DO UPDATE SET
      operation = excluded.operation,
      payload_json = excluded.payload_json,
      attempt_count = 0,
      next_attempt_at = NULL,
      last_error = NULL`,
    [Crypto.randomUUID(), table, entityId, JSON.stringify(payload), now],
  );
}

export async function getSyncStatus(db: SQLiteDatabase): Promise<SyncStatus> {
  const row = await db.getFirstAsync<{
    pending_count: number;
    failed_count: number;
    last_error: string | null;
  }>(`SELECT
      COUNT(*) AS pending_count,
      SUM(CASE WHEN attempt_count > 0 THEN 1 ELSE 0 END) AS failed_count,
      MAX(last_error) AS last_error
    FROM sync_queue`);

  return {
    pendingCount: row?.pending_count ?? 0,
    failedCount: row?.failed_count ?? 0,
    lastError: row?.last_error ?? null,
  };
}

export type SyncResult =
  | { state: 'synced'; processed: number }
  | { state: 'offline' | 'not_configured' | 'signed_out'; processed: 0 }
  | { state: 'partial'; processed: number; error: string };

export async function syncPendingChanges(db: SQLiteDatabase): Promise<SyncResult> {
  const network = await Network.getNetworkStateAsync();
  if (!network.isConnected || network.isInternetReachable === false) {
    return { state: 'offline', processed: 0 };
  }

  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch {
    return { state: 'not_configured', processed: 0 };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) {
    return { state: 'signed_out', processed: 0 };
  }

  const rows = await db.getAllAsync<QueueRow>(
    `SELECT id, table_name, entity_id, operation, payload_json, attempt_count
     FROM sync_queue
     WHERE next_attempt_at IS NULL OR next_attempt_at <= ?
     ORDER BY created_at ASC`,
    [new Date().toISOString()],
  );
  rows.sort((a, b) => TABLE_PRIORITY[a.table_name] - TABLE_PRIORITY[b.table_name]);

  let processed = 0;
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      const { error } = row.table_name === 'users'
        ? await supabase.from('users').upsert({ ...payload, id: userId })
        : await supabase.from(row.table_name).upsert({ ...payload, user_id: userId });
      if (error) {
        throw error;
      }
      await db.runAsync('DELETE FROM sync_queue WHERE id = ?', [row.id]);
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      const attempt = row.attempt_count + 1;
      const delayMinutes = Math.min(60, 2 ** Math.min(attempt, 5));
      const nextAttempt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
      await db.runAsync(
        `UPDATE sync_queue
         SET attempt_count = ?, next_attempt_at = ?, last_error = ?
         WHERE id = ?`,
        [attempt, nextAttempt, message.slice(0, 300), row.id],
      );
      return { state: 'partial', processed, error: message };
    }
  }

  return { state: 'synced', processed };
}
