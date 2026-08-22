import { useSQLiteContext } from '@/lib/db/database-context';
import { Component, createContext, type ErrorInfo, type PropsWithChildren, useCallback, useContext, useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import {
  describeWebSQLiteStartupFailure,
} from '@/lib/web-sqlite-bootstrap';
import { createWebSQLitePageLifecycle, type WebSQLitePageLifecycle } from '@/lib/web-sqlite-lifecycle';
import { radii, resolveTheme, spacing, typography } from '@/theme/tokens';

const BOOT_RELOAD_KEY = 'jien:sqlite-bootstrap-reload:v2';

type WebSQLiteOwnershipContextValue = {
  registerDatabaseCloser: (closeDatabaseSync: () => void) => () => void;
};

const WebSQLiteOwnershipContext = createContext<WebSQLiteOwnershipContextValue | null>(null);

async function retireLegacyIsolationServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.getRegistrations) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations
    .filter((registration) => {
      const scriptUrl = registration.active?.scriptURL
        ?? registration.waiting?.scriptURL
        ?? registration.installing?.scriptURL
        ?? '';
      return new URL(scriptUrl, window.location.href).pathname.endsWith('/coi-serviceworker.js');
    })
    .map((registration) => registration.unregister()));
}

export function WebSQLiteGate({ children }: PropsWithChildren) {
  if (Platform.OS !== 'web') return children;
  return <WebSQLiteGateContent>{children}</WebSQLiteGateContent>;
}

function WebSQLiteGateContent({ children }: PropsWithChildren) {
  const hostSupportsSQLite = globalThis.crossOriginIsolated === true
    && typeof globalThis.SharedArrayBuffer !== 'undefined';
  const lifecycle = useRef<WebSQLitePageLifecycle | null>(null);
  if (!lifecycle.current) {
    lifecycle.current = createWebSQLitePageLifecycle({
      terminateWorkers: () => undefined,
      releaseLease: () => undefined,
      reload: () => window.location.reload(),
    });
  }

  const registerDatabaseCloser = useCallback((closeDatabaseSync: () => void) => {
    return lifecycle.current!.registerDatabaseCloser(closeDatabaseSync);
  }, []);

  useEffect(() => {
    void retireLegacyIsolationServiceWorker().catch((error) => {
      console.warn('Could not retire the legacy JIEN isolation service worker', error);
    });
  }, []);

  useEffect(() => {
    const closeDatabaseForTransition = () => {
      try { lifecycle.current?.closeForPageTransition(); }
      catch (error) { console.error('Failed to close web SQLite database', error); }
    };
    const restoreDatabaseAfterTransition = (event: PageTransitionEvent) => {
      if (event.persisted) lifecycle.current?.restoreAfterPageTransition();
    };
    window.addEventListener('pagehide', closeDatabaseForTransition);
    window.addEventListener('pageshow', restoreDatabaseAfterTransition);

    return () => {
      window.removeEventListener('pagehide', closeDatabaseForTransition);
      window.removeEventListener('pageshow', restoreDatabaseAfterTransition);
      closeDatabaseForTransition();
    };
  }, []);

  if (!hostSupportsSQLite) return <WebSQLiteHostRequirementsPanel />;

  return (
    <WebSQLiteOwnershipContext.Provider value={{ registerDatabaseCloser }}>
      {children}
    </WebSQLiteOwnershipContext.Provider>
  );
}

function WebSQLiteHostRequirementsPanel() {
  const colorScheme = useColorScheme();
  const { colors } = resolveTheme(colorScheme);
  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.eyebrow, { color: colors.accent }]}>WEB HOST CHECK</Text>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          This preview host cannot run JIEN safely
        </Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          GitHub Pages cannot provide the browser isolation headers required by Expo SQLite. Use JIEN&apos;s Vercel preview once deployment completes. No local data was removed.
        </Text>
        <Text selectable style={[styles.code, { color: colors.warning }]}>Host code: CROSS_ORIGIN_ISOLATION_REQUIRED</Text>
      </View>
    </View>
  );
}

export function WebSQLiteDatabaseLifecycle() {
  if (Platform.OS !== 'web') return null;
  return <WebSQLiteDatabaseLifecycleContent />;
}

function WebSQLiteDatabaseLifecycleContent() {
  const database = useSQLiteContext();
  const ownership = useContext(WebSQLiteOwnershipContext);

  useEffect(() => {
    try {
      window.sessionStorage.removeItem(BOOT_RELOAD_KEY);
    } catch {
      // A successfully opened database is authoritative when storage is restricted.
    }

    return ownership?.registerDatabaseCloser(() => database.closeSync());
  }, [database, ownership]);

  return null;
}

export class WebSQLiteProviderStartupError extends Error {
  constructor(readonly cause: unknown) {
    super('Web SQLite provider failed to start.');
    this.name = 'WebSQLiteProviderStartupError';
  }
}

export function reportWebSQLiteProviderError(cause: Error): never {
  throw new WebSQLiteProviderStartupError(cause);
}

type BoundaryState = { error: Error | null };

export class WebSQLiteProviderErrorBoundary extends Component<PropsWithChildren, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (!(error instanceof WebSQLiteProviderStartupError)) return;
    console.error('Web SQLite provider startup failed', error.cause, info.componentStack);
    const failure = describeWebSQLiteStartupFailure(error.cause);
    let shouldReload = false;
    try {
      const hasReloaded = window.sessionStorage.getItem(BOOT_RELOAD_KEY) === '1';
      shouldReload = !hasReloaded && failure.retryWithReload;
      if (shouldReload) window.sessionStorage.setItem(BOOT_RELOAD_KEY, '1');
    } catch {
      // Without a marker, show recovery controls instead of risking a loop.
    }
    if (shouldReload) setTimeout(() => window.location.reload(), 600);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (!(error instanceof WebSQLiteProviderStartupError)) throw error;

    const retry = () => {
      try {
        window.sessionStorage.removeItem(BOOT_RELOAD_KEY);
      } catch {
        // Reload remains a non-destructive retry when session storage is restricted.
      }
      window.location.reload();
    };

    return (
      <WebSQLiteStartupPanel
        failure={describeWebSQLiteStartupFailure(error.cause)}
        onRetry={retry}
      />
    );
  }
}

function WebSQLiteStartupPanel({
  actionLabel = 'Try again',
  failure,
  onRetry,
}: {
  actionLabel?: string;
  failure: { code: string; message: string; detail?: string } | null;
  onRetry: () => void;
}) {
  const colorScheme = useColorScheme();
  const { colors } = resolveTheme(colorScheme);
  const isPreparing = failure == null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.eyebrow, { color: colors.accent }]}>WEB TESTER STARTUP</Text>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          {isPreparing ? 'Preparing JIEN...' : 'JIEN could not start'}
        </Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          {isPreparing
            ? 'Starting your secure session. JIEN may retry once automatically.'
            : failure?.message}
        </Text>
        {failure ? (
          <>
            <Text selectable style={[styles.code, { color: colors.warning }]}>Startup code: {failure.code}</Text>
            {failure.detail ? (
              <Text selectable style={[styles.detail, { color: colors.textMuted }]}>{failure.detail}</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={onRetry}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: colors.accent },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.buttonLabel, { color: colors.textOnAccent }]}>{actionLabel}</Text>
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
