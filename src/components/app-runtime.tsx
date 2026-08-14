import * as Network from 'expo-network';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { getSupabaseClient, syncAccountData } from '@/lib/db';
import { subscribeToQueuedLocalWrites } from '@/lib/db/write-sync-signal';
import { reconcileMealGapNotification } from '@/lib/notifications';

export function AppRuntime() {
  const db = useSQLiteContext();
  const syncing = useRef(false);
  const rerunRequested = useRef(false);

  const reconcile = useCallback(async (trigger: 'background' | 'auth_state_change' = 'background') => {
    if (syncing.current) {
      rerunRequested.current = true;
      return;
    }
    syncing.current = true;
    try {
      do {
        rerunRequested.current = false;
        await Promise.allSettled([
          syncAccountData(db, { trigger }),
          reconcileMealGapNotification(db),
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
    if (Platform.OS !== 'web') return undefined;
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
