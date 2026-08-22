// Expo's web provider is supported only when the host supplies COOP/COEP
// headers. WebSQLiteGate verifies that contract before this provider mounts.
export { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
