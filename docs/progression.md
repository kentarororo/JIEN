# Deterministic progression safety

JIEN calculates progression locally from completed working sets. Recorded loads and
reps are never overwritten by a suggestion.

## Body-part workload

Every exercise has one primary muscle tag and zero or more assisting-muscle tags.
Custom exercises use the same controlled list as starter exercises. A completed
working set contributes `1.0` weighted set to the primary muscle and `0.5` to each
tagged assisting muscle; warm-ups do not contribute. This makes bodyweight work
visible even when its entered external load is zero.

The controlled bodybuilding baseline distinguishes upper, middle, and lower traps;
rhomboids; lats; spinal erectors; all three deltoid regions; rotator cuff; the major
arm, chest, leg, hip, lower-leg, trunk, serratus, and neck groups. General upper-back
and core tags remain available for movements where a narrower attribution would be
false precision.

The Training and Today screens lead with a muscle-group advisory built from the
user's average set credits across up to four completed ISO weeks. It compares the
current week's coverage with that personal baseline and surfaces up to three gaps
that were not trained in the last 48 hours. Related regions are pooled only for this
coverage view; exact exercise and detailed target tags remain in history.

`load × reps` remains descriptive exercise/session detail. It is never compared
across different movements as a muscle score and is never labelled strength,
hypertrophy, or muscle growth. Exercise-specific double progression still uses only
matching exercise history. The live logger and completed-workout review compare the
current exercise with the median volume of up to its three most recent completed
sessions. One unusually strong or weak day therefore cannot become the whole target.
The latest matching session—not an average—continues to supply editable target rows,
load, reps, and the double-progression cue so JIEN never invents a set structure.
Historical RPE and completion state are never copied: effort is fresh feedback entered
after the person performs today's set.
With two prior sessions the midpoint is used; with one, that session is the temporary
baseline; with none, the current session establishes it. See
[training-advisory-engine.md](training-advisory-engine.md).

AI receives the same bounded four-week body-part summary alongside recent recovery,
each logged nutrition day's macro totals, logged-day averages, and the current macro
target. This makes cross-domain explanations possible without treating an unlogged
or partially logged day as dietary failure. It may explain patterns, data gaps, and
pacing, but the local double-progression plan remains the sole source for suggested
loads and reps.

Onboarding joint and injury considerations are currently stored as free-form profile
notes, without exercise-level scope. While any non-empty consideration is saved,
workout planning and logging recommend the conservative rule by default: copy the
previous completed sets as a reference, return a `hold` action, and emit no add-rep
or add-load cues. The user can explicitly continue normal progression suggestions
for that session or saved plan when their current condition and clinician guidance
allow it. This choice changes derived cues only; it never changes recorded sets or
removes the profile consideration.

Every recorded set snapshots its muscle targets, so later exercise edits affect
future logs without reclassifying past sessions. The numeric engine remains
deterministic and offline. A future structured mapping
may narrow a consideration to relevant movements, but it must remain explicit,
user-visible, and covered by progression boundary tests before replacing this global
hold.
