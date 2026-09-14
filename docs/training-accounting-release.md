# Alpha 2.3A — training accounting

## Behaviour contract

| Completed row | Training work / muscle credits | Matching exercise baseline | Increase cue |
| --- | --- | --- | --- |
| Working | Included | Included | Eligible under existing rep/effort/joint checks |
| Failure | Included, no bonus multiplier | Included | Hold; completed reps still count |
| Drop | Included | Excluded | No straight-set cue |
| Warm-up | Excluded | Excluded | None |

Unperformed draft targets count nowhere. Saved rows retain their actual kind, RPE,
load, reps and muscle snapshots. Repeat creates fresh unperformed targets; it does
not prescribe failure or copy effort. `plan_json` may retain `sourceKind: 'failure'`
alongside original RPE to rebuild conservative cues after editing a plan. No SQL
migration or history rewrite is required. Older clients ignore this optional field;
avoid editing these new plans with old clients because they may discard the evidence.

Legacy internal names such as `workingSetCount` and `totalWorkingSets` remain for
compatibility; they now mean the included training rows above. User-facing Calendar
copy says training sets. Total row counts in workout history still include warm-ups,
while training work excludes them; progression details explicitly describe main
(working and failure) sets. Drops remain visible in complete workout history.

## Why this policy

Failure is evidence of effort, not proof that performance improved. The failure
versus non-failure [meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC9068575/)
does not support treating failure as a universal growth or strength bonus.
The [drop-set review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10390395/)
supports recognizing drop-set training as real training, but does not establish
that each recorded reduction equals one independent straight set. Inclusion,
the conservative failure hold, and provisional row credits are explicit product
conventions, not physiological measurements or a personalized medical rule.

## Release checklist

- Run focused policy/planning/draft/context tests and real SQLite integration.
- Run the full test command (including pretest), typecheck, production web export,
  and the isolated browser save/repeat regression. Record results below.
- Deploy the web app and redeploy `wellness-chat` together: its shared training
  context and recent-work summary changed. No secret or database change is needed.
- Validate the identified production release on physical iOS/Safari and Android,
  including background/reopen and offline save/restore. Browser emulation alone
  does not close that gate. This work does not alter or clear user records.

## Verification

Local verification, September 2026:

- Focused progression, planning, draft, Edge context and real SQLite checks: 51 passed.
- Full `pnpm test`: 341 passed (39 pretest + 302 main tests), none failed/skipped.
- `pnpm typecheck`: passed after the final code changes.
- Production `pnpm web:build`: passed, 27 routes, with the isolated QA public
  Supabase URL/key. The first attempt without configuration correctly failed;
  this checkout has no production environment settings. This validates compilation
  and export, not production credentials, cloud connectivity, or deployment.
- Focused Playwright run: 5 passed, 4 intentionally skipped. The new mixed-kind
  save/reload/repeat/plan/start journey passed in Edge, Android-sized Chromium and
  iPhone-sized WebKit. Existing active-draft recovery and post-session plan tests
  passed on their designated desktop project. The first new-test run refreshed
  before save navigation finished; corrected it to wait for the saved-plan screen.
  No full browser-suite or physical-phone pass is claimed.
- No commit, push, deployment, database migration, or production-data mutation.
  Redeploy web and `wellness-chat`, then complete the physical-device/cloud gates.

## Changed areas

- Policy and calculations: `supabase/functions/_shared/training-set-policy.ts`,
  `src/lib/progression/index.ts`, `src/lib/workout-draft.ts`.
- Repositories and plan contract: `src/lib/db/{workouts,dashboard,calendar,wellness,types}.ts`,
  `src/lib/planning/workout-plan.ts`.
- Screens: `src/app/(tabs)/today.tsx`, `src/app/exercises/[id].tsx`,
  `src/app/workouts/{new,plan,[id]}.tsx`.
- AI context: `supabase/functions/_shared/training-context.ts`,
  `supabase/functions/wellness-chat/index.ts`.
- Regression coverage: `src/lib/progression/progression.test.ts`,
  `src/lib/planning/workout-plan.test.ts`, `src/lib/workout-draft.test.ts`,
  `src/lib/db/main-thread-memory-database.test.ts`, `e2e/startup-and-daily-flow.spec.ts`.
- Product/engineering contract: `docs/{roadmap,progression,training-advisory-engine,schema}.md`,
  this release note, and `.codex/skills/progression-algorithm/SKILL.md`.
