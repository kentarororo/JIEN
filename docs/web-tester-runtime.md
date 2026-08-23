# Web tester runtime

The supported web tester is the Vercel deployment. It uses Expo SQLite's persistent browser implementation rather than the retired main-thread memory/snapshot implementation.

| Runtime | SQLite database | Host behavior |
| --- | --- | --- |
| iOS / Android | persistent native `jien.db` | local-first; cloud sync remains background work |
| Vercel web tester | persistent Expo SQLite `jien.db` in origin-private file-system (OPFS) storage | cross-origin isolated, worker-backed, and coordinated across pages |
| GitHub Pages | none | shows `CROSS_ORIGIN_ISOLATION_REQUIRED` and does not mount SQLite |

## Startup order

1. OAuth callbacks complete before the ownership gate or `SQLiteProvider` mounts. A normal signed-out visitor then sees the Google account gate; Supabase persists the PKCE session in browser storage.
2. The Vercel response is checked for cross-origin isolation and `SharedArrayBuffer`, which Expo SQLite requires for its synchronous worker bridge. Unsupported hosts stop before touching SQLite.
3. JIEN installs worker tracking before any database consumer can render.
4. The page opens a same-origin `BroadcastChannel`, announces that it wants `jien.db`, and asks an older JIEN page to tear down proactively. A timestamp plus page ID breaks simultaneous-open ties in favor of one newer page.
5. The page acquires the origin Web Lock named `jien:sqlite:jien.db`. After acquisition it waits briefly for WebKit to finish releasing the prior worker's OPFS access handles.
6. Only then does JIEN mount the single official Expo `SQLiteProvider` for persistent `jien.db`, run normal migrations, and register a synchronous database closer.
7. The signed-in account is hydrated from Supabase before application database consumers render. Normal local writes remain SQLite-first and enqueue background cloud sync work.

Expo's web worker uses wa-sqlite `AccessHandlePoolVFS`. Its access-handle pool remains alive for the worker lifetime, so closing only the SQLite connection is insufficient during a refresh or cross-tab takeover.

## Ownership and teardown

Each document owns the database for one lifecycle. `pagehide`, ownership transfer to a newer tab, provider startup failure, retry, and gate unmount all use the same deterministic sequence:

1. Call the registered SQLite `closeSync` function when the provider opened successfully.
2. Shut down the worker registry, terminating Expo's SQLite worker and any worker created late during teardown.
3. Release the Web Lock so the waiting page can become the owner.

The `pagehide` path is synchronous because browsers may abandon asynchronous cleanup during refresh or mobile Safari navigation. If a closed page is restored from the back-forward cache, it reloads instead of reusing the terminated worker. A tab displaced by a newer tab shows `LOCAL_STORAGE_HANDED_OFF`; choosing **Use this tab** reloads and requests ownership again.

These recovery paths never clear OPFS, IndexedDB, Supabase authentication, or user records. `LOCAL_STORAGE_BUSY` is treated as a non-destructive startup failure and receives at most one automatic reload before recovery controls remain visible.

## Deployment expectations

- `vercel.json` must keep `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` on application responses.
- `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` must be present at build time.
- `pnpm run web:build` exports the Expo web app and copies the SQLite WASM asset to the public `assets/jien-sqlite` path used by the finalized bundle.
- Google and Supabase OAuth callback configuration remains documented in `docs/google-oauth.md`.
- GitHub Pages is intentionally only a host-requirements screen; it is not a fallback database runtime.
- This architecture does not change native persistence, the Supabase schema, RLS, secrets, or external provider settings.
