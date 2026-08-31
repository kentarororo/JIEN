# Web tester runtime

The supported web tester is the Vercel deployment. Native and web expose the same repository-facing SQLite API, but deliberately use different storage drivers.

| Runtime | SQLite database | Storage driver |
| --- | --- | --- |
| iOS / Android | persistent native `jien.db` | Expo SQLite |
| Vercel web tester on Chromium / Android | persistent, account-scoped `jien.db` | wa-sqlite Asyncify on the main thread with `IDBBatchAtomicVFS` in IndexedDB |
| Vercel web tester on Safari / iOS WebKit | persistent, account-scoped `jien.db` | wa-sqlite Asyncify with `MemoryVFS` and atomic IndexedDB snapshots |
| GitHub Pages | none | publishes a host-requirements screen; functional web testing remains Vercel-only |

The Pages finalizer replaces every exported HTML route with that static handoff and
removes all application scripts from those documents, so a direct deep link cannot
mount authentication, SQLite, or another local-data consumer.

The web runtime does not mount Expo SQLite's web worker, use `AccessHandlePoolVFS`, call `createSyncAccessHandle`, or require `SharedArrayBuffer`. Its main-thread Asyncify WASM runs when `crossOriginIsolated` is false, including mobile browsers that do not implement COEP `credentialless`. Chromium uses the page-based IndexedDB VFS. Safari and every iOS browser use the snapshot-backed MemoryVFS because WebKit can stall after the sample page-based VFS acquires its SQLite reserved lock. Expo's OPFS driver can leave an access handle owned by an abandoned or singleton worker, which makes a later page fail with `NoModificationAllowedError` before application-level recovery can close it. Native still uses the supported Expo SQLite implementation.

## Startup order

1. OAuth callbacks finish before the ownership gate or database provider mounts. Supabase persists the PKCE session in browser storage.
2. Vercel may enable cross-origin isolation as defense in depth, but application startup does not depend on it. GitHub Pages remains an intentionally unsupported tester through its separate build finalizer.
3. JIEN installs worker tracking, opens the same-origin ownership `BroadcastChannel`, and announces the new page.
4. An older page that receives a newer ownership request starts deterministic teardown. The requester waits for the origin Web Lock `jien:sqlite:jien.db` and a short handoff-settle interval.
5. Only the lock owner mounts `SQLiteProvider`. The web provider obtains the authenticated user ID and selects its storage implementation. Chromium opens `jien-web-sqlite-v2:<user-id>` with strict IndexedDB durability. Safari/WebKit opens the account-scoped `jien-web-sqlite-v1:<user-id>` snapshot store and restores `jien.db` into MemoryVFS.
6. Chromium checks the snapshot store when its v2 database is empty. Safari checks the page store when its snapshot store is empty and reconstructs a valid SQLite image from the committed page versions. Imports copy bytes and retain both sources. Every restored image is checked for a SQLite header, supported schema, integrity, foreign keys, and the authenticated owner. OPFS is never cleared or modified.
7. Normal migrations run, then Supabase hydration completes before application database consumers render. Local transactions remain authoritative and continue to enqueue background sync work.

The Chromium IndexedDB VFS uses Web Locks for SQLite file locking as well as the outer page-ownership lease. It commits batch-atomic page versions with strict IndexedDB durability. Safari's MemoryVFS is protected by the same outer lease and writes immutable, account-scoped snapshot generations after committed local transactions. Snapshot persistence is paused during initial cloud hydration and resumes with one complete image, preventing partially hydrated state from becoming authoritative.

Provider startup has a bounded timeout. A browser engine or storage implementation that stops responding is closed when it eventually resolves and surfaces `SQLITE_INITIALIZATION_TIMEOUT`; it does not leave users on an unlabelled blank page and does not clear any storage.

## Safari storage growth

Safari snapshots contain the SQLite file only. Meal-photo payloads remain in their
separate account-scoped store, so image growth does not multiply the database image.
The snapshot store keeps the active and previous valid generations for recovery and
deletes only an obsolete third generation after the replacement commits atomically.

On first snapshot-store use, JIEN makes a best-effort Storage API persistence request.
Before every new generation it uses `StorageManager.estimate()` when available and
requires room for the complete next image plus a safety margin. If there is not enough
room, the write fails as `QuotaExceededError`, the open-tab transaction reports a
durability failure, and existing generations remain untouched. JIEN never attempts to
solve storage pressure by silently deleting workouts, meals, snapshots, or sync rows.

The browser storage selector is an explicit implementation boundary. A future tested
WebKit incremental or chunked driver can replace snapshot mode without changing the
repository API, SQLite schema, Supabase sync contract, or account-scoped database
names. Move Safari to that driver only after real-device recovery, handoff, and
interrupted-write tests pass; do not switch based on feature detection alone.

## Ownership and teardown

Every document uses the same shutdown path for `pagehide`, retry, provider startup failure, unmount, and handoff to a newer tab:

1. Call the registered database `closeSync`, which starts SQLite connection and VFS shutdown.
2. Shut down the worker registry and terminate any worker created during the page lifecycle. The current database driver creates no worker, but the registry remains installed before provider mount so the ordering contract cannot silently regress.
3. Release the outer Web Lock so the waiting page can mount. If the browser abandons asynchronous close work, document destruction releases its Web Locks and IndexedDB connection; the new VFS then performs its own file-lock acquisition.

A page restored from the back-forward cache reloads rather than reusing a closed engine. A displaced tab shows `LOCAL_STORAGE_HANDED_OFF`; choosing **Use this tab** requests ownership again.

No recovery path clears OPFS, IndexedDB, Supabase authentication, or user records. Existing Expo OPFS files remain untouched, both IndexedDB formats remain available, and signed-in accounts can rebuild missing local rows from Supabase hydration.

## Deployment expectations

- `vercel.json` uses `require-corp` rather than the less broadly implemented `credentialless` COEP mode. These headers are defense in depth; the IndexedDB driver no longer gates startup on them.
- `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` must be available at build time.
- `pnpm run web:build` exports the Expo Router app, validates the wa-sqlite Asyncify WASM, copies it to a stable `/assets/jien-sqlite/` URL, and content-hashes the patched entry bundle.
- Google and Supabase OAuth callback configuration remains in `docs/google-oauth.md`.
- This architecture does not change native persistence, the Supabase schema, RLS, secrets, or provider settings.

## Isolated browser QA

`pnpm e2e:web` builds the production Expo web bundle with a reserved fake Supabase
origin, serves it locally with the same isolation headers as Vercel, and runs the
Playwright suite in Microsoft Edge desktop, Pixel 7 Chromium emulation, and iPhone
WebKit emulation. The test context contains a fake session, mocks
only that fake origin, and opens a fresh account-scoped IndexedDB database. It never
opens, clears, or writes the production origin's OPFS, IndexedDB, authentication, or
user records.

The browser suite currently verifies:

- signed-out startup at 360, 390, 768, and 1280 CSS pixels, including dark mode and
  reduced motion;
- programmatic form labels and absence of horizontal overflow;
- touch-sized controls on Android Chrome and iOS WebKit without horizontal overflow;
- onboarding followed by a completed workout and manually entered meal in all three engines;
- workout history, Settings utility views, reload persistence, and Edge visual baselines;
- BroadcastChannel/Web Lock handoff from an existing page to a newer tab in all three engines.

These projects validate the deployed browser architecture. Native Android builds still
use Expo SQLite and require an Android SDK/device run; native iOS builds require macOS,
Xcode, and a simulator or device. Browser emulation is not presented as native-build
certification.

Run `pnpm e2e:web:update` only after intentionally reviewing a visual change. It
regenerates the committed Windows/Edge screenshot baselines. Production smoke tests
remain read-only unless a dedicated QA account and explicit mutation scope are used.
