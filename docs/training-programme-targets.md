# Alpha 2.4B — chosen training targets

## What ships in this slice

- Training → Set training targets: intention (muscle/strength/both), 1–7 sessions
  per week, 1–6 priority muscles, and user-entered weekly set-credit targets.
- No prescribed set count is prefilled. The 0.5–40 half-credit input range is a UI
  bound, not a claim about optimal or safe volume. Other muscles remain in history.
- Training shows target, completed credits and the average across up to four prior
  completed calendar weeks with recent logging history. No prior reference is shown
  as unknown, not proof that zero work occurred. Current partial weeks are excluded
  from that average. Goal labels record intention; they do not change weights/reps.
- Counts use the workout's recorded local day (Monday–Sunday), not its later save
  timestamp. Only completed, nondeleted workouts/sets contribute. Primary=1,
  unique supporting family=0.5, including zero-external-load bodyweight work.
  Working/failure/drop count; warm-ups and unfinished plans/drafts do not.
- A priority with remaining work and no recorded training in the past 48 hours can
  rank routine options using saved equipment. The cue is not a recovery diagnosis.
  If configured priorities are met/recent, habitual gaps do not override them.
  Browsing any routine and flexible logging remain available.
- Choosing a draft does not log it or change the weekly target. Numeric cues still
  use the same exercise's history and existing effort/joint rules. There is no
  automatic 5% increase, catch-up work, goal-specific prescription or AI call.

## Storage and release order

Local migration 16 adds nullable JSON on `user_profile`. Preferences and the full
profile outbox payload change atomically; other profile/consent writes retain them.
Removing preferences sends explicit null. Cloud restore uses the existing logical
clock guard. Whole-profile last-write-wins can still replace a different field
edited on another device; field-level conflict merging is not implemented here.
Unknown future programme versions stay raw through unrelated writes/exports but
are not interpreted by this client. Account reset/deletion uses existing ownership.

1. In the Supabase **Postgres SQL Editor** (not Logs Explorer), run the entire file
   `supabase/migrations/20260914000100_training_programme.sql`. It is additive and
   rerunnable. No data backfill, storage clearing, or authentication reset is needed.
2. Verify the column exists:

   ```sql
   select column_name, data_type
   from information_schema.columns
   where table_schema = 'public' and table_name = 'users'
     and column_name = 'training_programme';
   ```

   Expected: one `training_programme / jsonb` row. Leave existing user values null
   until a user explicitly saves their choices.
3. Deploy the client only after that migration. Older clients omit the new column,
   but this client explicitly reads/writes it. Missing migration will break profile
   sync; local-only test success is not evidence that remote schema is ready.
4. Validate save, restore on a second device, clear, and existing workouts on the
   identified production release. Do not use personal production logs as fixtures.

The migration has been prepared, not applied. This increment is not committed or
deployed by the assistant. No production records have been modified.

## QA

Coverage is included in the standard test command: strict programme parsing,
calendar boundaries, accounting, actual SQLite migration/repository/outbox/restore,
export inclusion, profile and consent preservation, older-remote rejection, explicit
clear and transactional rollback when enqueue fails. Web durability errors retain
the existing committed-but-not-durable semantics; they are not falsely labelled as
transaction rollback.

The isolated browser journey covers validation, save/reload, priority-based routine
draft/save without credit, completed failure/drop/warm-up accounting, recent-work
filtering, edit, confirmed removal, plan preservation, themes and overflow. Its
Supabase responses are QA fixtures, not real production sync.

Final local verification (15 September 2026):

- Standard test command: 351 passed, zero failures (39 pretests and 312 main tests).
- Typecheck: passed.
- Production web export using isolated E2E public configuration: passed, 28 routes.
- Focused programme browser checks: 4 passed, 2 intentionally skipped.
- Full browser suite: 24 passed, 9 intentionally skipped, zero failures across
  desktop Edge, Android-sized Chromium and iPhone-sized WebKit. Skips assign
  responsive/desktop-only checks to their intended project; they are not failures
  hidden by retries. These are desktop engines, not physical phone certification.
- Reviewed updated visual references and light/dark programme screenshots.
- `git diff --check`: passed.

The remote migration and production deployment have not been run. Real-account
cross-device reconciliation and physical-device checks remain release gates.

QA refinements in this slice: the shared transaction wrapper now preserves callback
results with Expo native's void-returning transaction API. Chips reserve their
two-pixel focus border to avoid reflow during a tap in a wrapping list. The test
Supabase service now permits `accept-profile` and `content-profile`, matching the
headers sent by the client; production CORS settings were not changed. The browser
suite keeps its zero-page-error assertion instead of suppressing CORS diagnostics.
The reload checks wait for actual mocked sync requests to settle. A document's
earlier `networkidle` event does not cover later background requests; reloading
during those requests produced a misleading WebKit access-control error in QA.

## Changed files

- UI/navigation: `src/app/_layout.tsx`, `src/app/(tabs)/train.tsx`,
  `src/app/workouts/plan.tsx`, new `src/app/workouts/programme.tsx`,
  new `src/components/training-programme-card.tsx`, `src/components/ui.tsx`.
- Deterministic model: new `src/lib/planning/training-programme.ts`.
- Persistence: new `src/lib/db/training-programme.ts`, plus `types.ts`, `index.ts`,
  `migrate.ts`, `profile.ts`, `wellness.ts`, `cloud-sync.ts`,
  `exclusive-transaction.ts` and `export.ts` in `src/lib/db/`;
  `src/lib/export/complete-json.ts`.
- Cloud schema: new `supabase/migrations/20260914000100_training_programme.sql`.
- Tests: `src/lib/planning/routine-starters.test.ts`,
  `src/lib/db/main-thread-memory-database.test.ts`,
  `src/lib/export/complete-json.test.ts`, new `e2e/training-programme.spec.ts`,
  `e2e/helpers.ts`.
- Reviewed visual references: the three Training/Settings PNG baselines in
  `e2e/startup-and-daily-flow.spec.ts-snapshots/` were refreshed for the stable chip
  border geometry, with the daily workflow also rerun.
- Documentation: `docs/roadmap.md`, `docs/schema.md`, and this release note.

## Follow-ups

Set/rest/transition time budgets, longitudinal adherence/plateau decisions and
structured joint scope remain Alpha 2.4 work. Programmes do not yet prescribe
goal-specific training doses. Physical iOS/Android and real-account cross-device
reconciliation remain release gates beyond desktop browser emulation.
Forced 150% browser text enlargement keeps the target editor usable at 360 and
1280 px, but the existing global bottom-navigation labels crowd at 360 px. Native
Dynamic Type and large-font navigation still need device-level accessibility review.
