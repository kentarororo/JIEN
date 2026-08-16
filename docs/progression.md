# Deterministic progression safety

JIEN calculates progression locally from completed working sets. Recorded loads and
reps are never overwritten by a suggestion.

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
