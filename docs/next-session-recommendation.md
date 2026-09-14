# Alpha 2.4A — next-session recommendation

## Scope

A completed workout now explains which next-session approach to consider. It uses
the same offline set and progression rules as the logger. It is not an AI call,
programme adequacy score, recovery diagnosis, or mandatory five-percent increase.
The existing four-week muscle baseline remains a description of habits.

## Decision order

1. No comparable main sets or invalid values/settings: show the missing information,
   with no recommendation to accept. Warm-ups and drop-only records are not main sets.
2. A stored joint/injury consideration: suggest Repeat with a review notice, not
   clearance to train. The planner keeps its existing explicit joint-progression choice.
3. User reports “Harder than expected” or “Returning after a break”: suggest Ease off
   only when at least one exercise has multiple main sets. This previews the existing
   one-set reduction, not a personalized deload. Single-set exercises are retained.
4. Source workout older than 14 days, missing a date, or future-dated: suggest Repeat
   as a reference. Fourteen days is a conservative product freshness threshold, not
   a detraining threshold or evidence that no other training happened.
   Use the actual workout start when available, falling back to its completion time;
   saving a retrospectively entered workout today must not refresh its training date.
5. Failure or RPE above 9: suggest Repeat. Work still counts; there is no failure bonus.
6. Missing/invalid main-set RPE: suggest Repeat. “As expected” never fabricates set RPE.
7. Every exercise has an eligible deterministic cue: suggest Progress. Otherwise
   suggest Repeat. Numeric targets still come only from the per-exercise engine.

## User control and storage

Nothing is preselected or saved automatically. “Use … recommendation” selects the
existing approach; “Build next workout plan” opens its editable draft. People can
choose a different approach, and changing feedback never replaces their choice.
Progress means preview eligible cues, not override failure or joint safeguards.

Fresh check-in feedback is component-local and resets on leaving the review. It is
not put in URLs, analytics, RPE, the cloud, or completed history. Only the existing
chosen `sessionApproach` and resulting targets are saved through the normal SQLite
transaction/outbox. The recommendation rationale is transient, not a saved audit trail.
No schema migration is required. Persisting dated feedback/recommendation provenance
is a later, explicit model change rather than silently reusing wellness records.

## Remaining Alpha 2.4 work

Goal and priority-muscle programme targets; set/rest-based time estimates; adherence,
missed-session and plateau handling across multiple sessions; and structured joint
scope. A single session's recommendation does not claim to solve those decisions.

## Verification

Local verification:

- Focused planner/progression run: 38 passed, including five new recommendation
  tests covering data gaps, failure, effort, joint holds, lighter-plan feasibility,
  freshness boundaries and unchanged numeric cues. Later full-suite rerun also
  covers a backdated workout saved recently.
- Full test command: 346 passed (39 pretest, 307 main); typecheck passed.
- Production web export: passed, 27 routes, with isolated QA public Supabase
  configuration. This does not validate production credentials or live sync.
- Final focused Playwright run: 7 passed, 2 intentionally skipped. Recommendation
  acceptance, manual override, no silent selection changes, plan save/reload,
  unchanged original sets/RPE and transient feedback reset passed in desktop Edge,
  Android-sized Chromium and iPhone-sized WebKit. The existing accounting journey
  passed on all three; active-draft recovery runs on its designated desktop project.
  No page errors occurred in the recommendation journey. Light/dark captures were
  inspected; responsive overflow checks and keyboard activation passed.
- Changes remain uncommitted and undeployed. Physical devices and production
  authentication/sync still need release validation; browser emulation is not a
  physical-device pass. Existing workspace changes were preserved.

Changed in this increment: new `src/lib/planning/next-session-recommendation.ts`
and `src/components/next-session-review.tsx`; integration in
`src/app/workouts/[id].tsx`; regression coverage in
`src/lib/planning/workout-plan.test.ts` and `e2e/startup-and-daily-flow.spec.ts`;
roadmap, schema wording, this document, and the progression skill guardrails.
