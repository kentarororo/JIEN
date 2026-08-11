---
name: progression-algorithm
description: JIEN's deterministic, volume-based lift progression rules. Use for exercise prescription, set and rep targets, weekly volume analytics, progression suggestions, stagnation or deload flags, and tests of training math.
---

# JIEN progression algorithm

Run progression entirely offline as pure TypeScript over locally stored completed sets. Never use AI output as a numeric source of truth.

## Core rules

- Compute set volume as `load * reps`; aggregate by movement pattern and muscle group per ISO week.
- Use double progression inside each exercise's configured rep range.
- Increase load only when every completed working set reaches the top of the range with acceptable RPE and no joint flag.
- Otherwise hold load and recommend the smallest practical rep increase without exceeding the range.
- Keep warm-up sets out of progression volume.
- Treat rear delts and core as first-class muscle groups.
- Never calculate, request, or prescribe 1RM or max-effort tests.

## Safety and explainability

- Preserve recorded values; suggestions are separate derived data.
- Surface missing or inconsistent inputs instead of inventing values.
- Let wellness signals adjust pacing or exercise selection only through an explicit, user-visible explanation.
- Define stagnation and deload thresholds as tested configuration before enabling automatic flags.
- Unit-test boundary conditions, partial sessions, mixed units, edited sets, and ISO week transitions.
