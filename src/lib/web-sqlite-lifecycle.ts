export const WEB_SQLITE_LOCK_NAME = 'jien:sqlite:jien.db';
export const WEB_SQLITE_HANDOFF_CHANNEL_NAME = 'jien:sqlite:jien.db:ownership:v1';
export const WEB_SQLITE_HANDOFF_SETTLE_MS = 350;

const WEB_SQLITE_HANDOFF_PROTOCOL = 'jien-web-sqlite-ownership-v1';

export type WebSQLiteOwnerIdentity = {
  startedAt: number;
  pageId: string;
};

export type WebSQLiteHandoffRequest = {
  protocol: typeof WEB_SQLITE_HANDOFF_PROTOCOL;
  type: 'request-ownership';
  requester: WebSQLiteOwnerIdentity;
};

/**
 * A later page wins ownership. The page ID is a deterministic tie-breaker for
 * two documents that start in the same millisecond, preventing both from
 * yielding during a simultaneous refresh/open.
 */
export function shouldYieldWebSQLiteOwnership(
  current: WebSQLiteOwnerIdentity,
  message: unknown,
): message is WebSQLiteHandoffRequest {
  if (!isWebSQLiteHandoffRequest(message)) return false;
  const requester = message.requester;
  return requester.startedAt > current.startedAt ||
    (requester.startedAt === current.startedAt && requester.pageId > current.pageId);
}

export function createWebSQLiteHandoffRequest(
  requester: WebSQLiteOwnerIdentity,
): WebSQLiteHandoffRequest {
  return {
    protocol: WEB_SQLITE_HANDOFF_PROTOCOL,
    type: 'request-ownership',
    requester,
  };
}

function isWebSQLiteHandoffRequest(value: unknown): value is WebSQLiteHandoffRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WebSQLiteHandoffRequest>;
  const requester = candidate.requester as Partial<WebSQLiteOwnerIdentity> | undefined;
  return candidate.protocol === WEB_SQLITE_HANDOFF_PROTOCOL &&
    candidate.type === 'request-ownership' &&
    typeof requester?.startedAt === 'number' &&
    Number.isFinite(requester.startedAt) &&
    typeof requester.pageId === 'string' &&
    requester.pageId.length > 0;
}

type LockRequest = (
  name: string,
  callback: (lock: unknown) => Promise<void>,
) => Promise<unknown>;

export type WebSQLiteLease = {
  acquired: Promise<void>;
  finished: Promise<void>;
  release: () => void;
};

/**
 * Serializes access to Expo SQLite's OPFS worker across browser documents.
 *
 * The lock is requested by the window rather than the SQLite worker so WebKit
 * reliably releases it if the document is terminated during navigation.
 */
export function requestWebSQLiteLease(
  requestLock: LockRequest | null,
): WebSQLiteLease {
  let resolveAcquired!: () => void;
  let rejectAcquired!: (reason: unknown) => void;
  let resolveHold!: () => void;
  let released = false;

  const acquired = new Promise<void>((resolve, reject) => {
    resolveAcquired = resolve;
    rejectAcquired = reject;
  });
  const hold = new Promise<void>((resolve) => {
    resolveHold = resolve;
  });

  if (!requestLock) {
    resolveAcquired();
    return {
      acquired,
      finished: Promise.resolve(),
      release: () => {
        released = true;
      },
    };
  }

  const finished = requestLock(WEB_SQLITE_LOCK_NAME, async () => {
    resolveAcquired();
    await hold;
  }).then(
    () => undefined,
    (error) => {
      rejectAcquired(error);
      throw error;
    },
  );

  return {
    acquired,
    finished,
    release: () => {
      if (released) return;
      released = true;
      resolveHold();
    },
  };
}

export type WebSQLitePageLifecycle = {
  closeForPageTransition: () => void;
  registerDatabaseCloser: (closeDatabaseSync: () => void) => () => void;
  restoreAfterPageTransition: () => void;
};

/**
 * Closes the worker-backed database before a refresh can start another worker.
 * `closeSync` is intentional: an asynchronous pagehide task can be abandoned by
 * mobile Safari before the OPFS access handle has actually been released.
 */
export function createWebSQLitePageLifecycle(options: {
  closeDatabaseSync?: () => void;
  terminateWorkers: () => void;
  releaseLease: () => void;
  reload: () => void;
}): WebSQLitePageLifecycle {
  let closed = false;
  let closeDatabaseSync = options.closeDatabaseSync ?? null;

  return {
    closeForPageTransition() {
      if (closed) return;
      closed = true;
      try {
        closeDatabaseSync?.();
      } finally {
        try {
          options.terminateWorkers();
        } finally {
          options.releaseLease();
        }
      }
    },
    registerDatabaseCloser(closer) {
      if (closed) {
        // The worker registry is already shut down, including workers created
        // late while React is unmounting the provider.
        return () => undefined;
      }
      closeDatabaseSync = closer;
      return () => {
        if (closeDatabaseSync === closer) closeDatabaseSync = null;
      };
    },
    restoreAfterPageTransition() {
      if (closed) options.reload();
    },
  };
}
