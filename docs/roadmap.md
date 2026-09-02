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

Acceptance requires a tested path from Training focus to planner draft, scheduled
workout, completed workout, and refreshed muscle coverage. No AI output supplies
numeric targets or chooses a workout without an explicit user action.

## Current milestone — Alpha 2.3 production hardening

- Physical iPhone and Android validation in addition to browser emulation.
- Production authentication, offline/online reconciliation, and multi-device restore.
  Device-local sync health now records the last attempt and last successful restore
  without exporting provider details or health records.
- Error monitoring, privacy review, data export/delete checks, and release operations.
- Closed-beta instrumentation focused on failed saves, sync health, logging time, and
  advisory usefulness rather than engagement pressure.

## Later backlog

- Timed holds and loaded carries only after duration and distance set types exist.
- Olympic lifting or athletic-power modes only with technique and power measurements.
- Additional nutrition and wellness integrations after the core training loop is
  validated with beta users.
