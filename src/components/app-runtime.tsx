import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { getSupabaseClient, processPendingMealPhotoJobs, syncAccountData } from '@/lib/db';
import { subscribeToQueuedLocalWrites } from '@/lib/db/write-sync-signal';
import { getNotificationHref, reconcileContextualNotifications } from '@/lib/notifications';

export function AppRuntime() {
  const db = useSQLiteContext();
  const router = useRouter();
  const syncing = useRef(false);
  const rerunRequested = useRef(false);
  const handledNotificationIds = useRef(new Set<string>());

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
    const openResponse = (response: Notifications.NotificationResponse) => {
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
    const subscription = Notifications.addNotificationResponseReceivedListener(openResponse);
    return () => subscription.remove();
  }, [router]);

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
