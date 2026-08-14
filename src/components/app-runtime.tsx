import * as Network from 'expo-network';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { getSupabaseClient, syncAccountData } from '@/lib/db';
import { reconcileMealGapNotification } from '@/lib/notifications';

export function AppRuntime() {
  const db = useSQLiteContext();
  const syncing = useRef(false);

  const reconcile = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      await Promise.allSettled([
        syncAccountData(db),
        reconcileMealGapNotification(db),
      ]);
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
    try {
      const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
        if (session) setTimeout(() => void reconcile(), 0);
      });
      return () => data.subscription.unsubscribe();
    } catch {
      return undefined;
    }
  }, [reconcile]);

  return null;
}
