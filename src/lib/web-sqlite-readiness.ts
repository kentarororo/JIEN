export type WebSQLiteEnvironment = {
  isSecureContext: boolean;
  isCrossOriginIsolated: boolean;
  hasSharedArrayBuffer: boolean;
  hasServiceWorker: boolean;
  hasStorageDirectory: boolean;
  hasWorker: boolean;
};

export type WebSQLiteMode = 'persistent' | 'memory';

export type WebSQLiteReadiness =
  | { state: 'ready' }
  | { state: 'preparing'; code: 'WAITING_FOR_ISOLATION' }
  | {
      state: 'unsupported';
      code: 'INSECURE_CONTEXT' | 'SERVICE_WORKER_UNAVAILABLE' | 'ISOLATION_TIMEOUT' | 'SHARED_MEMORY_UNAVAILABLE' | 'OPFS_UNAVAILABLE' | 'WORKER_UNAVAILABLE';
      message: string;
    };

export function evaluateWebSQLiteReadiness(
  environment: WebSQLiteEnvironment,
  mode: WebSQLiteMode = 'persistent',
): WebSQLiteReadiness {
  if (!environment.isSecureContext) {
    return { state: 'unsupported', code: 'INSECURE_CONTEXT', message: 'Open JIEN over HTTPS to use local storage.' };
  }
  // The web tester uses an in-memory wa-sqlite database on the main thread.
  // Unlike Expo's worker transport, it does not need cross-origin isolation,
  // SharedArrayBuffer, OPFS, a service worker, or a Web Worker.
  if (mode === 'memory') return { state: 'ready' };
  if (!environment.isCrossOriginIsolated) {
    if (!environment.hasServiceWorker) {
      return { state: 'unsupported', code: 'SERVICE_WORKER_UNAVAILABLE', message: 'This browser cannot prepare secure local storage for JIEN.' };
    }
    return { state: 'preparing', code: 'WAITING_FOR_ISOLATION' };
  }
  if (!environment.hasSharedArrayBuffer) {
    return { state: 'unsupported', code: 'SHARED_MEMORY_UNAVAILABLE', message: 'This browser does not provide the shared memory required by local SQLite.' };
  }
  if (!environment.hasStorageDirectory) {
    return { state: 'unsupported', code: 'OPFS_UNAVAILABLE', message: 'This browser does not provide persistent private file storage.' };
  }
  if (!environment.hasWorker) {
    return { state: 'unsupported', code: 'WORKER_UNAVAILABLE', message: 'This browser does not provide the background worker required by local SQLite.' };
  }
  return { state: 'ready' };
}
