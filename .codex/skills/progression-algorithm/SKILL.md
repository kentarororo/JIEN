---
name: progression-algorithm
description: JIEN's deterministic, volume-based lift progression rules. Use for exercise prescription, set and rep targets, weekly volume analytics, progression suggestions, stagnation or deload flags, and tests of training math.
---

# JIEN progression algorithm

Run progression entirely offline as pure TypeScript over locally stored completed sets. Never use AI output as a numeric source of truth.

## Core rules

- Use the shared `supabase/functions/_shared/training-set-policy.ts` in local calculations, SQLite readers, and Edge summaries. Completed working, failure, and drop rows count toward descriptive training work and muscle coverage. Working and failure rows enter comparable exercise baselines; drops do not. Warm-ups never count. Set credits are a logging convention, not proof of equal stimulus.
- Failure is high-effort evidence, not zero work or an automatic progression bonus. Hold increase cues even if RPE is missing or contradictory. Preserve the recorded RPE; never fabricate 10. Repeated targets reset failure and effort, while the optional plan `sourceKind` preserves historical evidence for cue rebuilding only.
- Compute set volume as `load * reps`; aggregate by movement pattern and muscle group per ISO week.
- Use double progression inside each exercise's configured rep range.
- Increase load only when every completed main set (working/failure) reaches the top of the range with acceptable RPE, no failure evidence, and no joint flag.
- Otherwise hold load and recommend the smallest practical rep increase without exceeding the range.
- Keep warm-up sets out of progression volume.
- Treat rear delts and core as first-class muscle groups.
- Never calculate, request, or prescribe 1RM or max-effort tests.

## Phase 1 defaults

- Default compound machine/cable range: 8-12 reps.
- Isolation range: 10-15 reps. Rear-delt and core work may use 12-20 reps.
- Count primary-muscle volume at 100% and secondary-muscle volume at 50%.
- Permit a load increase only when every main set reaches the top of its configured range with recorded RPE at most 9 and no failure evidence.
- Otherwise add one rep to the lowest-rep eligible set. Hold the prescription when a joint flag is present or RPE exceeds 9.
- Flag an unplanned weekly drop at 20% or more. Flag stagnation after three consecutive completed week-over-week changes below 2%. Both are advisory deload signals, never automatic plan changes.

## Safety and explainability

- Preserve recorded values; suggestions are separate derived data.
- Surface missing or inconsistent inputs instead of inventing values.
- Let wellness signals adjust pacing or exercise selection only through an explicit, user-visible explanation.
- Define stagnation and deload thresholds as tested configuration before enabling automatic flags.
- Unit-test boundary conditions, partial sessions, mixed units, edited sets, and ISO week transitions.
- Next-session recommendations use `src/lib/planning/next-session-recommendation.ts`; they choose an advisory approach, never numeric targets. Missing effort cannot recommend Progress. Session check-in feedback does not replace RPE, persist as a recovery assessment, or silently change the user's selected approach. See `docs/next-session-recommendation.md`.
