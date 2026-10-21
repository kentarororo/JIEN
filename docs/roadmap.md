# JIEN rollout roadmap

JIEN remains a lifting-first, local-first training and nutrition product. Milestones
close one complete user loop at a time; new activity types do not enter the product
until their measurements and progression rules are explicit.

## Status at a glance — 18 October 2026

Every milestone carries exactly one status. Move it up only when the evidence exists.

- **Built:** merged to `main` and tests pass; may still need a backend deploy step.
- **Live on web:** on the Vercel production app.
- **Phone-tested:** checked on a real iPhone and a real Android phone.
- **Beta-ready:** meets the closed-beta gate below.

| Milestone | Status | Still to do |
| --- | --- | --- |
| Alpha 2.0 — foundation | Live on web | Phone testing |
| Alpha 2.1 — quality and catalogue | Live on web | Phone testing |
| Alpha 2.2 — advisory-to-plan | Live on web | Phone testing |
| Alpha 2.3 — logging integrity, programme continuity, session choice | Live on web | Phone testing; production auth and multi-device restore |
| Alpha 2.3A — trustworthy training accounting | Live on web | Phone testing |
| Alpha 2.4A — next-session recommendation | Live on web | Phone testing |
| Alpha 2.4B — chosen training targets | Live on web | Phone testing |
| Alpha 2.4C — time-aware plans | Live on web | Calibrate estimates against measured sessions |
| Quick-entry refinement | Live on web | Phone testing |
| Cardio logging and photo reliability | Live on web | Phone testing |
| Day-first food logging | Live on web | Phone testing |
| Private food library (part of Alpha 2.5) | Built | Confirm `20261008000100_private_foods.sql` is applied and run the two-account access check |
| Food-photo trust (part of Alpha 2.5) | Built | Confirm the Edge Function deploy; run the measured-photo benchmark |
| Alpha 2.4 — missed sessions, return after a break | Not started | #5 |
| Alpha 2.4 — plateau review and adherence | Not started | #6 |
| Alpha 2.5 — partial/complete day state, recipes, food management | Not started | Not yet scoped |
| Closed beta | Not started | Phone testing, production sync/restore, beta instrumentation |

Nothing is Phone-tested yet, so nothing is Beta-ready.

### Next up

1. #4 — keep Vercel as the only web host
2. #3 — run the browser tests automatically
3. #5 — missed sessions and coming back after a break
4. #6 — plateau review and adherence (after #5)

## October follow-up: food-photo trust

The next Alpha 2.5 quality gate is grounded, editable photo nutrition—not an
uncalibrated confidence score. The first local slice adds a runtime analysis rubric,
conservative USDA matching, portion/ingredient assumptions and recovery-safe review.
See [food-photo-quality.md](food-photo-quality.md) for the MacroFactor comparison,
half-sandwich failure case, implementation limits and measured-photo release gate.
Status: Built. Not yet confirmed as deployed, or benchmarked as an accuracy improvement.

## October follow-up: day-first food logging

Food is a daily dashboard with calorie/macro totals and one
list of individual foods, including items from existing multi-food meals. Quick add
uses saved/common foods with a portion preview; search, manual entry, barcode and
photo review remain available through Add food. Saving returns to the selected day.
Meal naming and categories are optional, not a logging prerequisite.

Each item's portion can be scaled or the item removed without rewriting siblings.
Writes and sync operations are atomic; the last removed item also tombstones its
empty parent. Existing meal records, photos, provenance and detailed edit/repeat
routes remain available. No schema migration or destructive history conversion is
needed. Today opens the daily log and counts food items rather than meals.

Unclassified day entries are not meal occasions: they do not establish meal-gap
patterns and suppress meal-count reminders for that day. This does **not** infer
that a nutrition day is complete; explicit partial/complete day state remains an
Alpha 2.5 deliverable.

Release gates: commit/deployment, physical-device checks and real-account
multi-device sync. Local QA covers SQLite/outbox rollback and browser journeys for
prior-day multi-item logging, offline portion edits, removal, reload, quick add and
photo recovery, with no production records or paid AI requests used.

Validation (14 October 2026): `pnpm test` passed 386 test executions including
pretest; `pnpm typecheck` passed; `pnpm e2e:build` produced the production-mode web
export with isolated test configuration. Fifteen focused browser checks passed
across desktop Chromium, Android-sized Chromium and iOS WebKit. Light/dark and
320px portion-edit layouts were inspected. The generated `dist` is a test build,
not a production deployment artifact; deployment must rebuild with production env.

## Product promise and delivery order — September 2026 checkpoint

**Log quickly. Know what to train next and why. Keep control of your records.**
The next milestones deepen this original lifting-first promise; they do not turn
JIEN into a generic activity tracker, social feed, or autonomous AI trainer.
Nutrition supports training through useful records and honest context, not a claim
that incomplete logs measure energy balance. Flexible, unscheduled starts stay first-class.

The priority is a complete training week, not more disconnected features:

| Order | Deliverable | Acceptance gate |
| --- | --- | --- |
| 1 · Alpha 2.3A | Trustworthy training accounting | Working/failure/drop work agrees across logger, saved workout, Today, Calendar, Wellness, and AI context. Warm-ups excluded. Failure holds increases without erasing work. Repeat/plan/recovery preserve actual versus suggested values. |
| 2 · Alpha 2.4 | Goal-aware programme and explained next-session recommendation | Separate **usual history**, **chosen programme**, and **completed work**. Ask goal, priority muscles, days, equipment, and available time. Recommend Progress/Repeat/Ease off with reasons, uncertainty and editable user choice; use fresh effort, adherence, and relevant joint feedback. Test beginners, missing RPE, plateaus, swaps, missed sessions and return after a break. |
| 3 · Alpha 2.5 | Nutrition people can reuse and trust | Explicit partial/complete day state survives sync; missing days are unknown, not zero intake. Sync private custom foods/recipes and reuse frequent meals. Preserve source, portion, regional/Asian food uncertainty and user corrections. No public pooling of personal food logs without separate consent/moderation. |
| 4 · Closed beta | Dependable daily use, measured | Physical iPhone/Safari and Android, background interruption, offline relaunch, multi-tab handoff, real-account sync/restore and conflicts pass on the identified release. Measure save/recovery failures, time to log and usefulness of advice, with privacy-safe opt-in data. |

### Alpha 2.3A implementation status

Implemented locally in this slice: one shared set-accounting policy for the local
engine, SQLite summaries and Edge context; legacy failure/drop records immediately
contribute without rewriting history. Failure is retained in matching baselines,
holds increase cues, and resets when repeated as a fresh target. Plan JSON retains
optional historical failure evidence without inventing RPE. Regression checks must
exercise the actual SQLite repositories and save/repeat browser journey, not just
isolated arithmetic. See [training-accounting-release.md](training-accounting-release.md)
for verification and release status. Implemented is not the same as deployed or
physically validated.

### Alpha 2.4A — next-session recommendation

Completed-workout review now suggests Progress, Repeat, or Ease off with a factual
reason. Optional fresh feedback can request a lighter plan. The suggestion is not
preselected: accepting it or choosing another approach remains explicit. Changing
feedback never changes an already selected approach. Existing set/effort/joint
checks still govern numeric cues, and plans remain editable and unscheduled by default.
Feedback is transient to this review; only the chosen approach is saved with the
plan. It never becomes a recorded RPE, recovery score, or persistent medical status.
See [next-session-recommendation.md](next-session-recommendation.md) for rules and QA.

This completes the recommendation interaction, not all of Alpha 2.4. The target
setup below is the next increment; real time budgets, longitudinal adherence/plateau
decisions and structured relevant-joint feedback remain programme deliverables.

### Alpha 2.4B — chosen training targets

Training now offers a saved intention, flexible weekly session count and up to six
priority muscles with user-entered set-credit targets. The summary separates chosen
targets, completed work and the recent full-week average. Routine ranking uses the
remaining chosen targets and saved equipment; it does not infer adequate training
from habitual history. Completed failure/drop work counts, planned/draft work does
not, and edited exercise tags do not rewrite recorded muscle snapshots. Goal labels
are saved context, not automatic goal-specific prescriptions. The existing same-lift
progression, explicit approach choice and joint/effort holds are unchanged.

Targets can be edited or removed without changing workouts or saved session plans.
They use the existing private profile sync/outbox and complete export. This slice
requires an additive cloud migration before deployment; it is not a production or
physical-device validation claim. See [training-programme-targets.md](training-programme-targets.md).

### Alpha 2.4C — time-aware plans

Routine starters now open in full. A duration estimate uses planned set count,
editable lifting/rest/between-exercise assumptions and a warm-up allowance. Available
time works for one-off and repeating plans. Over-budget plans can still be saved;
an explicit shorter option previews removal from the end of the current order,
with undo before further exercise edits. It never shortens rest or changes loads to
force a fit. Added sets start blank, and edited counts cannot become a new completed
progression baseline. Settings persist with the saved plan without a new SQL migration.
These estimates are not yet calibrated against measured sessions.
See [time-aware-planning.md](time-aware-planning.md) for scope and verification.

### Quick-entry refinement

Saved plans open directly in the editable set logger from Training and the day
calendar; a separate review action keeps scheduling and plan management available.
The planner offers Start workout now, and completed-session choices can start a
fresh workout without an intermediate planner. Meal entry starts with food search,
barcode, photo or manual entry; naming and meal type are optional details.

Per-row targets refresh with entered values and current effort. Same-exercise
history provides progression cues; without history, a first entered working set
can be reused without claiming an increase. Targets remain opt-in and uncompleted.
Repeat/ease-off choices, edited plan counts, joint holds and failure/high effort
retain their safeguards. This refines execution, not the longitudinal advisory
engine. See [quick-entry.md](quick-entry.md) for scope and release checks.

Next: longitudinal adherence, missed sessions, return after a break and plateau
review across multiple workouts; then structured relevant-joint and effort feedback.

### Supporting slice — cardio logging and photo reliability

October 8 refinement: Log cardio joins Log workout in the main Training actions,
outside the Overview/History switch. The private food library now has a local-first
account-sync implementation, optional brand/barcode, local barcode lookup and legacy
shortcut migration. Explicit community sharing exposes product details to all
signed-in accounts, while meal history remains private. Shared foods are unverified
and can be withdrawn; server-only moderation can hide entries. Apply
`20261008000100_private_foods.sql` and verify two-account RLS/RPC access before deployment.
See [private-food-library.md](private-food-library.md). This advances Alpha 2.5;
it does not complete recipes, food management or reviewed community submissions.

User-requested manual cardio logging is implemented locally: activity and minutes,
optional distance/effort, calendar review, edit/remove, offline storage and existing
private sync/export. Duration stays separate from lifting credits and nutrition;
recent same-activity history is descriptive, not an automatic progression target.
Live timers, GPS, heart-rate zones and cardio prescriptions are outside this slice.

Production Gemini photo failure was reproduced with one approved synthetic image.
Provider output validation and safe diagnostics are improved locally; the upstream
rejection is not yet explained or certified fixed. Deploy/retest is a separate gate,
not something a mocked browser success proves. See
[cardio-and-photo-release.md](cardio-and-photo-release.md).

Explicit follow-ups, not claims of completion:

- Separate set role (working/warm-up/drop) from failure/effort, with linked drop
  sequences and a compatible local/cloud migration. Today's single kind cannot
  represent a drop set taken to failure independently. Current drop row credits
  are descriptive, not a scientifically calibrated straight-set equivalent.
- The four-week coverage baseline describes habit, not adequate training for a
  goal. Preserve the recent 2–3 matching-session baseline; never compare loads
  across exercises as interchangeable muscle progress.
- Calibrate the editable set/rest/transition estimates against actual sessions.
  The 48-hour cue remains a heuristic, not a
  recovery diagnosis. Ease off currently removes one main set, not a personalized
  deload. Missing effort must remain visible; it cannot establish readiness.
- A 5% work comparison is context, not a mandatory weekly/session increase.
  Explainable progression may repeat or reduce work. AI explains deterministic
  decisions; it never supplies numeric training prescriptions.
- Exercise history, records, saved plans and exports must continue working through
  each increment. Add privacy-safe release/error visibility and CI browser gates
  before calling the closed beta ready. Do not use personal production data as QA fixtures.

## Completed foundation — Alpha 2.0

- Offline-first workout, food, wellness, calendar, and profile records.
- Supabase authentication, queued sync, cloud restore, and account ownership checks.
- Deterministic exercise progression, muscle set-credit history, and joint holds.
- Vercel web storage ownership plus native Expo SQLite.
- Direct product voice and the Warm Utility visual system.

## Quality and catalogue — Alpha 2.1

- Today, Training, Food, Wellness, History, and Settings visual rollout.
- Responsive and cross-browser persistence QA.
- Reviewed 132-exercise catalogue with editable primary and assisting targets.
- Multi-term exercise search, muscle/equipment filters, and equipment-aware lifting
  routine starters.

## Completed — Alpha 2.2 advisory-to-plan

The muscle advisory must lead to an explainable, editable workout draft:

1. Rank routine starters from current ready muscle gaps only.
2. Use saved equipment to select exercises.
3. Preserve the 48-hour scheduling cue and joint-progression choice.
4. Reuse loads and reps only from the same exercise's completed history.
5. Preview primary and assisting set credits before the plan is saved.
6. Allow exercise ordering and swaps without changing completed records.
7. Keep every draft local until the user explicitly saves it.

Acceptance requires tested paths from Training focus to a flexible planner draft or
an explicitly scheduled workout, then to a completed workout and refreshed muscle
coverage. No AI output supplies
numeric targets or chooses a workout without an explicit user action.

## Alpha 2.3 foundation — implemented features and outstanding release gates

- Logging integrity and active execution are now part of the production slice:
  repeated or planned rows reuse load and reps as editable targets but never copy
  historical RPE or completed state; performed sets require explicit completion,
  support undo and set-kind tagging, and can run an optional rest timer. Device-local
  SQLite drafts retain those fields across interruption on web and native.
- Programme continuity is explicit rather than autonomous: a user can choose
  Push/Pull/Legs, Upper/Lower, or Full body order, fit a starter to 30–90 available
  minutes, and save it with no set time. Date/time scheduling, reminders, and
  missed-session handling are opt-in. Starting always records the actual start date
  and time without converting a suggestion into observed work.
- Completed workouts now close the feedback loop with an explicit Progress, Repeat,
  or Ease off choice. Each choice can start an editable workout immediately or open
  an unscheduled local plan for later; the
  stored snapshot explains the choice, deterministic cues remain separate from
  targets, and completed history is immutable. Ease off removes one working set
  where possible instead of inventing a recovery percentage or automatic deload.
- **Outstanding release gate:** Physical iPhone and Android validation in addition to browser emulation.
- **Outstanding release gate:** Production authentication, offline/online reconciliation, and multi-device restore.
  Device-local sync health now records the last attempt and last successful restore
  without exporting provider details or health records.
- Privacy-safe app recovery history now stores only stable codes, timestamps, and a
  count on the device, with an explicit Settings control to clear that history.
  Full-data export is available before a typed-confirmation account deletion. The
  authenticated deletion function removes the Vault credential and Auth owner so
  all account rows cascade, then the client atomically clears device data. Remote
  error monitoring and release operations remain.
- **Planned:** Closed-beta instrumentation focused on failed saves, sync health, logging time, and
  advisory usefulness rather than engagement pressure.

## Later backlog

- Timed holds and loaded carries only after duration and distance set types exist.
- Olympic lifting or athletic-power modes only with technique and power measurements.
- Additional nutrition and wellness integrations after the core training loop is
  validated with beta users.
