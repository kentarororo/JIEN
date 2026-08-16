import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import {
  getSupabaseClient,
  markNotificationDelivered,
  processPendingMealPhotoJobs,
  syncAccountData,
} from '@/lib/db';
import { subscribeToQueuedLocalWrites } from '@/lib/db/write-sync-signal';
import {
  getDeliveredNotificationType,
  getNotificationHref,
  reconcileContextualNotifications,
} from '@/lib/notifications';

export function AppRuntime() {
  const db = useSQLiteContext();
  const router = useRouter();
  const syncing = useRef(false);
  const rerunRequested = useRef(false);
  const handledNotificationIds = useRef(new Set<string>());
  const recordedNotificationIds = useRef(new Set<string>());

  const reconcile = useCallback(async (trigger: 'background' | 'auth_state_change' = 'background') => {
    if (syncing.current) {
      rerunRequested.current = true;
      return;
    }
    syncing.current = true;
    try {
      do {
        rerunRequested.current = false;
        await syncAccountData(db, { trigger }).catch(() => undefined);
        await Promise.allSettled([
          processPendingMealPhotoJobs(db),
          reconcileContextualNotifications(db),
        ]);
      } while (rerunRequested.current);
    } finally {
      syncing.current = false;
    }
  }, [db]);

  useEffect(() => {
    void reconcile();
    const networkSubscription = Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) void reconcile();
    });
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reconcile();
    });
    return () => {
      networkSubscription.remove();
      appStateSubscription.remove();
    };
  }, [reconcile]);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const recordDelivery = (notification: Notifications.Notification) => {
      const identifier = notification.request.identifier;
      if (recordedNotificationIds.current.has(identifier)) return;
      const type = getDeliveredNotificationType(notification.request.content.data);
      if (!type) return;
      recordedNotificationIds.current.add(identifier);
      void markNotificationDelivered(db, type, new Date(notification.date).toISOString())
        .catch(() => recordedNotificationIds.current.delete(identifier));
    };
    const openResponse = (response: Notifications.NotificationResponse) => {
      recordDelivery(response.notification);
      const identifier = response.notification.request.identifier;
      if (handledNotificationIds.current.has(identifier)) return;
      const href = getNotificationHref(response.notification.request.content.data);
      if (!href) return;
      handledNotificationIds.current.add(identifier);
      router.push(href);
    };
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) openResponse(response);
    });
    const recordPresentedNotifications = () => {
      void Notifications.getPresentedNotificationsAsync()
        .then((notifications) => notifications.forEach(recordDelivery))
        .catch(() => undefined);
    };
    recordPresentedNotifications();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') recordPresentedNotifications();
    });
    const receivedSubscription = Notifications.addNotificationReceivedListener(recordDelivery);
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(openResponse);
    return () => {
      appStateSubscription.remove();
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }, [db, router]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeToQueuedLocalWrites(() => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => void reconcile(), 100);
    });
    return () => {
      if (timeout) clearTimeout(timeout);
      unsubscribe();
    };
  }, [reconcile]);

  useEffect(() => {
    try {
      const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
        if (session) setTimeout(() => void reconcile('auth_state_change'), 0);
      });
      return () => data.subscription.unsubscribe();
    } catch {
      return undefined;
    }
  }, [reconcile]);

  return null;
}
