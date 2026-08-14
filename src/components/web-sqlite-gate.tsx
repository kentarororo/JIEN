import { useSQLiteContext } from 'expo-sqlite';
import { Component, createContext, type ErrorInfo, type PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import {
  describeWebSQLiteStartupFailure,
  type WebSQLiteStartupFailure,
} from '@/lib/web-sqlite-bootstrap';
import {
  createWebSQLiteHandoffRequest,
  createWebSQLitePageLifecycle,
  requestWebSQLiteLease,
  shouldYieldWebSQLiteOwnership,
  WEB_SQLITE_HANDOFF_CHANNEL_NAME,
  WEB_SQLITE_HANDOFF_SETTLE_MS,
  type WebSQLiteLease,
  type WebSQLitePageLifecycle,
} from '@/lib/web-sqlite-lifecycle';
import {
  evaluateWebSQLiteReadiness,
  type WebSQLiteReadiness,
} from '@/lib/web-sqlite-readiness';
import { webSQLiteWorkerRegistry } from '@/lib/web-worker-registry';
import { radii, resolveTheme, spacing, typography } from '@/theme/tokens';

const ISOLATION_RELOAD_KEY = 'jien:sqlite-isolation-reload';
const BOOT_RELOAD_KEY = 'jien:sqlite-bootstrap-reload';

type LeaseReadiness =
  | { state: 'preparing' }
  | { state: 'ready' }
  | { state: 'displaced' }
  | ({ state: 'unsupported' } & WebSQLiteStartupFailure);

type WebSQLiteOwnershipContextValue = {
  registerDatabaseCloser: (closeDatabaseSync: () => void) => () => void;
};

const WebSQLiteOwnershipContext = createContext<WebSQLiteOwnershipContextValue | null>(null);

function createPageId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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
  });
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
  const [leaseReadiness, setLeaseReadiness] = useState<LeaseReadiness>({
    state: 'preparing',
  });
  const leaseRef = useRef<WebSQLiteLease | null>(null);
  const lifecycleRef = useRef<WebSQLitePageLifecycle | null>(null);

  const registerDatabaseCloser = useCallback((closeDatabaseSync: () => void) => {
    return lifecycleRef.current?.registerDatabaseCloser(closeDatabaseSync) ?? (() => undefined);
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
    let yielded = false;
    let channel: BroadcastChannel | null = null;
    webSQLiteWorkerRegistry.install(window);
    const requestLock = 'locks' in navigator
      ? (name: string, callback: (lock: unknown) => Promise<void>) =>
          navigator.locks.request(name, callback)
      : null;
    const lease = requestWebSQLiteLease(requestLock);
    leaseRef.current = lease;
    const lifecycle = createWebSQLitePageLifecycle({
      terminateWorkers: () => webSQLiteWorkerRegistry.shutdown(),
      releaseLease: () => lease.release(),
      reload: () => window.location.reload(),
    });
    lifecycleRef.current = lifecycle;
    const owner = { startedAt: Date.now(), pageId: createPageId() };

    const closeOwnership = () => {
      try {
        lifecycle.closeForPageTransition();
      } catch (error) {
        console.error('Failed to close the web SQLite owner', error);
      }
    };
    const handlePageHide = () => {
      yielded = true;
      closeOwnership();
    };
    const handlePageShow = () => lifecycle.restoreAfterPageTransition();

    // iOS Safari does not reliably finish React/pagehide cleanup before the
    // replacement document starts. Ask the existing same-origin JIEN page to
    // close SQLite proactively, then let the Web Lock serialize the handoff.
    if (typeof globalThis.BroadcastChannel === 'function') {
      try {
        channel = new BroadcastChannel(WEB_SQLITE_HANDOFF_CHANNEL_NAME);
        channel.addEventListener('message', (event) => {
          if (!shouldYieldWebSQLiteOwnership(owner, event.data)) return;
          yielded = true;
          closeOwnership();
          if (active) setLeaseReadiness({ state: 'displaced' });
        });
        channel.postMessage(createWebSQLiteHandoffRequest(owner));
      } catch (error) {
        console.warn('Web SQLite ownership channel is unavailable', error);
        channel?.close();
        channel = null;
      }
    }

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);

    void lease.acquired.then(async () => {
      // Give WebKit time to release the previous worker's OPFS handles after
      // the ownership lock changes hands. Opening immediately is the refresh
      // race that produced NoModificationAllowedError on iPhone.
      await new Promise((resolve) => setTimeout(resolve, WEB_SQLITE_HANDOFF_SETTLE_MS));
      if (active && !yielded) setLeaseReadiness({ state: 'ready' });
    }).catch((cause) => {
        if (active) {
          setLeaseReadiness({
            state: 'unsupported',
            ...describeWebSQLiteStartupFailure(cause),
          });
        }
      });
    // The lease normally finishes only during pagehide/unmount. Its rejection
    // is already surfaced through `acquired` when startup fails.
    void lease.finished.catch(() => undefined);

    return () => {
      active = false;
      yielded = true;
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      channel?.close();
      closeOwnership();
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
      if (leaseRef.current === lease) leaseRef.current = null;
    };
  }, [readiness.state]);

  if (readiness.state === 'ready' && leaseReadiness.state === 'ready') {
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
  const leaseFailure = leaseReadiness.state === 'unsupported' ? leaseReadiness : null;
  const handoffFailure = leaseReadiness.state === 'displaced'
    ? {
        code: 'LOCAL_STORAGE_HANDED_OFF',
        message: 'JIEN is open in a newer tab. Your local data is safe. Use this tab to move JIEN back here.',
      }
    : null;
  const failure = handoffFailure ?? leaseFailure ?? environmentFailure;

  return (
    <WebSQLiteStartupPanel
      actionLabel={handoffFailure ? 'Use this tab' : 'Try again'}
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
