# Web tester runtime

The deployed GitHub Pages build is an online, account-backed tester. It intentionally differs from the native app runtime:

| Runtime | SQLite database | Startup |
| --- | --- | --- |
| iOS / Android | persistent `jien.db` | local-first; cloud sync is optional background work |
| GitHub Pages web tester | main-thread SQLite with an account-scoped IndexedDB snapshot | persisted Google session, local restore, then cloud reconciliation |

## Startup order

1. OAuth callbacks complete before any SQLite provider is mounted.
2. A signed-out web visitor sees a Google-only account gate. Supabase persists the PKCE session in browser storage.
3. JIEN opens only the signed-in account's IndexedDB namespace, restores the last complete serialized SQLite image into wa-sqlite `MemoryVFS`, then runs normal migrations.
4. A successful outer SQLite transaction is serialized and atomically saved before the repository reports success. Rollbacks do not replace the previous image.
5. Account sync pushes the restored outbox before pulling newer owned rows. A completed cached profile may open while offline or during a transient partial sync; first-time restore still requires a connection.
6. Local repository writes enqueue normal sync records and trigger a short, debounced cloud sync. Queue acknowledgements and retry metadata are snapshots too.
7. Signing out unmounts the working database. The encrypted-transport cloud copy and the browser's account-scoped local image remain separate from every other account.

The database image is keyed by the verified Supabase user UUID and carries that owner and a monotonic generation in its envelope. A stale second tab cannot replace a newer generation. Corrupt or future snapshots are quarantined without deleting their bytes and rebuilt from Supabase before a replacement becomes active. Offline recovery, account conflicts, missing public Supabase configuration, and incomplete first-time restores block app screens with a retryable explanation; records are never merged between users.

## Why web uses main-thread memory

iOS Safari can retain or race OPFS access handles across refreshes, tabs, and BFCache restoration. Expo SQLite's web worker also requires `SharedArrayBuffer` and cross-origin isolation; GitHub Pages cannot provide the required response headers, and service-worker header emulation is not reliable across mobile OAuth returns. The tester therefore uses Expo's bundled wa-sqlite and `MemoryVFS` directly, without OPFS, Web Locks, a service worker, `SharedArrayBuffer`, or a Web Worker. The live working database is serialized after committed transactions and stored as an immutable IndexedDB value selected by a small atomic active pointer, so journals and temporary VFS files are never copied independently.

This snapshot includes the sync outbox, pull cursors, and recoverable meal-photo jobs. The UI does not claim a manual write succeeded until its local snapshot write completes. Supabase remains the cross-device store and reconciliation target.

## Deployment expectations

- `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` must be present at build time.
- Google and Supabase OAuth callback configuration remains documented in `docs/google-oauth.md`.
- The Pages finalizer copies the SQLite WASM binary to a public non-hidden asset path and cache-busts the importing entry bundle.
- This switch does not change native persistence, Supabase schema, RLS, secrets, or external provider settings.
