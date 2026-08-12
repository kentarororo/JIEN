import type { PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import {
  evaluateWebSQLiteReadiness,
  type WebSQLiteReadiness,
} from '@/lib/web-sqlite-readiness';
import { radii, resolveTheme, spacing, typography } from '@/theme/tokens';

const RELOAD_KEY = 'jien:sqlite-isolation-reload';

function readEnvironment(): WebSQLiteReadiness {
  const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<unknown> };
  return evaluateWebSQLiteReadiness({
    isSecureContext: window.isSecureContext,
    isCrossOriginIsolated: window.crossOriginIsolated === true,
    hasSharedArrayBuffer: typeof globalThis.SharedArrayBuffer !== 'undefined',
    hasServiceWorker: 'serviceWorker' in navigator,
    hasStorageDirectory: typeof storage?.getDirectory === 'function',
    hasWorker: typeof globalThis.Worker !== 'undefined',
  });
}

export function WebSQLiteGate({ children }: PropsWithChildren) {
  if (Platform.OS !== 'web') return children;
  return <WebSQLiteGateContent>{children}</WebSQLiteGateContent>;
}

function WebSQLiteGateContent({ children }: PropsWithChildren) {
  const colorScheme = useColorScheme();
  const { colors } = resolveTheme(colorScheme);
  const [readiness, setReadiness] = useState<WebSQLiteReadiness>({
    state: 'preparing',
    code: 'WAITING_FOR_ISOLATION',
  });

  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const refresh = () => {
      if (!active) return;
      const next = readEnvironment();
      if (next.state === 'ready') {
        try {
          window.sessionStorage.removeItem(RELOAD_KEY);
        } catch {
          // Isolation is authoritative even when session storage is restricted.
        }
        setReadiness(next);
        return;
      }
      if (next.state === 'unsupported') {
        setReadiness(next);
        return;
      }
      if (Date.now() - startedAt >= 8_000) {
        setReadiness({
          state: 'unsupported',
          code: 'ISOLATION_TIMEOUT',
          message: 'Secure local storage did not finish preparing. Close this tab, reopen JIEN, and try once more.',
        });
        return;
      }
      setReadiness(next);
      timeout = setTimeout(refresh, 250);
    };
    const reloadWhenControlled = () => {
      if (window.crossOriginIsolated) return refresh();
      try {
        if (window.sessionStorage.getItem(RELOAD_KEY) === '1') return;
        window.sessionStorage.setItem(RELOAD_KEY, '1');
      } catch {
        return;
      }
      window.location.reload();
    };

    navigator.serviceWorker?.addEventListener('controllerchange', reloadWhenControlled);
    void navigator.serviceWorker?.ready.then(() => {
      if (navigator.serviceWorker.controller) reloadWhenControlled();
    });
    refresh();

    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
      navigator.serviceWorker?.removeEventListener('controllerchange', reloadWhenControlled);
    };
  }, []);

  if (readiness.state === 'ready') return children;

  const retry = () => {
    try {
      window.sessionStorage.removeItem(RELOAD_KEY);
    } catch {
      // Reload still gives browsers with restricted session storage one safe retry.
    }
    window.location.reload();
  };
  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.eyebrow, { color: colors.accent }]}>LOCAL-FIRST STARTUP</Text>
        <Text style={[styles.title, { color: colors.text }]}>{readiness.state === 'preparing' ? 'Preparing JIEN…' : 'This browser needs attention'}</Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          {readiness.state === 'preparing'
            ? 'Setting up private on-device storage. This normally takes one automatic refresh.'
            : readiness.message}
        </Text>
        {readiness.state === 'unsupported' ? (
          <>
            <Text selectable style={[styles.code, { color: colors.warning }]}>Startup code: {readiness.code}</Text>
            <Pressable accessibilityRole="button" onPress={retry} style={({ pressed }) => [styles.button, { backgroundColor: colors.accent }, pressed && styles.pressed]}>
              <Text style={[styles.buttonLabel, { color: colors.textOnAccent }]}>Try again</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, justifyContent: 'center' },
  card: { width: '100%', maxWidth: 560, alignSelf: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.xl, gap: spacing.sm },
  eyebrow: { ...typography.caption, fontWeight: '700', letterSpacing: 0.6 },
  title: { ...typography.title, fontWeight: '700' },
  body: { ...typography.body },
  code: { ...typography.caption },
  button: { minHeight: 48, borderRadius: radii.control, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { ...typography.body, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
