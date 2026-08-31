# Web tester runtime

The supported web tester is the Vercel deployment. Native and web expose the same repository-facing SQLite API, but deliberately use different storage drivers.

| Runtime | SQLite database | Storage driver |
| --- | --- | --- |
| iOS / Android | persistent native `jien.db` | Expo SQLite |
| Vercel web tester | persistent, account-scoped `jien.db` | wa-sqlite Asyncify on the main thread with `IDBBatchAtomicVFS` in IndexedDB |
| GitHub Pages | none | publishes a host-requirements screen; functional web testing remains Vercel-only |

The Pages finalizer replaces every exported HTML route with that static handoff and
removes all application scripts from those documents, so a direct deep link cannot
mount authentication, SQLite, or another local-data consumer.

The web runtime does not mount Expo SQLite's web worker, use `AccessHandlePoolVFS`, call `createSyncAccessHandle`, or require `SharedArrayBuffer`. Its main-thread Asyncify WASM and IndexedDB VFS run when `crossOriginIsolated` is false, including mobile browsers that do not implement COEP `credentialless`. Expo's OPFS driver can leave an access handle owned by an abandoned or singleton worker, which makes a later page fail with `NoModificationAllowedError` before application-level recovery can close it. Native still uses the supported Expo SQLite implementation.

## Startup order

1. OAuth callbacks finish before the ownership gate or database provider mounts. Supabase persists the PKCE session in browser storage.
2. Vercel may enable cross-origin isolation as defense in depth, but application startup does not depend on it. GitHub Pages remains an intentionally unsupported tester through its separate build finalizer.
3. JIEN installs worker tracking, opens the same-origin ownership `BroadcastChannel`, and announces the new page.
4. An older page that receives a newer ownership request starts deterministic teardown. The requester waits for the origin Web Lock `jien:sqlite:jien.db` and a short handoff-settle interval.
5. Only the lock owner mounts `SQLiteProvider`. The web provider obtains the authenticated user ID and opens `jien-web-sqlite-v2:<user-id>` with strict IndexedDB durability. The database filename inside that account-scoped VFS is `jien.db`.
6. If the v2 database is empty, JIEN checks the older account-scoped `jien-web-sqlite-v1:<user-id>` snapshot store. A valid, integrity-checked snapshot belonging to the same account is copied page-by-page into the v2 VFS. The old snapshot is retained. OPFS is never cleared or modified by this migration.
7. Normal migrations run, then Supabase hydration completes before application database consumers render. Local transactions remain authoritative and continue to enqueue background sync work.

The IndexedDB VFS uses Web Locks for SQLite file locking as well as the outer page-ownership lease. It commits batch-atomic page versions with strict IndexedDB durability, so refresh persistence does not require serializing the complete database after every write.

## Ownership and teardown

Every document uses the same shutdown path for `pagehide`, retry, provider startup failure, unmount, and handoff to a newer tab:

1. Call the registered database `closeSync`, which starts SQLite connection and VFS shutdown.
2. Shut down the worker registry and terminate any worker created during the page lifecycle. The current database driver creates no worker, but the registry remains installed before provider mount so the ordering contract cannot silently regress.
3. Release the outer Web Lock so the waiting page can mount. If the browser abandons asynchronous close work, document destruction releases its Web Locks and IndexedDB connection; the new VFS then performs its own file-lock acquisition.

A page restored from the back-forward cache reloads rather than reusing a closed engine. A displaced tab shows `LOCAL_STORAGE_HANDED_OFF`; choosing **Use this tab** requests ownership again.

No recovery path clears OPFS, IndexedDB, Supabase authentication, or user records. Existing Expo OPFS files remain untouched, legacy IndexedDB snapshots remain available, and signed-in accounts can rebuild missing local rows from Supabase hydration.

## Deployment expectations

- `vercel.json` uses `require-corp` rather than the less broadly implemented `credentialless` COEP mode. These headers are defense in depth; the IndexedDB driver no longer gates startup on them.
- `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` must be available at build time.
- `pnpm run web:build` exports the Expo Router app, validates the wa-sqlite Asyncify WASM, copies it to a stable `/assets/jien-sqlite/` URL, and content-hashes the patched entry bundle.
- Google and Supabase OAuth callback configuration remains in `docs/google-oauth.md`.
- This architecture does not change native persistence, the Supabase schema, RLS, secrets, or provider settings.

## Isolated browser QA

`pnpm e2e:web` builds the production Expo web bundle with a reserved fake Supabase
origin, serves it locally with the same isolation headers as Vercel, and runs the
Playwright suite in Microsoft Edge. The test context contains a fake session, mocks
only that fake origin, and opens a fresh account-scoped IndexedDB database. It never
opens, clears, or writes the production origin's OPFS, IndexedDB, authentication, or
user records.

The browser suite currently verifies:

- signed-out startup at 360, 390, 768, and 1280 CSS pixels, including dark mode and
  reduced motion;
- programmatic form labels and absence of horizontal overflow;
- onboarding followed by a completed workout and manually entered meal;
- workout history, Settings utility views, reload persistence, and visual baselines;
- BroadcastChannel/Web Lock handoff from an existing page to a newer tab.

Run `pnpm e2e:web:update` only after intentionally reviewing a visual change. It
regenerates the committed Windows/Edge screenshot baselines. Production smoke tests
remain read-only unless a dedicated QA account and explicit mutation scope are used.
