# Quick-entry refinement

## User-facing changes

- Training and calendar plan cards open the editable set logger directly. A separate
  Review plan action retains scheduling, plan edits, skip and deletion controls.
- Start workout now saves the current plan as flexible and starts it today. It
  intentionally replaces any selected future schedule; Save/Update workout plan
  remains available to keep that schedule. Opening an existing scheduled plan from
  a card does not rewrite the schedule until the user completes the workout.
- Progress, Repeat and Ease off can start directly from a completed workout.
  Reused values start uncompleted with blank RPE. Repeat/ease-off keep increase
  cues off; ease-off removes one main set per exercise where possible. Drafts for
  different choices have distinct local recovery keys. Original history is unchanged.
- Planned/repeated workouts show set inputs first; session name, unit, optional
  rest timer and RPE help sit under Workout options. Exercise selection is under
  Change exercise. An already running rest timer stays visible.
- Narrow set suggestions stack their action below the copy so enlarged text is not
  squeezed beside a button. Day-panel navigation releases the modal's focus trap
  before opening an editable screen, including the direct plan and meal routes.
- Food search, barcode and photo controls appear first. Manual entry has a direct
  action. Meal name and type are optional details; existing search, serving review,
  photo consent, manual macros, private foods and save behavior are unchanged.

## Live target contract

`live-set-target.ts` recomputes per editable main-set row whenever input changes.
It only uses loaded same-exercise history in the selected unit. The existing
deterministic rep/load progression rules supply increase cues; this is not a new
"optimal" prescription model or a mandatory 5% increase. The recent 2–3-session
volume summary and completed-session feedback remain separate.

- A historical cue is offered only at its compatible load. Arbitrary weight
  changes cannot be translated to equivalent reps by multiplying volume.
- When there is no compatible historical target, a prior entered working set can
  supply a clearly labelled repeat shortcut. It does not establish a baseline or
  qualify the user for an increase.
- Completed rows, warm-ups, drops and failure rows do not receive editable targets.
  Current failure, high or invalid RPE and an active joint hold pause shortcuts.
  Repeat/ease-off plans and manually changed plan counts cannot regain increase cues.
- Use target copies only load/reps, clears effort and leaves completion false.
  Typed extra reps at the same load are not replaced with a lower target. Editing
  completed history never offers new-session targets.
- Missing/failed history does not fabricate a numeric progression target. Input
  remains editable, and the existing retry path is preserved.

## Storage and release

Existing SQLite records, draft persistence and sync remain in use. Only direct
next-workout draft keys gain a choice suffix; existing plain-repeat and plan draft
keys stay compatible. No schema, SQL migration, external provider or permission
change is required. No personal production records are used for QA.

Browser checks use the production web export with isolated QA configuration and
fixtures. They do not certify physical iPhone/Android use, production credentials
or real cross-device sync. Camera hardware/provider behavior is unchanged and is
not newly certified by these UI tests. Existing large-text bottom-navigation
crowding remains a separate accessibility follow-up.

No commit, deployment or live database change is made by this implementation.

## Changed files

- Entry screens: `src/app/(tabs)/train.tsx`, `src/app/(tabs)/today.tsx`,
  `src/app/workouts/plan.tsx`, `src/app/workouts/new.tsx`,
  `src/app/workouts/[id].tsx`, `src/app/meals/new.tsx`.
- Logic: `src/lib/progression/live-set-target.ts`, `src/lib/workout-draft.ts`.
- Regression coverage: `src/lib/progression/progression.test.ts`,
  `src/lib/workout-draft.test.ts`, `src/lib/planning/workout-plan-contract.test.ts`,
  `scripts/roadmap-ui-integration.test.mjs`, `e2e/quick-entry.spec.ts`,
  `e2e/startup-and-daily-flow.spec.ts`.
- Documentation: this note and `docs/roadmap.md`.
