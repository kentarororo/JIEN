# JIEN rollout roadmap

JIEN remains a lifting-first, local-first training and nutrition product. Milestones
close one complete user loop at a time; new activity types do not enter the product
until their measurements and progression rules are explicit.

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

## Current milestone — Alpha 2.3 production hardening

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
  or Ease off choice. Each choice opens an editable, unscheduled local plan; the
  stored snapshot explains the choice, deterministic cues remain separate from
  targets, and completed history is immutable. Ease off removes one working set
  where possible instead of inventing a recovery percentage or automatic deload.
- Physical iPhone and Android validation in addition to browser emulation.
- Production authentication, offline/online reconciliation, and multi-device restore.
  Device-local sync health now records the last attempt and last successful restore
  without exporting provider details or health records.
- Privacy-safe app recovery history now stores only stable codes, timestamps, and a
  count on the device, with an explicit Settings control to clear that history.
  Full-data export is available before a typed-confirmation account deletion. The
  authenticated deletion function removes the Vault credential and Auth owner so
  all account rows cascade, then the client atomically clears device data. Remote
  error monitoring and release operations remain.
- Closed-beta instrumentation focused on failed saves, sync health, logging time, and
  advisory usefulness rather than engagement pressure.

## Later backlog

- Timed holds and loaded carries only after duration and distance set types exist.
- Olympic lifting or athletic-power modes only with technique and power measurements.
- Additional nutrition and wellness integrations after the core training loop is
  validated with beta users.
