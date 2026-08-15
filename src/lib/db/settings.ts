import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { enqueueUpsert } from './sync-queue';
import type { NotificationPreference, NotificationType } from './types';

export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

export async function setSetting(
  db: SQLiteDatabase,
  key: string,
  value: string,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, new Date().toISOString()],
  );
}

export async function listNotificationPreferences(
  db: SQLiteDatabase,
): Promise<NotificationPreference[]> {
  const rows = await db.getAllAsync<{
    id: string;
    type: NotificationType;
    enabled: number;
    quiet_hours_start: string | null;
    quiet_hours_end: string | null;
    timezone: string;
    minimum_interval_minutes: number;
    last_notified_at: string | null;
    conditions: string;
  }>('SELECT * FROM notification_preferences WHERE deleted_at IS NULL ORDER BY type');
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    enabled: row.enabled === 1,
    quietHoursStart: row.quiet_hours_start,
    quietHoursEnd: row.quiet_hours_end,
    timezone: row.timezone,
    minimumIntervalMinutes: row.minimum_interval_minutes,
    lastNotifiedAt: row.last_notified_at,
    conditions: JSON.parse(row.conditions) as Record<string, unknown>,
  }));
}

export async function getNotificationPreference(
  db: SQLiteDatabase,
  type: NotificationType,
): Promise<NotificationPreference | null> {
  const preferences = await listNotificationPreferences(db);
  return preferences.find((preference) => preference.type === type) ?? null;
}

export async function getScheduledNotificationId(
  db: SQLiteDatabase,
  type: NotificationType,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ scheduled_notification_id: string | null }>(
    'SELECT scheduled_notification_id FROM notification_preferences WHERE type = ?',
    [type],
  );
  return row?.scheduled_notification_id ?? null;
}

export async function setScheduledNotificationId(
  db: SQLiteDatabase,
  type: NotificationType,
  notificationId: string | null,
): Promise<void> {
  await db.runAsync(
    `UPDATE notification_preferences
     SET scheduled_notification_id = ?, updated_at = ?
     WHERE type = ?`,
    [notificationId, new Date().toISOString(), type],
  );
}

export async function saveNotificationPreference(
  db: SQLiteDatabase,
  type: NotificationType,
  enabled: boolean,
): Promise<NotificationPreference> {
  const existing = await db.getFirstAsync<{ id: string; created_at: string; conditions: string }>(
    'SELECT id, created_at, conditions FROM notification_preferences WHERE type = ?',
    [type],
  );
  const id = existing?.id ?? Crypto.randomUUID();
  const now = new Date().toISOString();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const defaultConditions = type === 'meal_gap'
    ? { expectedMeals: 2, checkHour: 20 }
    : type === 'workout_plan'
      ? { leadMinutes: 60 }
      : {};
  let conditions = defaultConditions;
  if (existing?.conditions) {
    try {
      const parsed = JSON.parse(existing.conditions) as Record<string, unknown>;
      conditions = { ...defaultConditions, ...parsed };
    } catch {
      conditions = defaultConditions;
    }
  }
  const payload = {
    id,
    type,
    enabled,
    quiet_hours_start: '22:00',
    quiet_hours_end: '08:00',
    timezone,
    minimum_interval_minutes: 720,
    last_notified_at: null,
    conditions,
    created_at: existing?.created_at ?? now,
    client_updated_at: now,
    deleted_at: null,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO notification_preferences (
        id, type, enabled, quiet_hours_start, quiet_hours_end, timezone,
        minimum_interval_minutes, conditions, created_at, updated_at, client_updated_at
      ) VALUES (?, ?, ?, '22:00', '08:00', ?, 720, ?, ?, ?, ?)
      ON CONFLICT(type) DO UPDATE SET
        enabled = excluded.enabled,
        timezone = excluded.timezone,
        conditions = excluded.conditions,
        updated_at = excluded.updated_at,
        client_updated_at = excluded.client_updated_at`,
      [id, type, enabled ? 1 : 0, timezone, JSON.stringify(conditions), now, now, now],
    );
    await enqueueUpsert(db, 'notification_preferences', id, payload);
  });

  return {
    id,
    type,
    enabled,
    quietHoursStart: '22:00',
    quietHoursEnd: '08:00',
    timezone,
    minimumIntervalMinutes: 720,
    lastNotifiedAt: null,
    conditions,
  };
}
