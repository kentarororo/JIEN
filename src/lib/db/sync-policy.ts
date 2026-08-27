export type SyncFailureDisposition = 'transient' | 'action_required';

export type SyncFailureCategory =
  | 'network'
  | 'timeout'
  | 'rate_limited'
  | 'server'
  | 'authentication'
  | 'authorization'
  | 'validation'
  | 'schema'
  | 'configuration'
  | 'unknown';

export type SyncFailureClassification = {
  disposition: SyncFailureDisposition;
  category: SyncFailureCategory;
  code: string;
  safeMessage: string;
};

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  details?: unknown;
  hint?: unknown;
};

function asErrorLike(cause: unknown): ErrorLike {
  return cause && typeof cause === 'object' ? cause as ErrorLike : {};
}

function numericStatus(error: ErrorLike): number | null {
  const candidate = error.status ?? error.statusCode;
  const parsed = typeof candidate === 'number' ? candidate : Number(candidate);
  return Number.isFinite(parsed) && parsed >= 100 ? parsed : null;
}

function normalizedErrorText(error: ErrorLike): string {
  return [error.name, error.code, error.message, error.details, error.hint]
    .filter((item): item is string => typeof item === 'string')
    .join(' ')
    .toLowerCase();
}

function classified(
  disposition: SyncFailureDisposition,
  category: SyncFailureCategory,
  safeMessage: string,
): SyncFailureClassification {
  return { disposition, category, code: category.toUpperCase(), safeMessage };
}

/** Convert provider-specific failures into stable, non-sensitive sync behavior. */
export function classifySyncFailure(cause: unknown): SyncFailureClassification {
  const error = asErrorLike(cause);
  const status = numericStatus(error);
  const text = normalizedErrorText(error);
  const code = typeof error.code === 'string' ? error.code.toUpperCase() : '';

  if (status === 408 || (status == null && /aborterror|timeout|timed out|etimedout/.test(text))) {
    return classified('transient', 'timeout', 'Cloud sync timed out. Retrying automatically.');
  }
  if (status === 429 || (status == null && /rate.?limit|too many requests/.test(text))) {
    return classified('transient', 'rate_limited', 'Cloud sync is temporarily rate-limited. Retrying automatically.');
  }
  if ((status != null && status >= 500) || /^PGRST00[0-3]$/.test(code)) {
    return classified('transient', 'server', 'The cloud service is temporarily unavailable. Retrying automatically.');
  }
  if (
    status == null
    && (
      /failed to fetch|network request failed|networkerror|network_error|fetch_error|econnreset|enotfound|offline|connection (?:closed|reset|interrupted)/.test(text)
      || (error instanceof TypeError && /fetch|network/.test(text))
    )
  ) {
    return classified('transient', 'network', 'Connection interrupted. Retrying automatically.');
  }

  if (
    status === 401
    || /^PGRST30[12]$/.test(code)
    || /jwt|refresh token|auth(?:entication)? required|invalid api key|session (?:expired|missing)|not signed in/.test(text)
  ) {
    return classified('action_required', 'authentication', 'Your sign-in needs attention. Sign in again, then retry sync.');
  }
  if (status === 403 || code === '42501' || /row.level security|permission denied|not authorized|forbidden/.test(text)) {
    return classified('action_required', 'authorization', 'Cloud access needs attention. Confirm the account and app version, then retry sync.');
  }
  if (
    code === '42P01'
    || code === '42703'
    || code === 'PGRST204'
    || /schema cache|undefined (?:table|column)|column .* does not exist|relation .* does not exist/.test(text)
  ) {
    return classified('action_required', 'schema', 'Cloud sync needs an app or database update before it can continue.');
  }
  if (/not configured|missing .*supabase|invalid (?:url|configuration)|configuration/.test(text)) {
    return classified('action_required', 'configuration', 'Cloud sync is not configured for this build. Local records remain on this device.');
  }
  if (
    error instanceof SyntaxError
    || status === 400
    || status === 409
    || status === 422
    || /^22/.test(code)
    || /^23/.test(code)
    || /invalid (?:input|payload|value)|validation|constraint|malformed/.test(text)
  ) {
    return classified('action_required', 'validation', 'One queued record needs an app update or correction before it can sync.');
  }

  return classified('action_required', 'unknown', 'Cloud sync needs attention. Update the app or sign in again, then retry.');
}

export const SYNC_RETRY_BASE_MS = 60_000;
export const SYNC_RETRY_MAX_MS = 60 * 60_000;

/** Bounded exponential retry with ±25% jitter. Attempt numbers start at one. */
export function computeSyncRetryDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  const exponential = Math.min(
    SYNC_RETRY_MAX_MS,
    SYNC_RETRY_BASE_MS * 2 ** Math.min(normalizedAttempt - 1, 10),
  );
  const sample = Math.max(0, Math.min(1, random()));
  return Math.min(SYNC_RETRY_MAX_MS, Math.round(exponential * (0.75 + sample * 0.5)));
}

export type SyncQueueFailureUpdate = {
  attemptCount: number;
  nextAttemptAt: string | null;
  retryPaused: boolean;
  failureKind: SyncFailureDisposition;
  failureCode: string;
  safeMessage: string;
};

export type SyncRetryTrigger = 'background' | 'manual' | 'auth_state_change';

export function shouldResetPausedSyncFailures(trigger: SyncRetryTrigger): boolean {
  return trigger === 'manual' || trigger === 'auth_state_change';
}

export function buildSyncQueueFailureUpdate(
  previousAttemptCount: number,
  cause: unknown,
  nowMs = Date.now(),
  random: () => number = Math.random,
): SyncQueueFailureUpdate {
  const failure = classifySyncFailure(cause);
  const attemptCount = Math.max(0, previousAttemptCount) + 1;
  return {
    attemptCount,
    nextAttemptAt: failure.disposition === 'transient'
      ? new Date(nowMs + computeSyncRetryDelayMs(attemptCount, random)).toISOString()
      : null,
    retryPaused: failure.disposition === 'action_required',
    failureKind: failure.disposition,
    failureCode: failure.code,
    safeMessage: failure.safeMessage,
  };
}
