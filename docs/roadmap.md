# JIEN rollout roadmap

JIEN remains a lifting-first, local-first training and nutrition product. Milestones
close one complete user loop at a time; new activity types do not enter the product
until their measurements and progression rules are explicit.

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

### Alpha 2.4A — next-session recommendation (local implementation)

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

### Alpha 2.4B — chosen training targets (local implementation)

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

Next: replace rough exercise-count time limits with editable set/rest/transition
estimates, then test adherence, missed sessions and plateaus across multiple workouts.

Explicit follow-ups, not claims of completion:

- Separate set role (working/warm-up/drop) from failure/effort, with linked drop
  sequences and a compatible local/cloud migration. Today's single kind cannot
  represent a drop set taken to failure independently. Current drop row credits
  are descriptive, not a scientifically calibrated straight-set equivalent.
- The four-week coverage baseline describes habit, not adequate training for a
  goal. Preserve the recent 2–3 matching-session baseline; never compare loads
  across exercises as interchangeable muscle progress.
- Replace the rough exercise-count time fit with set/rest/transition estimates;
  validate against actual sessions. The 48-hour cue remains a heuristic, not a
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
  or Ease off choice. Each choice opens an editable, unscheduled local plan; the
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
