import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import type { PropsWithChildren } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { migrateDatabase } from '@/lib/db/migrate';
import {
  describeWebSQLiteStartupFailure,
  type WebSQLiteStartupFailure,
  withWebSQLiteStartupTimeout,
} from '@/lib/web-sqlite-bootstrap';
import {
  evaluateWebSQLiteReadiness,
  type WebSQLiteReadiness,
} from '@/lib/web-sqlite-readiness';
import { radii, resolveTheme, spacing, typography } from '@/theme/tokens';

const ISOLATION_RELOAD_KEY = 'jien:sqlite-isolation-reload';
const BOOT_RELOAD_KEY = 'jien:sqlite-bootstrap-reload';
const STARTUP_TIMEOUT_MS = 12_000;

type DatabaseReadiness =
  | { state: 'preparing' }
  | { state: 'ready' }
  | ({ state: 'unsupported' } & WebSQLiteStartupFailure);

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
  const [databaseReadiness, setDatabaseReadiness] = useState<DatabaseReadiness>({
    state: 'preparing',
  });
  const preflightDatabase = useRef<SQLiteDatabase | null>(null);
  const preflightPromise = useRef<Promise<SQLiteDatabase> | null>(null);

  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const refresh = () => {
      if (!active) return;
      const next = readEnvironment();
      if (next.state === 'ready') {
        try {
          window.sessionStorage.removeItem(ISOLATION_RELOAD_KEY);
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
        if (window.sessionStorage.getItem(ISOLATION_RELOAD_KEY) === '1') return;
        window.sessionStorage.setItem(ISOLATION_RELOAD_KEY, '1');
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

  useEffect(() => {
    if (readiness.state !== 'ready') return;

    let active = true;
    const prepareDatabase = async () => {
      try {
        preflightPromise.current ??= (async () => {
          const database = await withWebSQLiteStartupTimeout(
            openDatabaseAsync('jien.db'),
            STARTUP_TIMEOUT_MS,
          );
          await withWebSQLiteStartupTimeout(
            migrateDatabase(database),
            STARTUP_TIMEOUT_MS,
          );
          return database;
        })();
        const database = await preflightPromise.current;
        if (!active) return;
        preflightDatabase.current = database;
        try {
          window.sessionStorage.removeItem(BOOT_RELOAD_KEY);
        } catch {
          // Successful database access is authoritative when storage is restricted.
        }
        setDatabaseReadiness({ state: 'ready' });
      } catch (cause) {
        if (!active) return;
        const failure = describeWebSQLiteStartupFailure(cause);
        let shouldReload = false;
        try {
          const hasReloaded = window.sessionStorage.getItem(BOOT_RELOAD_KEY) === '1';
          shouldReload = !hasReloaded && failure.retryWithReload;
          if (shouldReload) window.sessionStorage.setItem(BOOT_RELOAD_KEY, '1');
        } catch {
          // Without a marker, show recovery controls instead of risking a loop.
        }
        if (shouldReload) {
          setTimeout(() => window.location.reload(), 600);
          return;
        }
        setDatabaseReadiness({ state: 'unsupported', ...failure });
      }
    };

    void prepareDatabase();
    return () => {
      active = false;
    };
  }, [readiness.state]);

  if (readiness.state === 'ready' && databaseReadiness.state === 'ready') return children;

  const retry = () => {
    try {
      window.sessionStorage.removeItem(ISOLATION_RELOAD_KEY);
      window.sessionStorage.removeItem(BOOT_RELOAD_KEY);
    } catch {
      // Reload still gives browsers with restricted session storage one safe retry.
    }
    window.location.reload();
  };
  const environmentFailure = readiness.state === 'unsupported' ? readiness : null;
  const databaseFailure = databaseReadiness.state === 'unsupported' ? databaseReadiness : null;
  const failure = databaseFailure ?? environmentFailure;
  const isPreparing = failure == null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.eyebrow, { color: colors.accent }]}>LOCAL-FIRST STARTUP</Text>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          {isPreparing ? 'Preparing JIEN...' : 'Local storage needs attention'}
        </Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          {isPreparing
            ? 'Opening your private on-device database. JIEN may retry once automatically.'
            : failure?.message}
        </Text>
        {failure ? (
          <>
            <Text selectable style={[styles.code, { color: colors.warning }]}>Startup code: {failure.code}</Text>
            {'detail' in failure ? (
              <Text selectable style={[styles.detail, { color: colors.textMuted }]}>{failure.detail}</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={retry}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: colors.accent },
                pressed && styles.pressed,
              ]}
            >
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
  card: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.card,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  eyebrow: { ...typography.caption, fontWeight: '700', letterSpacing: 0.6 },
  title: { ...typography.title, fontWeight: '700' },
  body: { ...typography.body },
  code: { ...typography.caption },
  detail: { ...typography.caption },
  button: {
    minHeight: 48,
    borderRadius: radii.control,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { ...typography.body, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
