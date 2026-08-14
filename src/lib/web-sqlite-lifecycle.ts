export const WEB_SQLITE_LOCK_NAME = 'jien:sqlite:jien.db';

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
  restoreAfterPageTransition: () => void;
};

/**
 * Closes the worker-backed database before a refresh can start another worker.
 * `closeSync` is intentional: an asynchronous pagehide task can be abandoned by
 * mobile Safari before the OPFS access handle has actually been released.
 */
export function createWebSQLitePageLifecycle(options: {
  closeDatabaseSync: () => void;
  terminateWorkers: () => void;
  releaseLease: () => void;
  reload: () => void;
}): WebSQLitePageLifecycle {
  let closed = false;

  return {
    closeForPageTransition() {
      if (closed) return;
      closed = true;
      try {
        options.closeDatabaseSync();
      } finally {
        try {
          options.terminateWorkers();
        } finally {
          options.releaseLease();
        }
      }
    },
    restoreAfterPageTransition() {
      if (closed) options.reload();
    },
  };
}
