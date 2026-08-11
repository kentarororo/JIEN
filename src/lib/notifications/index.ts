import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  getDailyNutrition,
  getNotificationPreference,
  getScheduledNotificationId,
  setScheduledNotificationId,
} from '@/lib/db';

import { getMealGapTrigger } from './meal-gap-policy';

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
  const expectedMeals = Number(preference.conditions.expectedMeals ?? 2);
  if (daily.meals.length >= expectedMeals) return 'complete';

  const now = new Date();
  const triggerAt = getMealGapTrigger({
    enabled: preference.enabled,
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
      body: 'You usually log at least two meals. Add one if today’s log is incomplete.',
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
