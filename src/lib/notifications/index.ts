import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  getDailyNutrition,
  getMealLoggingPattern,
  getNextPlannedWorkout,
  getNotificationPreference,
  getScheduledNotificationId,
  getSetting,
  getSyncStatus,
  setScheduledNotificationId,
  setSetting,
} from '@/lib/db';

import { getMealGapTrigger } from './meal-gap-policy';
import { getSyncAttentionTrigger } from './sync-attention-policy';
import { getWorkoutPlanTrigger } from './workout-plan-policy';

const CHANNEL_ID = 'contextual-reminders';
const MEAL_GAP_SCHEDULE_KEY = 'scheduled_meal_gap_key';
const WORKOUT_PLAN_SCHEDULE_KEY = 'scheduled_workout_plan_key';
const SYNC_ATTENTION_SCHEDULE_KEY = 'scheduled_sync_attention_key';

export function configureNotificationHandling(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Contextual reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 180],
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function cancelMealGapNotification(db: SQLiteDatabase): Promise<void> {
  const scheduledId = await getScheduledNotificationId(db, 'meal_gap');
  if (scheduledId && Platform.OS !== 'web') {
    try {
      await Notifications.cancelScheduledNotificationAsync(scheduledId);
    } catch {
      // The operating system may already have delivered or cleared this identifier.
    }
  }
  await Promise.all([
    setScheduledNotificationId(db, 'meal_gap', null),
    setSetting(db, MEAL_GAP_SCHEDULE_KEY, ''),
  ]);
}

export async function reconcileMealGapNotification(
  db: SQLiteDatabase,
  requestPermission = false,
): Promise<'scheduled' | 'disabled' | 'complete' | 'unsupported' | 'permission_denied'> {
  const preference = await getNotificationPreference(db, 'meal_gap');
  if (!preference?.enabled) {
    await cancelMealGapNotification(db);
    return 'disabled';
  }

  const daily = await getDailyNutrition(db);
  const pattern = await getMealLoggingPattern(db);
  const expectedMeals = pattern.expectedMeals ?? 2;
  if (daily.meals.length >= expectedMeals) {
    await cancelMealGapNotification(db);
    return 'complete';
  }
  if (Platform.OS === 'web') {
    await cancelMealGapNotification(db);
    return 'unsupported';
  }

  const now = new Date();
  const triggerAt = getMealGapTrigger({
    enabled: preference.enabled,
    patternEstablished: pattern.established,
    mealCount: daily.meals.length,
    expectedMeals,
    checkHour: Number(preference.conditions.checkHour ?? 20),
    quietHoursStart: preference.quietHoursStart,
    quietHoursEnd: preference.quietHoursEnd,
    lastNotifiedAt: preference.lastNotifiedAt,
    minimumIntervalMinutes: preference.minimumIntervalMinutes,
    now,
  });
  if (!triggerAt) {
    await cancelMealGapNotification(db);
    return 'complete';
  }

  const scheduleKey = [
    daily.date,
    expectedMeals,
    Number(preference.conditions.checkHour ?? 20),
    preference.quietHoursStart ?? '',
    preference.quietHoursEnd ?? '',
    preference.minimumIntervalMinutes,
  ].join('|');
  const [existingId, existingKey] = await Promise.all([
    getScheduledNotificationId(db, 'meal_gap'),
    getSetting(db, MEAL_GAP_SCHEDULE_KEY),
  ]);
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Contextual reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 180],
    });
  }
  const permissions = await Notifications.getPermissionsAsync();
  const allowed = permissions.granted || (requestPermission && (await ensurePermission()));
  if (!allowed) {
    await cancelMealGapNotification(db);
    return 'permission_denied';
  }
  if (existingId && existingKey === scheduleKey) return 'scheduled';
  if (existingId) await cancelMealGapNotification(db);

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'A meal may be missing',
      body: `You usually log about ${expectedMeals} meals. Add one if today's log is incomplete.`,
      data: { href: '/meals/new', type: 'meal_gap' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerAt,
      channelId: CHANNEL_ID,
    },
  });
  await Promise.all([
    setScheduledNotificationId(db, 'meal_gap', notificationId),
    setSetting(db, MEAL_GAP_SCHEDULE_KEY, scheduleKey),
  ]);
  return 'scheduled';
}

export async function cancelSyncAttentionNotification(db: SQLiteDatabase): Promise<void> {
  const scheduledId = await getScheduledNotificationId(db, 'sync_issue');
  if (scheduledId && Platform.OS !== 'web') {
    try {
      await Notifications.cancelScheduledNotificationAsync(scheduledId);
    } catch {
      // The operating system may already have delivered or cleared this identifier.
    }
  }
  await Promise.all([
    setScheduledNotificationId(db, 'sync_issue', null),
    setSetting(db, SYNC_ATTENTION_SCHEDULE_KEY, ''),
  ]);
}

export async function cancelWorkoutPlanNotification(db: SQLiteDatabase): Promise<void> {
  const scheduledId = await getScheduledNotificationId(db, 'workout_plan');
  if (scheduledId && Platform.OS !== 'web') {
    try {
      await Notifications.cancelScheduledNotificationAsync(scheduledId);
    } catch {
      // The operating system may already have delivered or cleared this identifier.
    }
  }
  await Promise.all([
    setScheduledNotificationId(db, 'workout_plan', null),
    setSetting(db, WORKOUT_PLAN_SCHEDULE_KEY, ''),
  ]);
}

export async function reconcileWorkoutPlanNotification(
  db: SQLiteDatabase,
  requestPermission = false,
): Promise<'scheduled' | 'disabled' | 'complete' | 'unsupported' | 'permission_denied'> {
  const preference = await getNotificationPreference(db, 'workout_plan');
  if (!preference?.enabled) {
    await cancelWorkoutPlanNotification(db);
    return 'disabled';
  }
  const planned = await getNextPlannedWorkout(db);
  if (!planned?.scheduledAt) {
    await cancelWorkoutPlanNotification(db);
    return 'complete';
  }
  if (Platform.OS === 'web') {
    await cancelWorkoutPlanNotification(db);
    return 'unsupported';
  }
  const triggerAt = getWorkoutPlanTrigger({
    enabled: preference.enabled,
    scheduledAt: planned.scheduledAt,
    leadMinutes: Number(preference.conditions.leadMinutes ?? 60),
    quietHoursStart: preference.quietHoursStart,
    quietHoursEnd: preference.quietHoursEnd,
    lastNotifiedAt: preference.lastNotifiedAt,
    minimumIntervalMinutes: preference.minimumIntervalMinutes,
    now: new Date(),
  });
  if (!triggerAt) {
    await cancelWorkoutPlanNotification(db);
    return 'complete';
  }

  const permissions = await Notifications.getPermissionsAsync();
  const allowed = permissions.granted || (requestPermission && (await ensurePermission()));
  if (!allowed) {
    await cancelWorkoutPlanNotification(db);
    return 'permission_denied';
  }
  const scheduleKey = [
    planned.id,
    planned.scheduledAt,
    Number(preference.conditions.leadMinutes ?? 60),
    preference.quietHoursStart ?? '',
    preference.quietHoursEnd ?? '',
    preference.minimumIntervalMinutes,
  ].join('|');
  const [existingId, existingKey] = await Promise.all([
    getScheduledNotificationId(db, 'workout_plan'),
    getSetting(db, WORKOUT_PLAN_SCHEDULE_KEY),
  ]);
  if (existingId && existingKey === scheduleKey) return 'scheduled';
  if (existingId) await cancelWorkoutPlanNotification(db);
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Contextual reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 180],
    });
  }
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: `${planned.title} is planned soon`,
      body: 'Review the planned sets before starting the workout.',
      data: { href: `/workouts/${planned.id}`, type: 'workout_plan' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerAt,
      channelId: CHANNEL_ID,
    },
  });
  await Promise.all([
    setScheduledNotificationId(db, 'workout_plan', notificationId),
    setSetting(db, WORKOUT_PLAN_SCHEDULE_KEY, scheduleKey),
  ]);
  return 'scheduled';
}

export async function reconcileSyncAttentionNotification(
  db: SQLiteDatabase,
  requestPermission = false,
): Promise<'scheduled' | 'disabled' | 'complete' | 'unsupported' | 'permission_denied'> {
  const preference = await getNotificationPreference(db, 'sync_issue');
  const sync = await getSyncStatus(db);
  if (!preference?.enabled) {
    await cancelSyncAttentionNotification(db);
    return 'disabled';
  }
  if (sync.actionRequiredCount < 1) {
    await cancelSyncAttentionNotification(db);
    return 'complete';
  }
  if (Platform.OS === 'web') {
    await cancelSyncAttentionNotification(db);
    return 'unsupported';
  }
  const triggerAt = getSyncAttentionTrigger({
    enabled: preference.enabled,
    actionRequiredCount: sync.actionRequiredCount,
    quietHoursStart: preference.quietHoursStart,
    quietHoursEnd: preference.quietHoursEnd,
    lastNotifiedAt: preference.lastNotifiedAt,
    minimumIntervalMinutes: preference.minimumIntervalMinutes,
    now: new Date(),
  });
  if (!triggerAt) {
    await cancelSyncAttentionNotification(db);
    return 'complete';
  }

  const permissions = await Notifications.getPermissionsAsync();
  const allowed = permissions.granted || (requestPermission && (await ensurePermission()));
  if (!allowed) {
    await cancelSyncAttentionNotification(db);
    return 'permission_denied';
  }
  const scheduleKey = [
    sync.actionRequiredCount,
    preference.quietHoursStart ?? '',
    preference.quietHoursEnd ?? '',
    preference.minimumIntervalMinutes,
  ].join('|');
  const [existingId, existingKey] = await Promise.all([
    getScheduledNotificationId(db, 'sync_issue'),
    getSetting(db, SYNC_ATTENTION_SCHEDULE_KEY),
  ]);
  if (existingId && existingKey === scheduleKey) return 'scheduled';
  if (existingId) await cancelSyncAttentionNotification(db);
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Sync needs your attention',
      body: `${sync.actionRequiredCount} saved change${sync.actionRequiredCount === 1 ? '' : 's'} need sign-in or a settings update. Open Sync to review.`,
      data: { href: '/settings', type: 'sync_issue' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerAt,
      channelId: CHANNEL_ID,
    },
  });
  await Promise.all([
    setScheduledNotificationId(db, 'sync_issue', notificationId),
    setSetting(db, SYNC_ATTENTION_SCHEDULE_KEY, scheduleKey),
  ]);
  return 'scheduled';
}

export async function reconcileContextualNotifications(db: SQLiteDatabase): Promise<void> {
  await Promise.allSettled([
    reconcileMealGapNotification(db),
    reconcileWorkoutPlanNotification(db),
    reconcileSyncAttentionNotification(db),
  ]);
}

export { getDeliveredNotificationType, getNotificationHref } from './navigation';
