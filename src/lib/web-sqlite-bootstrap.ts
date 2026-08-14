export type WebSQLiteStartupFailure = {
  code:
    | 'LOCAL_STORAGE_BUSY'
    | 'LOCAL_STORAGE_FULL'
    | 'SQLITE_ENGINE_LOAD_FAILED'
    | 'SQLITE_INITIALIZATION_TIMEOUT'
    | 'SQLITE_INITIALIZATION_FAILED';
  message: string;
  detail: string;
  retryWithReload: boolean;
};

export class WebSQLiteStartupTimeoutError extends Error {
  constructor() {
    super('SQLite startup timed out.');
    this.name = 'WebSQLiteStartupTimeoutError';
  }
}

export function describeWebSQLiteStartupFailure(cause: unknown): WebSQLiteStartupFailure {
  const detail = getErrorDetail(cause);
  const normalized = detail.toLowerCase();

  if (cause instanceof WebSQLiteStartupTimeoutError) {
    return {
      code: 'SQLITE_INITIALIZATION_TIMEOUT',
      message: 'Local storage took too long to respond. JIEN can safely retry without removing your data.',
      detail,
      retryWithReload: true,
    };
  }

  if (
    normalized.includes('nomodificationallowed') ||
    normalized.includes('access handle') ||
    normalized.includes('database is locked') ||
    normalized.includes('invalid vfs state')
  ) {
    return {
      code: 'LOCAL_STORAGE_BUSY',
      message: 'JIEN could not finish handing local storage over from a previous page. Wait a moment and retry. Your data is safe.',
      detail,
      retryWithReload: true,
    };
  }

  if (normalized.includes('quota') || normalized.includes('not enough space')) {
    return {
      code: 'LOCAL_STORAGE_FULL',
      message: 'This browser does not currently have enough private storage available for JIEN.',
      detail,
      retryWithReload: false,
    };
  }

  if (
    normalized.includes('webassembly') ||
    normalized.includes('wasm') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('worker script')
  ) {
    return {
      code: 'SQLITE_ENGINE_LOAD_FAILED',
      message: 'The local database engine did not finish loading. Check the connection and retry.',
      detail,
      retryWithReload: true,
    };
  }

  return {
    code: 'SQLITE_INITIALIZATION_FAILED',
    message: 'JIEN could not open its local database. Your existing local data has not been removed.',
    detail,
    retryWithReload: true,
  };
}

export async function withWebSQLiteStartupTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new WebSQLiteStartupTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function getErrorDetail(cause: unknown): string {
  if (cause instanceof Error) {
    return `${cause.name}: ${cause.message}`.slice(0, 500);
  }
  return String(cause).slice(0, 500);
}
