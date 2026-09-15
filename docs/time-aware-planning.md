# Alpha 2.4C — time-aware planning

## User loop

Open a full routine → choose available time → inspect the estimate → optionally
edit, shorten or reorder → save a flexible plan → start and record actual sets.
One-off plans have the same time controls as repeating splits. Selecting a time
band does not silently remove exercises or change targets. Plans over budget remain
saveable. No future date or reminder is required.

The shorter option keeps the largest prefix that fits the estimate and lists the
exercises it would remove. It respects current order, not a new importance ranking.
It never reduces rest, load or reps. If even the first exercise cannot fit, no
shortening action is offered. Undo restores the prior list until a subsequent
exercise edit; it cannot overwrite later exercise changes. Planned coverage updates
from the selected list, without altering chosen weekly targets or completed work.

## Estimate contract

- Total = warm-up allowance + sets × seconds per set + rest between sets within
  each exercise + between-exercise allowance for each transition.
- No rest is added after an exercise's final set; the next transition includes
  recovery, moving and setup. No transition follows the last exercise.
- Editable starting assumptions: 5-minute warm-up, 45 seconds per set, 120 seconds
  between sets and 120 seconds between exercises. These are product placeholders,
  not evidence of individual pace or recommended rest durations.
- Warm-up time includes preparation and warm-up sets. Per-set duration includes
  both sides for unilateral exercises. Equipment queues and interruptions can add
  time. Empty plans estimate zero, not a warm-up-only session.
- Available time remains 30/45/60/90 minutes. Field ranges are input bounds, not
  training-dose guidance. Invalid or blank fields prevent save; zero rest/warm-up
  is accepted as an explicit user value. Total minutes round up after summing.
- Add/remove planned sets updates time and coverage. Added targets have no load,
  reps, RPE or failure evidence. Editing counts holds increase cues through saved
  plan reopening and joint-choice recalculation. It does not rewrite history.

## Storage and compatibility

Optional versioned `timeBudget` and exercise `setCountEdited` fields live inside
existing `plan_json`. The repository validates before the transaction; local plan
and outbox commit together. Save/edit, reschedule, export and plan parsing retain
settings. Existing plans without settings are readable and receive editable defaults
only in the planner. No new SQL migration, cloud table, RLS policy or API is added.
Keep clients current: old clients may discard unknown optional fields when editing.

Saved plans retain estimates after reload. Unsaved planner edits are not auto-saved
by this slice; saving remains explicit. Starting a saved plan uses the existing
active-workout draft recovery. Estimates do not drive the timer, mark sets completed
or become measured session duration. Custom time settings are per saved plan, not
global preferences or automatic settings for the next programme session.

## Verification and release

Local verification on 15 September 2026:

- Standard test command: 354 passed, zero failures (39 pretests and 315 main tests).
  Covers estimate arithmetic, exact/impossible fits, invalid settings, legacy plan
  compatibility, cue holds after count edits and actual SQLite save/read/outbox/
  reschedule/export/rollback paths.
- Typecheck and `git diff --check`: passed.
- Production web export: passed, 28 routes, using isolated QA public configuration.
- Full browser suite: 28 passed, 11 intentional project-specific skips, zero
  failures. Existing daily logging, planning, weekly targets and storage-handoff
  journeys remain green; no visual baselines needed replacement.
- New browser journey passed on desktop Edge, Android-sized Chromium and
  iPhone-sized WebKit, including save/reload/edit, shorter-plan undo, adding/removing
  planned sets, unchanged performed state on start and active-workout recovery.
- Light/dark screenshots inspected. Keyboard activation, 44-point controls and
  150% browser text enlargement at 360/1280 px were checked. This is not native
  Dynamic Type certification.

Browser QA uses isolated account fixtures, never personal production logs. Physical phones, real
account sync/restore and calibration against actual gym sessions remain release
checks. Existing large-font bottom-navigation crowding also remains a separate
accessibility issue. No commit, deployment or live database change is made here.

## Changed files

- Model/validation: `src/lib/planning/session-time.ts`, `workout-plan.ts`,
  `routine-starters.ts`, `src/lib/db/types.ts`, `src/lib/db/workouts.ts`.
- UI: `src/components/workout-time-estimate.tsx`, `src/app/workouts/plan.tsx`,
  `src/app/workouts/[id].tsx`.
- Tests: `src/lib/planning/workout-plan.test.ts`, `routine-starters.test.ts`,
  `src/lib/db/main-thread-memory-database.test.ts`,
  `scripts/roadmap-ui-integration.test.mjs`, `e2e/session-time.spec.ts`,
  `e2e/startup-and-daily-flow.spec.ts`.
- Documentation: this note, `docs/schema.md`, `docs/roadmap.md`.
