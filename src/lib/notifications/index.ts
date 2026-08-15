import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  getDailyNutrition,
  getMealLoggingPattern,
  getNotificationPreference,
  getScheduledNotificationId,
  getSyncStatus,
  setScheduledNotificationId,
} from '@/lib/db';

import { getMealGapTrigger } from './meal-gap-policy';
import { getSyncAttentionTrigger } from './sync-attention-policy';

const CHANNEL_ID = 'contextual-reminders';

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
  await setScheduledNotificationId(db, 'meal_gap', null);
}

export async function reconcileMealGapNotification(
  db: SQLiteDatabase,
  requestPermission = false,
): Promise<'scheduled' | 'disabled' | 'complete' | 'unsupported' | 'permission_denied'> {
  const preference = await getNotificationPreference(db, 'meal_gap');
  await cancelMealGapNotification(db);
  if (!preference?.enabled) return 'disabled';
  if (Platform.OS === 'web') return 'unsupported';

  const daily = await getDailyNutrition(db);
  const pattern = await getMealLoggingPattern(db);
  const expectedMeals = pattern.expectedMeals ?? 2;
  if (daily.meals.length >= expectedMeals) return 'complete';

  const now = new Date();
  const triggerAt = getMealGapTrigger({
    enabled: preference.enabled,
    patternEstablished: pattern.established,
    mealCount: daily.meals.length,
    expectedMeals,
    checkHour: Number(preference.conditions.checkHour ?? 20),
    now,
  });
  if (!triggerAt) return 'complete';

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Contextual reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 180],
    });
  }
  const permissions = await Notifications.getPermissionsAsync();
  const allowed = permissions.granted || (requestPermission && (await ensurePermission()));
  if (!allowed) return 'permission_denied';

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
  await setScheduledNotificationId(db, 'meal_gap', notificationId);
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
  await setScheduledNotificationId(db, 'sync_issue', null);
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
  if (Platform.OS === 'web') return 'unsupported';
  const triggerAt = getSyncAttentionTrigger({
    enabled: preference.enabled,
    actionRequiredCount: sync.actionRequiredCount,
    quietHoursStart: preference.quietHoursStart,
    quietHoursEnd: preference.quietHoursEnd,
    now: new Date(),
  });
  if (!triggerAt) return 'complete';

  const permissions = await Notifications.getPermissionsAsync();
  const allowed = permissions.granted || (requestPermission && (await ensurePermission()));
  if (!allowed) {
    await cancelSyncAttentionNotification(db);
    return 'permission_denied';
  }
  const existingId = await getScheduledNotificationId(db, 'sync_issue');
  if (existingId) return 'scheduled';
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
  await setScheduledNotificationId(db, 'sync_issue', notificationId);
  return 'scheduled';
}

export async function reconcileContextualNotifications(db: SQLiteDatabase): Promise<void> {
  await Promise.allSettled([
    reconcileMealGapNotification(db),
    reconcileSyncAttentionNotification(db),
  ]);
}

export { getNotificationHref } from './navigation';
