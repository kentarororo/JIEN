import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting, setSetting } from './settings';

export const ACCOUNT_SYNC_HEALTH_KEY = 'account_sync_health_v1';

export type AccountSyncHealthState =
  | 'synced'
  | 'offline'
  | 'not_configured'
  | 'signed_out'
  | 'partial'
  | 'action_required'
  | 'account_conflict';

export type AccountSyncOutcome = {
  state: AccountSyncHealthState;
  pushed?: number;
  pulled?: number;
  profileRestored?: boolean;
  error?: string;
  code?: string;
};

export type AccountSyncHealth = {
  schemaVersion: 1;
  state: AccountSyncHealthState;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  pushed: number;
  pulled: number;
  profileRestored: boolean;
  code: string | null;
  safeMessage: string | null;
};

const STATES = new Set<AccountSyncHealthState>([
  'synced',
  'offline',
  'not_configured',
  'signed_out',
  'partial',
  'action_required',
  'account_conflict',
]);
const healthListeners = new Set<() => void>();

export function buildAccountSyncHealth(
  previous: AccountSyncHealth | null,
  outcome: AccountSyncOutcome,
  attemptedAt = new Date().toISOString(),
): AccountSyncHealth {
  const normalizedAttempt = validTimestamp(attemptedAt) ?? new Date().toISOString();
  return {
    schemaVersion: 1,
    state: outcome.state,
    lastAttemptAt: normalizedAttempt,
    lastSuccessAt: outcome.state === 'synced' ? normalizedAttempt : previous?.lastSuccessAt ?? null,
    pushed: nonNegativeInteger(outcome.pushed),
    pulled: nonNegativeInteger(outcome.pulled),
    profileRestored: outcome.profileRestored === true,
    code: outcome.state === 'action_required' && typeof outcome.code === 'string'
      ? outcome.code
      : null,
    safeMessage: (outcome.state === 'partial' || outcome.state === 'action_required')
      && typeof outcome.error === 'string'
      ? outcome.error
      : null,
  };
}

export function parseAccountSyncHealth(raw: string | null): AccountSyncHealth | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<AccountSyncHealth>;
    if (
      value.schemaVersion !== 1
      || typeof value.state !== 'string'
      || !STATES.has(value.state as AccountSyncHealthState)
    ) return null;
    const lastAttemptAt = validTimestamp(value.lastAttemptAt);
    const lastSuccessAt = value.lastSuccessAt == null ? null : validTimestamp(value.lastSuccessAt);
    if (!lastAttemptAt || (value.lastSuccessAt != null && !lastSuccessAt)) return null;
    return {
      schemaVersion: 1,
      state: value.state as AccountSyncHealthState,
      lastAttemptAt,
      lastSuccessAt,
      pushed: nonNegativeInteger(value.pushed),
      pulled: nonNegativeInteger(value.pulled),
      profileRestored: value.profileRestored === true,
      code: typeof value.code === 'string' ? value.code : null,
      safeMessage: typeof value.safeMessage === 'string' ? value.safeMessage : null,
    };
  } catch {
    return null;
  }
}

export async function getAccountSyncHealth(db: SQLiteDatabase): Promise<AccountSyncHealth | null> {
  return parseAccountSyncHealth(await getSetting(db, ACCOUNT_SYNC_HEALTH_KEY));
}

export async function recordAccountSyncHealth(
  db: SQLiteDatabase,
  outcome: AccountSyncOutcome,
  attemptedAt = new Date().toISOString(),
): Promise<AccountSyncHealth> {
  const previous = await getAccountSyncHealth(db);
  const next = buildAccountSyncHealth(previous, outcome, attemptedAt);
  await setSetting(db, ACCOUNT_SYNC_HEALTH_KEY, JSON.stringify(next));
  for (const listener of healthListeners) {
    try {
      listener();
    } catch {
      // A status surface cannot change the result of the completed sync attempt.
    }
  }
  return next;
}

export function subscribeToAccountSyncHealth(listener: () => void): () => void {
  healthListeners.add(listener);
  return () => healthListeners.delete(listener);
}

function validTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}
