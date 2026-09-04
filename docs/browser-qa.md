# Browser QA loop

JIEN's repeatable browser suite uses the exported Expo web app across Microsoft Edge,
Android Chromium emulation, and iPhone WebKit. It exercises the storage path selected
for each browser while remaining isolated from live accounts and storage.

## Commands

- `pnpm e2e:web` builds the isolated app and runs browser behavior plus visual checks.
- `pnpm e2e:build` rebuilds only the isolated web bundle.
- `pnpm exec playwright test` reruns the suite against an existing isolated build.
- `pnpm e2e:web:update` intentionally updates visual baselines after review.

The committed Playwright configuration uses one worker. Edge supplies the reviewed
visual baselines, while Pixel 7 Chromium and iPhone WebKit exercise the mobile layouts,
touch targets, and browser-specific persistence paths. Failure screenshots and traces
go to `.playwright-results/`, which is ignored by Git.

## Data boundary

The isolated bundle is compiled with `https://jien-e2e.supabase.co`. Playwright
intercepts that origin and supplies an in-memory cloud response plus a fake account.
The app still runs its real migrations and uses its selected production storage
driver under the local test-server origin. Edge and Android Chromium use
`IDBBatchAtomicVFS` v2. iPhone WebKit uses the account-scoped `MemoryVFS` database with
immutable IndexedDB snapshots. Every Playwright test receives a fresh browser context,
so its local data disappears with that context.

Do not point the automated mutation flow at Vercel or reuse production authentication
state. Production checks should be limited to startup, navigation, headers, and other
read-only observations unless a dedicated QA account is available.

## Acceptance loop

1. Run focused source and repository tests while implementing.
2. Run `pnpm e2e:web` and inspect any trace before changing the expectation.
3. Review the Edge visual baselines at 390px light mode and 1280px dark mode; confirm
   the behavior suite passes in all three browser projects.
4. Run the full Node suite, typecheck, and `pnpm web:build`.
5. After deployment, run a read-only startup and navigation smoke test on Vercel.

The browser flow covers onboarding, equipment-aware routine drafts, one completed
workout, target-versus-performed set review, set-kind and rest controls, interrupted
workout-draft recovery, a manual meal, history, persisted sync health and manual sync,
the empty app-recovery history in Settings, reload persistence, newer-tab SQLite handoff, mobile overflow and
touch-target checks, and unhandled page errors across the supported browser projects.
