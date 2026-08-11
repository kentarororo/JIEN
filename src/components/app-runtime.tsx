import * as Network from 'expo-network';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { syncPendingChanges } from '@/lib/db';
import { reconcileMealGapNotification } from '@/lib/notifications';

export function AppRuntime() {
  const db = useSQLiteContext();
  const syncing = useRef(false);

  const reconcile = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      await Promise.allSettled([
        syncPendingChanges(db),
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

  return null;
}
