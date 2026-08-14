type AuthStorage = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};

/**
 * Supabase's PKCE verifier must survive the round trip to Google. On web this
 * deliberately uses the browser's own storage instead of Expo SQLite, so auth
 * can finish even when the local app database has not started yet.
 */
export function getAuthStorage(): AuthStorage {
  if (typeof globalThis.localStorage === 'undefined') {
    throw new Error('Browser storage is unavailable. Allow site storage, then try Google sign-in again.');
  }
  return globalThis.localStorage;
}
