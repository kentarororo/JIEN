# Web tester runtime

The deployed GitHub Pages build is an online, account-backed tester. It intentionally differs from the native app runtime:

| Runtime | SQLite database | Startup |
| --- | --- | --- |
| iOS / Android | persistent `jien.db` | local-first; cloud sync is optional background work |
| GitHub Pages web tester | main-thread SQLite `:memory:` | Google session, then a complete Supabase hydration before screens render |

## Startup order

1. OAuth callbacks complete before any SQLite provider is mounted.
2. A signed-out web visitor sees a Google-only account gate. Supabase persists the PKCE session in browser storage.
3. Once authenticated and online, JIEN opens the wa-sqlite `MemoryVFS` directly on the browser main thread and runs the normal migrations.
4. Account sync pulls the signed-in user's profile and owned rows into memory. App screens render only after that succeeds.
5. Local repository writes still enqueue the normal sync records. Web listens for those enqueues and triggers a short, debounced cloud sync.
6. Signing out unmounts the memory database and returns to the account gate.

The web build never treats memory as durable storage. Offline startup, an account conflict, missing public Supabase configuration, or an incomplete restore blocks app screens with a retryable explanation. Account ownership checks in the existing sync layer remain authoritative and never merge records between users.

## Why web uses main-thread memory

iOS Safari can retain or race OPFS access handles across refreshes, tabs, and BFCache restoration. Expo SQLite's web worker also requires `SharedArrayBuffer` and cross-origin isolation; GitHub Pages cannot provide the required response headers, and service-worker header emulation is not reliable across mobile OAuth returns. The tester therefore uses Expo's bundled wa-sqlite and `MemoryVFS` directly, without OPFS, Web Locks, a service worker, `SharedArrayBuffer`, or a Web Worker. Supabase remains the durable store for this account-backed tester.

## Deployment expectations

- `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` must be present at build time.
- Google and Supabase OAuth callback configuration remains documented in `docs/google-oauth.md`.
- The Pages finalizer copies the SQLite WASM binary to a public non-hidden asset path and cache-busts the importing entry bundle.
- This switch does not change native persistence, Supabase schema, RLS, secrets, or external provider settings.
