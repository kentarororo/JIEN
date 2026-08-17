# Deterministic progression safety

JIEN calculates progression locally from completed working sets. Recorded loads and
reps are never overwritten by a suggestion.

## Body-part workload

Every exercise has one primary muscle tag and zero or more assisting-muscle tags.
Custom exercises use the same controlled list as starter exercises. A completed
working set contributes `1.0` weighted set to the primary muscle and `0.5` to each
tagged assisting muscle; warm-ups do not contribute. This makes bodyweight work
visible even when its entered external load is zero.

The Training screen compares the latest logged ISO week with the previous logged
week and also shows coverage across the latest four logged weeks. `load × reps` is
shown only as descriptive work within a body part. It is never labelled strength,
hypertrophy, or muscle growth, and work from different exercises is not treated as
an anatomy measurement. A 20% or larger weekly drop is an attention signal, while
smaller changes remain descriptive.

AI receives the same bounded four-week body-part summary alongside recent recovery,
each logged nutrition day's macro totals, logged-day averages, and the current macro
target. This makes cross-domain explanations possible without treating an unlogged
or partially logged day as dietary failure. It may explain patterns, data gaps, and
pacing, but the local double-progression plan remains the sole source for suggested
loads and reps.

Onboarding joint and injury considerations are currently stored as free-form profile
notes, without exercise-level scope. While any non-empty consideration is saved,
workout planning and logging use the conservative rule: copy the previous completed
sets as a reference, return a `hold` action, and emit no add-rep or add-load cues.
This prevents an unscoped note from being silently ignored or interpreted as medical
advice. The user can still record the work they choose and can review the
consideration from profile settings.

The numeric engine remains deterministic and offline. A future structured mapping
may narrow a consideration to relevant movements, but it must remain explicit,
user-visible, and covered by progression boundary tests before replacing this global
hold.
