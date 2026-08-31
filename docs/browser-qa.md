# Browser QA loop

JIEN's repeatable browser suite uses the exported Expo web app, the production web
SQLite driver, and Microsoft Edge. It is deliberately isolated from live accounts and
storage.

## Commands

- `pnpm e2e:web` builds the isolated app and runs browser behavior plus visual checks.
- `pnpm e2e:build` rebuilds only the isolated web bundle.
- `pnpm exec playwright test` reruns the suite against an existing isolated build.
- `pnpm e2e:web:update` intentionally updates visual baselines after review.

The committed Playwright configuration uses the installed Edge channel, one worker,
and a 390-by-844 default viewport. Failure screenshots and traces go to
`.playwright-results/`, which is ignored by Git.

## Data boundary

The isolated bundle is compiled with `https://jien-e2e.supabase.co`. Playwright
intercepts that origin and supplies an in-memory cloud response plus a fake account.
The app still runs its real migrations and uses the real `IDBBatchAtomicVFS` database
under the local test-server origin. Every Playwright test receives a fresh browser
context, so its local database disappears with that context.

Do not point the automated mutation flow at Vercel or reuse production authentication
state. Production checks should be limited to startup, navigation, headers, and other
read-only observations unless a dedicated QA account is available.

## Acceptance loop

1. Run focused source and repository tests while implementing.
2. Run `pnpm e2e:web` and inspect any trace before changing the expectation.
3. Review visual baselines at 390px light mode and 1280px dark mode.
4. Run the full Node suite, typecheck, and `pnpm web:build`.
5. After deployment, run a read-only startup and navigation smoke test on Vercel.

The browser flow currently covers onboarding, one completed workout, set review, a
manual meal, history, Settings, reload persistence, and newer-tab SQLite handoff.
