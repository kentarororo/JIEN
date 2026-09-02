import type { SQLiteDatabase } from 'expo-sqlite';

import {
  getNotificationPreference,
  setScheduledNotificationId,
  setSetting,
} from '@/lib/db';

const MEAL_GAP_SCHEDULE_KEY = 'scheduled_meal_gap_key';
const WORKOUT_PLAN_SCHEDULE_KEY = 'scheduled_workout_plan_key';
const SYNC_ATTENTION_SCHEDULE_KEY = 'scheduled_sync_attention_key';

type ReconcileOutcome = 'disabled' | 'unsupported';

export function configureNotificationHandling(): void {
  // Web notifications are intentionally unsupported. Avoid loading the native
  // Expo module because WebKit rejects one of its permission capability probes.
}

async function clearWebSchedule(
  db: SQLiteDatabase,
  type: 'meal_gap' | 'workout_plan' | 'sync_issue',
  scheduleKey: string,
): Promise<void> {
  await setScheduledNotificationId(db, type, null);
  await setSetting(db, scheduleKey, '');
}

export async function cancelMealGapNotification(db: SQLiteDatabase): Promise<void> {
  await clearWebSchedule(db, 'meal_gap', MEAL_GAP_SCHEDULE_KEY);
}

export async function cancelWorkoutPlanNotification(db: SQLiteDatabase): Promise<void> {
  await clearWebSchedule(db, 'workout_plan', WORKOUT_PLAN_SCHEDULE_KEY);
}

export async function cancelSyncAttentionNotification(db: SQLiteDatabase): Promise<void> {
  await clearWebSchedule(db, 'sync_issue', SYNC_ATTENTION_SCHEDULE_KEY);
}

async function reconcileWebPreference(
  db: SQLiteDatabase,
  type: 'meal_gap' | 'workout_plan' | 'sync_issue',
  scheduleKey: string,
): Promise<ReconcileOutcome> {
  const preference = await getNotificationPreference(db, type);
  await clearWebSchedule(db, type, scheduleKey);
  return preference?.enabled ? 'unsupported' : 'disabled';
}

export async function reconcileMealGapNotification(
  db: SQLiteDatabase,
  _requestPermission = false,
): Promise<ReconcileOutcome> {
  return reconcileWebPreference(db, 'meal_gap', MEAL_GAP_SCHEDULE_KEY);
}

export async function reconcileWorkoutPlanNotification(
  db: SQLiteDatabase,
  _requestPermission = false,
): Promise<ReconcileOutcome> {
  return reconcileWebPreference(db, 'workout_plan', WORKOUT_PLAN_SCHEDULE_KEY);
}

export async function reconcileSyncAttentionNotification(
  db: SQLiteDatabase,
  _requestPermission = false,
): Promise<ReconcileOutcome> {
  return reconcileWebPreference(db, 'sync_issue', SYNC_ATTENTION_SCHEDULE_KEY);
}

export async function reconcileContextualNotifications(db: SQLiteDatabase): Promise<void> {
  await Promise.allSettled([
    reconcileMealGapNotification(db),
    reconcileWorkoutPlanNotification(db),
    reconcileSyncAttentionNotification(db),
  ]);
}

export async function cancelAllContextualNotifications(_db: SQLiteDatabase): Promise<void> {
  // The account-deletion transaction clears preferences and schedule keys.
  // Browsers do not have JIEN operating-system schedules to cancel.
}

export { getDeliveredNotificationType, getNotificationHref } from './navigation';
