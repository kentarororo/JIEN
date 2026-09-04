# JIEN lifting-app benchmark

Research and local verification: 3 September 2026. Code reviewed: `f51ca33`.

## Decision

JIEN has a useful foundation for an explainable, lifting-first app: muscle-group
coverage, exercise-specific progression, editable plans, and local saves. Its largest
gaps are **workout execution, feedback-driven programme continuity, and release
confidence**, not the absence of a more capable chatbot.

Keep [Alpha 2.3 production hardening](roadmap.md) as the current milestone. Fix the
logging-integrity issues below within that work. The recommended next product slice
is a fast, resumable set-by-set workout screen; adaptive multi-session programming
comes after its inputs are trustworthy. These are proposed priorities, not newly
completed or approved roadmap milestones.

## Scope and evidence

- Competitor capabilities below come from current first-party product/help pages.
  They are published capabilities, not results from hands-on competitor trials or
  independent evidence of better strength or hypertrophy outcomes.
- JIEN findings come from repository inspection and fresh local tests. No competitor
  subscriptions were purchased, no production records were changed, and no physical
  phone or live production session was tested for this benchmark.
- This is a product and engineering gap assessment, not a numerical speed ranking,
  security certification, or clinical validation. Unknown capabilities are not
  counted as missing. Commercial pricing and regional availability were not audited.
- Reference rules: the progression-algorithm, design-system, and offline-sync skills;
  [product voice](product-voice.md), [visual direction](product-visual-direction.md),
  [browser QA](browser-qa.md), and the roadmap. Competitive-brief methodology supplies
  the first-party comparison and separates evidence from recommendations.

## What the comparison shows

| Reference product | Published capability worth benchmarking | JIEN gap / lesson |
| --- | --- | --- |
| **Fitbod** | Uses equipment, goals, experience, available time, exercise preferences, training history and effort feedback in workout generation; includes estimated muscle recovery and return-after-break adjustments. [How Fitbod creates workouts](https://help.fitbod.me/hc/en-us/articles/360004429814-How-Fitbod-Creates-Your-Workout) | JIEN selects equipment-aware routine starters, but does not yet offer a time-budgeted session or a complete return-from-break policy. Learn from editable constraints and explanations, not opaque recovery percentages or maximum-effort testing. |
| **Alpha Progression** | Structured programmes, per-set recommendations, multiple gym profiles, periodization/deload tools, and a currently advertised 795-exercise library with real demonstration videos. [Product and feature details](https://alphaprogression.com/en/) | JIEN has 132 reviewed exercises and numeric cues, but no comparable multi-week programme lifecycle or integrated technique-video library. Improve confidence and programme continuity before chasing catalogue size. |
| **RP Hypertrophy** | Uses reported pump, soreness and workload to adjust subsequent set recommendations. It places a deload at the end of the chosen training cycle. [Progression logic](https://help.rpstrength.com/hc/en-us/articles/32600173777815-How-does-the-app-determine-when-to-add-weight-reps-and-sets), [cycle/deload behaviour](https://help.rpstrength.com/hc/en-us/articles/33510413024279-Does-the-app-automatically-place-deloads) | JIEN has optional RPE, wellness entries and a joint hold choice, but not an equivalent structured feedback-to-next-session loop. Borrow the explicit feedback/adjustment loop; do not treat subjective soreness as a precise recovery measurement. |
| **JuggernautAI** | Powerlifting/powerbuilding programmes adjusted from feedback, with weak-point selection, warm-up/plate tools, and technique guidance. [Product description](https://www.juggernautai.app/) | A useful reference for continuity and explanation, not a reason to add competition attempts or maximal testing. Those would conflict with JIEN's current scope and progression skill. |
| **Hevy** | Set completion, automatic rest timers, previous values, set types, supersets and plate/warm-up tools in the active logger. [Workout tracking](https://www.hevyapp.com/features/track-workouts/) | The logging-UX reference in this comparison, not a claim that Hevy has no AI features. JIEN's exercise-level “Complete sets” review is not the same as a durable performed-set workflow. |

The opportunity is not to reproduce all five products. JIEN can combine clear
muscle-group priorities with exercise-specific targets and reliable local logging.
Nutrition and wellness can support that experience without dominating the gym screen.
These are positioning opportunities, not claims of competitor inferiority or a proven
unique advantage.

## JIEN capability assessment

| User need | Current evidence | Assessment |
| --- | --- | --- |
| Know what muscle area to train next | `buildMuscleGroupAdvisory` compares current-week set credits with up to four completed weeks and applies a 48-hour scheduling cue. | Built, but it is a personal-history comparison, not a measured recovery or optimal-dose model. Never-trained muscles can be absent from coverage. |
| Know what to lift next | `calculateRecentExerciseBaseline` uses the median of up to three matching sessions. `buildSetProgressionPlan` uses actual set structure, rep range, effort and joint choice. | Built, with integration limitations below. Muscle credits and exercise load comparisons must remain separate. |
| Start quickly | Six equipment-aware routine starters, recent-exercise ordering, multi-term search, swaps, ordering and plan previews. | Available-time limits and explicit repeating split order are now implemented. Gym-specific machine/load constraints remain a later gap. |
| Log while training | Editable load/reps/RPE, blank-load fill, per-exercise review, explicit completed-workout save. | Partial. No performed checkbox per set, rest timer, superset flow or warm-up selector in the active logger. |
| Resume interrupted work | Route-scoped SQLite workout-draft recovery; saved records use SQLite and queued sync. | Active set state, kinds, and the optional timer now recover on web and native. Physical process-termination validation remains part of Alpha 2.3. |
| Learn an unfamiliar exercise | 132 reviewed mappings, equipment/muscle search, notes and editable targets. | Partial. No structured setup/execution/common-mistake/media fields in the current `Exercise` type or comparable technique library. |
| Adapt across a programme | Planned sessions, history, optional effort and wellness feedback, descriptive deload signals. | Explicit split continuity, available time and missed-session actions are now present. Periodized multi-week blocks and deload policies remain later work. |
| Understand and control AI | Explanation layer over deterministic values, consent checks, provider contracts, cached replies and retry/idempotency tests. | Good architectural boundary. Contract tests are not a measured evaluation of explanation quality, medical overreach or factual fidelity. |
| Trust the release | Unit/integration tests, isolated browser suite, local sync/recovery diagnostics. | Partial. Physical-device, real cloud restoration, release gating and scrubbed remote error monitoring remain Alpha 2.3 work. |

Code anchors: [progression](../src/lib/progression/index.ts),
[workout logger](../src/app/workouts/new.tsx),
[workout repository](../src/lib/db/workouts.ts),
[draft model](../src/lib/workout-draft.ts),
[routine starters](../src/lib/planning/routine-starters.ts),
[data types](../src/lib/db/types.ts), and
[AI runtime contract](wellness-ai.md).

### Baseline: what has and has not changed

The earlier latest-session problem is only partly resolved across the experience:

1. Live volume comparison and completed-workout review now use up to three matching
   exercise sessions. With two, the baseline is their midpoint; with one, that one
   session is still the provisional baseline. With no matching history, JIEN does
   not invent a starting weight.
2. Actual latest set rows still supply the double-progression structure. This is
   distinct from the median volume comparator. A three-session median is smoothing,
   not a physiological readiness calculation or a reason to require +5% every time.
3. Muscle focus remains based on completed **weeks**, not the last three muscle
   exposures. The prior exercise-baseline change did not redesign that model.
4. Exercise-detail history still explicitly compares the latest and immediately
   previous session. That can be useful historical information, but its label must
   distinguish it from the recent baseline used for guidance.

Before adding a smarter formula, define new-exercise calibration, stale-history,
changed-set-count, missing-effort and return-after-break cases. Do not transfer a
machine's load to another exercise merely because both target the same muscle.
Keep set credits labelled as an estimate of coverage, not measured activation,
strength or growth. These constraints follow JIEN's existing progression policy;
this benchmark does not establish new scientific prescriptions.

## Concrete review findings

### P1 — keep past effort separate from today's observations — resolved 2026-09-04

In `src/app/workouts/new.tsx`, `fillFromLatestSets` copies the source RPE into a blank
current row. `blocksFromTemplate` also copies RPE when repeating a completed workout.
Those values can then be saved as today's effort without the user entering it.
This matters because effort at or below RPE 9 participates in load-increase decisions.

Implemented: prior RPE remains part of history but new-session RPE is blank.
Preserve RPE when editing an existing record or restoring the person's own draft.
Regression coverage must exercise the rendered repeat/fill/save paths, not only a
helper or source-text assertion. This finding is code-confirmed, not a claim that
the user's production records have already been affected.

### P1 — targets are not proof a set was performed — resolved 2026-09-04

The logger saves non-empty validated rows as working sets. The exercise-level
`completedBlockKeys` review flag does not gate `submit`, and it is not in the saved
draft model. Planned or repeated target rows therefore have no per-set performed
state. The final Save action is explicit, but the model cannot distinguish a
pre-filled target from an actually performed set.

Implemented: target, actual and completion state now travel together, with undo and
interruption recovery. A rest timer should be driven by completion events, not
merely by typing or applying a suggestion. Retain an efficient historical-entry
workflow; do not force someone backfilling an old session through live timers.

### P2 — baseline provenance and chronology can disagree — resolved 2026-09-04

`updateProgression` prefers supplied `sourceSets` over newly loaded recent history.
Templates/plans can therefore retain older source rows while the panel displays a
fresh median and calls its fill action “Fill from latest”. Its edit query excludes
the edited workout but does not pass `beforeCompletedAt`, although the repository
supports that filter. An older workout's live edit panel can use later sessions;
the saved-workout comparison does apply the historical cutoff.

Implemented: planned targets, last performed sets and comparison
baseline; make “as of this workout” consistent for edits/backdated entries. Test
an old template after three newer sessions and an old workout edited after later
training. Show sample count/date context and an honest no-history state.

### P2 — warm-ups are supported below the screen, not by the screen — resolved 2026-09-04

The progression functions exclude non-working sets and the data model has set
kinds, but the logger submits `kind: 'working'` for every row. There is no active
warm-up selector. A person who logs warm-ups there will have them counted as work.

Implemented: working/warm-up type is preserved through drafts, save, edit,
sync and history. Verify warm-ups never contribute to coverage or progression.

### P2 — the automated gate misses existing tests and the Vercel release path — partly resolved 2026-09-04

`package.json` previously omitted `src/lib/workout-draft.test.ts` and
`src/lib/meal-draft.test.ts`; both are now in the standard command, with a manifest
guard against regression.
The source-text checks in `scripts/roadmap-ui-integration.test.mjs` are helpful
guards, but are not rendered interaction tests.

The checked-in GitHub workflow runs tests/typecheck for Pages, on main pushes.
`vercel.json` specifies the web build, not an E2E/test gate. That is a repository
configuration gap, not proof of the account's external branch-protection or Vercel
settings: those were not inspected here.

Next change: include all owned tests and detect future omissions; require a PR
quality job and document how a Vercel release is promoted only after it passes.
Expand E2E to cover the complete focus → plan → schedule → perform → updated
coverage loop. The existing planner scenario stops before saving/scheduling.

## Recommended delivery order

1. **Finish Alpha 2.3 with a logging-integrity checkpoint.** Resolve RPE reuse,
   baseline provenance/date handling and omitted tests. Add physical iPhone Safari
   and Android Chrome interruption tests, real-account QA restore/reconciliation,
   and a documented release/rollback gate. Use a dedicated QA account for mutations.
2. **Next product slice: active workout execution.** Separate targets from completed
   sets, add undo, working/warm-up type, recoverable progress and an optional rest
   timer. Keep one-thumb entry compact, numeric keyboards accessible and current
   target/history/actual values visually distinct. Add supersets after this state
   model is stable. Preserve Warm Utility rather than undertaking another reskin.
3. **Then: programme continuity and feedback.** Add a user-editable repeating split,
   days/time available, missed-session handling and explicit light-week choices.
   Use fresh effort feedback; expose why a recommendation changed and let the user
   hold or decline it. A versioned local deterministic policy remains the numeric
   authority; AI explains it. This needs a separate policy/schema review.

   Status: the first explicit feedback slice is implemented. A completed session can
   become an editable Progress, Repeat, or Ease off plan without changing history;
   broader fresh-effort questions and multi-week deload policy still require the
   separate policy review above.
4. **Then: exercise confidence and equipment precision.** Add reviewed setup cues,
   licensed/owned demonstrations, useful aliases and gym-specific load steps.
   Choose catalogue additions from unsuccessful searches and custom-exercise use,
   not a competitor's headline count. No automatic cross-machine weight conversion.
5. **Before scaling AI: build an evaluation set.** Cover absent/stale data, unit
   changes, declined consent, injuries, missing meals, conflicting sleep/effort
   reports and malicious instructions in imported text. Check that responses do
   not contradict the supplied deterministic numbers, invent history or diagnose.
   Keep offline manual logging independent of provider latency, outages and spend.

Do not prioritise social feeds, streak pressure, competition attempts, max-effort
testing, Olympic/power modes, or a giant unreviewed catalogue. Watch/health-platform
integration can be considered later, after reliable phone session recovery.

## Engineering and usability acceptance measures

These are proposed gates, not measurements this app has already achieved.

| Area | Acceptance / measurement |
| --- | --- |
| Data integrity | Zero lost or duplicated records in the scripted save/retry/offline/relaunch/handoff matrix. No suggested value silently becomes observed effort. Account A's draft must never appear in account B. |
| Physical-device continuity | Test background/foreground, screen lock, process termination, network changes and storage pressure on named iOS/Android devices. Verify saved data separately from unsaved-draft recovery. |
| Accessibility | Preserve JIEN's 44-point minimum, labels, focus, light/dark contrast and reduced motion; verify native Android targets against its 48dp guidance. Test VoiceOver/TalkBack, larger text and the open keyboard on the logger, not only the sign-in page. |
| Web performance | Measure real-user p75 LCP ≤2.5s, INP ≤200ms and CLS ≤0.1, separately for mobile/desktop. Also measure local save-to-visible-confirmation and cold-start-to-editable-workout; no field results are available yet. |
| Gym usability | Time start-from-plan, find/swap an exercise, record a set, correct an error and resume an interrupted draft. Record taps, mistakes and help needed. Set budgets from observed baseline trials, not invented competitor scores. |
| Advisory correctness | Fixtures for 0/1/2/3 sessions, mixed units, missing/high RPE, joint holds, bodyweight, warm-ups, historical edits, changed set counts and stale histories. Assert numbers and explanation provenance together. |
| Release operations | Required checks, release identifier, documented rollback and backward-compatible migrations. Scrubbed stable error codes only; no health content, credentials or raw AI prompts in remote telemetry. |
| Beta outcomes | Failed-save rate, recoverable-sync failures, logging time, and whether users understood/found guidance useful. Accepted recommendations alone are not a training-outcome or safety metric. |

External standards used for these gates:

- Apple's system text styles support Dynamic Type; larger text needs an actual UI
  audit, not a claim based on font choice alone. [Apple typography guidance](https://developer.apple.com/design/human-interface-guidelines/typography)
- Android's guidance includes interruption, sleep/lock and resume checks; its
  accessibility guidance recommends 48dp touch targets. [Core app quality](https://developer.android.com/docs/quality-guidelines/core-app-quality), [touch targets](https://support.google.com/accessibility/android/answer/7101858?hl=en)
- The web thresholds above are Google's Core Web Vitals targets at the 75th
  percentile, not bundle-size thresholds. [Web Vitals](https://web.dev/articles/vitals)
- Use storage, authentication, network and privacy controls as review categories
  for native releases; this review is not MASVS certification. Web auth/storage
  also need their own threat model. [OWASP MASVS](https://mas.owasp.org/MASVS/)

### Repeatable hands-on competitor benchmark

For a later hands-on round, use synthetic profiles and the same three-session
history, equipment, units and tasks in each product. Test new and experienced
lifters separately. Start with five participants for formative feedback, explicitly
not a statistically representative performance claim. Record app version, plan
tier, device, network and task order. Report task completion, time, errors, help
needed and whether the person can explain the next recommendation; do not average
different products' “strength” or “recovery” scores together.

## Verification performed for this review

- `pnpm test`: passed, including pretest batches; main phase **293 passed**. The two
  draft-recovery files are now part of that standard command.
- `pnpm typecheck`: passed.
- `pnpm e2e:build`: passed using the production export pipeline with a reserved fake
  Supabase configuration. Exported 27 routes; the build reported an approximately
  2.3 MB entry bundle. This is an uncompressed build observation, not a network
  transfer or startup-time measurement.
- `pnpm e2e:web`: **11 passed, 7 intentionally skipped** across the three projects;
  the added active-workout workflow covers SQLite interruption recovery and the
  programme workflow covers split/time persistence. A focused follow-up also passed
  missed-session detection and move-to-tomorrow behavior.
  The skips assign the responsive matrix to desktop and touch checks to mobile.
  Edge, Pixel 7 Chromium emulation and iPhone WebKit emulation exercised isolated
  startup, routine editing, workout/meal saves, reload, tab handoff and account
  deletion. Cloud/auth/deletion responses were mocked; local SQLite/IndexedDB was
  real. One WebKit mock request was reported cancelled without a test failure.

No physical-device tests, paid AI calls, real cloud restore, security penetration
test, production deployment, or competitor hands-on timings were performed. The
Vercel release gate and physical-device checks remain open. This implementation does
not change production data or deploy itself.
