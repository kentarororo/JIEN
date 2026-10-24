import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useWebSQLiteBeforeReload } from '@/components/web-sqlite-gate';
import { registerOfflineAppShell } from '@/lib/pwa';
import { radii, spacing, typography, useJienTheme } from '@/theme';

export function WebUpdateBanner() {
  const { colors } = useJienTheme();
  const closeBeforeReload = useWebSQLiteBeforeReload();
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const reloadRequested = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'web'
      || process.env.NODE_ENV !== 'production'
      || !('serviceWorker' in navigator)) return;

    let active = true;
    const showWaitingWorker = (next: ServiceWorkerRegistration) => {
      if (active && next.waiting && navigator.serviceWorker.controller) setRegistration(next);
    };
    const onControllerChange = () => {
      if (reloadRequested.current) globalThis.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    void registerOfflineAppShell()
      .then((next) => {
        if (!active || !next) return;
        showWaitingWorker(next);
        next.addEventListener('updatefound', () => {
          const installing = next.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed') showWaitingWorker(next);
          });
        });
        void next.update().catch(() => undefined);
      });

    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  if (Platform.OS !== 'web' || !registration) return null;

  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    closeBeforeReload();
    reloadRequested.current = true;
    const waiting = registration.waiting;
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
    else globalThis.location.reload();
  };

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
      ]}
    >
      <View style={styles.copy}>
        <AppText style={styles.title}>Update ready</AppText>
        <AppText style={{ color: colors.textMuted }}>Refresh to use the latest app version.</AppText>
      </View>
      <Button label="Refresh" onPress={refresh} busy={refreshing} />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    zIndex: 20,
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    maxWidth: 520,
    alignSelf: 'center',
    minHeight: 64,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.card,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  copy: { flex: 1, minWidth: 180 },
  title: { ...typography.bodyLarge, fontWeight: '700' },
});
