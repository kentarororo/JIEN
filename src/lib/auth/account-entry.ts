export type AccountSyncSnapshot = {
  state: 'synced' | 'offline' | 'not_configured' | 'signed_out' | 'partial' | 'action_required' | 'account_conflict';
  profileRestored?: boolean;
  error?: string;
};

export type AccountEntryDecision =
  | { kind: 'app' }
  | { kind: 'onboarding' }
  | { kind: 'welcome'; notice: string | null; noticeTone: 'neutral' | 'warning' }
  | { kind: 'account_conflict'; message: string; mayWriteToCloud: false };

const ACCOUNT_CONFLICT_MESSAGE = 'This device belongs to a different JIEN account. Sign in with the original account to restore it. JIEN has not merged or uploaded either person\'s records.';

/** Resolve routing only after account sync has had a chance to restore a profile. */
export function resolveAccountEntry(
  hasCompletedProfile: boolean,
  sync: AccountSyncSnapshot,
): AccountEntryDecision {
  if (sync.state === 'account_conflict') {
    return {
      kind: 'account_conflict',
      message: ACCOUNT_CONFLICT_MESSAGE,
      mayWriteToCloud: false,
    };
  }

  if (hasCompletedProfile) return { kind: 'app' };

  if (sync.state === 'offline') {
    return {
      kind: 'welcome',
      notice: 'JIEN could not check your cloud profile while offline. Reconnect to restore, or continue locally.',
      noticeTone: 'warning',
    };
  }

  if (sync.state === 'partial' || sync.state === 'action_required') {
    return {
      kind: 'welcome',
      notice: `JIEN could not finish checking your cloud profile. ${sync.error ?? 'Please try again.'}`,
      noticeTone: 'warning',
    };
  }

  if (sync.state === 'synced') {
    // Authentication and cloud restore have both finished. A signed-in user
    // without a completed profile is new (or has an unfinished profile), so
    // sending them back to account entry creates an OAuth loop.
    return { kind: 'onboarding' };
  }

  return { kind: 'welcome', notice: null, noticeTone: 'neutral' };
}

export function routeForLocalEntry(hasCompletedProfile: boolean): '/(tabs)/today' | '/onboarding' {
  return hasCompletedProfile ? '/(tabs)/today' : '/onboarding';
}

export type RetryableAuthFailure = { message: string; retryable: true };

export function retryableAuthFailure(cause: unknown): RetryableAuthFailure {
  return {
    message: cause instanceof Error ? cause.message : 'Sign-in did not finish. Please try again.',
    retryable: true,
  };
}
