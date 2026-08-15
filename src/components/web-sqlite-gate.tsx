import { useSQLiteContext } from '@/lib/db/database-context';
import { Component, createContext, type ErrorInfo, type PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import {
  describeWebSQLiteStartupFailure,
} from '@/lib/web-sqlite-bootstrap';
import {
  evaluateWebSQLiteReadiness,
  type WebSQLiteReadiness,
} from '@/lib/web-sqlite-readiness';
import { radii, resolveTheme, spacing, typography } from '@/theme/tokens';

const ISOLATION_RELOAD_KEY = 'jien:sqlite-isolation-reload';
const BOOT_RELOAD_KEY = 'jien:sqlite-bootstrap-reload';

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

function readEnvironment(): WebSQLiteReadiness {
  const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<unknown> };
  return evaluateWebSQLiteReadiness({
    isSecureContext: window.isSecureContext,
    isCrossOriginIsolated: window.crossOriginIsolated === true,
    hasSharedArrayBuffer: typeof globalThis.SharedArrayBuffer !== 'undefined',
    hasServiceWorker: 'serviceWorker' in navigator,
    hasStorageDirectory: typeof storage?.getDirectory === 'function',
    hasWorker: typeof globalThis.Worker !== 'undefined',
  }, 'memory');
}

export function WebSQLiteGate({ children }: PropsWithChildren) {
  if (Platform.OS !== 'web') return children;
  return <WebSQLiteGateContent>{children}</WebSQLiteGateContent>;
}

function WebSQLiteGateContent({ children }: PropsWithChildren) {
  const [readiness, setReadiness] = useState<WebSQLiteReadiness>({
    state: 'preparing',
    code: 'WAITING_FOR_ISOLATION',
  });
  const closers = useRef(new Set<() => void>());

  const registerDatabaseCloser = useCallback((closeDatabaseSync: () => void) => {
    closers.current.add(closeDatabaseSync);
    return () => closers.current.delete(closeDatabaseSync);
  }, []);

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
    void retireLegacyIsolationServiceWorker().catch((error) => {
      console.warn('Could not retire the legacy JIEN isolation service worker', error);
    });
    refresh();

    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (readiness.state !== 'ready') return;
    const closeMemoryDatabase = () => {
      for (const close of [...closers.current]) {
        try { close(); } catch (error) { console.error('Failed to close web SQLite memory database', error); }
      }
    };
    window.addEventListener('pagehide', closeMemoryDatabase);

    return () => {
      window.removeEventListener('pagehide', closeMemoryDatabase);
      closeMemoryDatabase();
    };
  }, [readiness.state]);

  if (readiness.state === 'ready') {
    return (
      <WebSQLiteOwnershipContext.Provider value={{ registerDatabaseCloser }}>
        {children}
      </WebSQLiteOwnershipContext.Provider>
    );
  }

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
  const failure = environmentFailure;

  return (
    <WebSQLiteStartupPanel
      actionLabel="Try again"
      failure={failure}
      onRetry={retry}
    />
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
