import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getSupabaseClient } from './supabase';
import { hasAccountConflict } from './cloud-sync-mappers';
import {
  buildSyncQueueFailureUpdate,
  shouldResetPausedSyncFailures,
  type SyncRetryTrigger,
} from './sync-policy';
import type { SyncStatus } from './types';
import { announceQueuedLocalWrite } from './write-sync-signal';

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
      last_error = NULL,
      failure_kind = NULL,
      failure_code = NULL,
      retry_paused = 0`,
    [Crypto.randomUUID(), table, entityId, JSON.stringify(payload), now],
  );
  announceQueuedLocalWrite();
}

export async function getSyncStatus(db: SQLiteDatabase): Promise<SyncStatus> {
  const row = await db.getFirstAsync<{
    pending_count: number;
    failed_count: number;
    action_required_count: number;
    last_error: string | null;
  }>(`SELECT
      COUNT(*) AS pending_count,
      SUM(CASE WHEN attempt_count > 0 THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN retry_paused = 1 THEN 1 ELSE 0 END) AS action_required_count,
      MAX(last_error) AS last_error
    FROM sync_queue`);

  return {
    pendingCount: row?.pending_count ?? 0,
    failedCount: row?.failed_count ?? 0,
    actionRequiredCount: row?.action_required_count ?? 0,
    lastError: row?.last_error ?? null,
  };
}

export type SyncResult =
  | { state: 'synced'; processed: number }
  | { state: 'offline' | 'not_configured' | 'signed_out' | 'account_conflict'; processed: 0 }
  | { state: 'partial'; processed: number; error: string; retryAt: string }
  | { state: 'action_required'; processed: number; error: string; code: string };

export async function syncPendingChanges(
  db: SQLiteDatabase,
  options: { trigger?: SyncRetryTrigger; now?: () => number; random?: () => number } = {},
): Promise<SyncResult> {
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

  const owner = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'cloud_owner_user_id'`,
  );
  if (hasAccountConflict(owner?.value, userId)) {
    await supabase.auth.signOut();
    return { state: 'account_conflict', processed: 0 };
  }

  if (shouldResetPausedSyncFailures(options.trigger ?? 'background')) {
    await db.runAsync(
      `UPDATE sync_queue
       SET retry_paused = 0, next_attempt_at = NULL
       WHERE retry_paused = 1`,
    );
  }

  const nowMs = options.now?.() ?? Date.now();

  const blockedBeforePush = await db.getFirstAsync<{
    paused_count: number;
    paused_error: string | null;
    paused_code: string | null;
    delayed_count: number;
    retry_at: string | null;
    delayed_error: string | null;
  }>(
    `SELECT
       SUM(CASE WHEN retry_paused = 1 THEN 1 ELSE 0 END) AS paused_count,
       MAX(CASE WHEN retry_paused = 1 THEN last_error END) AS paused_error,
       MAX(CASE WHEN retry_paused = 1 THEN failure_code END) AS paused_code,
       SUM(CASE WHEN retry_paused = 0 AND next_attempt_at > ? THEN 1 ELSE 0 END) AS delayed_count,
       MIN(CASE WHEN retry_paused = 0 AND next_attempt_at > ? THEN next_attempt_at END) AS retry_at,
       MAX(CASE WHEN retry_paused = 0 AND next_attempt_at > ? THEN last_error END) AS delayed_error
     FROM sync_queue`,
    [new Date(nowMs).toISOString(), new Date(nowMs).toISOString(), new Date(nowMs).toISOString()],
  );
  if ((blockedBeforePush?.paused_count ?? 0) > 0) {
    return {
      state: 'action_required',
      processed: 0,
      error: blockedBeforePush?.paused_error ?? 'Cloud sync needs attention before queued records can continue.',
      code: blockedBeforePush?.paused_code ?? 'UNKNOWN',
    };
  }
  if ((blockedBeforePush?.delayed_count ?? 0) > 0) {
    return {
      state: 'partial',
      processed: 0,
      error: blockedBeforePush?.delayed_error ?? 'Queued records are waiting for their next automatic retry.',
      retryAt: blockedBeforePush?.retry_at ?? new Date(nowMs + 60_000).toISOString(),
    };
  }

  const rows = await db.getAllAsync<QueueRow>(
    `SELECT id, table_name, entity_id, operation, payload_json, attempt_count
     FROM sync_queue
     WHERE retry_paused = 0
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY created_at ASC`,
    [new Date(nowMs).toISOString()],
  );
  rows.sort((a, b) => TABLE_PRIORITY[a.table_name] - TABLE_PRIORITY[b.table_name]);

  let processed = 0;
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      const ownedPayload = { ...payload, user_id: userId };
      const { error } = row.table_name === 'users'
        ? await supabase.from('users').upsert({ ...payload, id: userId })
        : row.table_name === 'exercises'
          ? await supabase.from('exercises').upsert(ownedPayload, { onConflict: 'id,user_id' })
          : row.table_name === 'notification_preferences'
            ? await supabase.from('notification_preferences').upsert(ownedPayload, { onConflict: 'user_id,type' })
            : await supabase.from(row.table_name).upsert(ownedPayload);
      if (error) {
        throw error;
      }
      await db.runAsync('DELETE FROM sync_queue WHERE id = ?', [row.id]);
      announceQueuedLocalWrite();
      processed += 1;
    } catch (error) {
      const update = buildSyncQueueFailureUpdate(
        row.attempt_count,
        error,
        nowMs,
        options.random,
      );
      await db.runAsync(
        `UPDATE sync_queue
         SET attempt_count = ?, next_attempt_at = ?, last_error = ?,
             failure_kind = ?, failure_code = ?, retry_paused = ?
         WHERE id = ?`,
        [
          update.attemptCount,
          update.nextAttemptAt,
          update.safeMessage,
          update.failureKind,
          update.failureCode,
          update.retryPaused ? 1 : 0,
          row.id,
        ],
      );
      announceQueuedLocalWrite();
      return update.retryPaused
        ? { state: 'action_required', processed, error: update.safeMessage, code: update.failureCode }
        : { state: 'partial', processed, error: update.safeMessage, retryAt: update.nextAttemptAt! };
    }
  }

  const paused = await db.getFirstAsync<{ count: number; last_error: string | null; failure_code: string | null }>(
    `SELECT COUNT(*) AS count, MAX(last_error) AS last_error, MAX(failure_code) AS failure_code
     FROM sync_queue WHERE retry_paused = 1`,
  );
  if ((paused?.count ?? 0) > 0) {
    return {
      state: 'action_required',
      processed,
      error: paused?.last_error ?? 'Cloud sync needs attention before queued records can continue.',
      code: paused?.failure_code ?? 'UNKNOWN',
    };
  }

  const delayed = await db.getFirstAsync<{ count: number; retry_at: string | null; last_error: string | null }>(
    `SELECT COUNT(*) AS count, MIN(next_attempt_at) AS retry_at, MAX(last_error) AS last_error
     FROM sync_queue WHERE retry_paused = 0`,
  );
  if ((delayed?.count ?? 0) > 0) {
    return {
      state: 'partial',
      processed,
      error: delayed?.last_error ?? 'Queued records are waiting for their next automatic retry.',
      retryAt: delayed?.retry_at ?? new Date(nowMs + 60_000).toISOString(),
    };
  }

  return { state: 'synced', processed };
}
