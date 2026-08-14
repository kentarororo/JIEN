import 'expo-sqlite/localStorage/install';

type AuthStorage = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};

/** Native auth persistence. Metro substitutes storage.web.ts in web builds. */
export function getAuthStorage(): AuthStorage {
  return globalThis.localStorage;
}
