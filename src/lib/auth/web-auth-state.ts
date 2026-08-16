export type WebAuthGateKind = 'loading' | 'signed_out' | 'offline' | 'error' | 'ready';

/**
 * A browser losing its network must not evict an already-restored Supabase
 * session. The account-scoped database remains usable offline and will sync
 * after connectivity returns.
 */
export function authKindAfterGoingOffline(current: WebAuthGateKind): WebAuthGateKind {
  return current === 'ready' ? 'ready' : 'offline';
}
