# Exercise catalogue

JIEN ships 132 reviewed exercises. The catalogue is intentionally broad enough for
most general gym, bodybuilding, and strength routines without requiring routine
movements to be recreated as custom exercises.

## Coverage

- Machine and Smith-machine presses, rows, squats, hinges, leg, arm, calf, hip, and
  trunk movements.
- Barbell squat, bench, overhead press, row, deadlift, hip-thrust, arm, shrug, and
  landmine variations.
- Dumbbell press, fly, raise, row, curl, triceps, squat, lunge, step-up, hinge, calf,
  and shrug variations.
- Cable presses, fly angles, vertical and horizontal pulls, shoulder, arm, hip, leg,
  trunk, serratus, and rotator-cuff movements.
- Common repetition-based bodyweight work including push-ups, pull-ups, chin-ups,
  dips, rows, split squats, lunges, abdominal rollouts, and leg raises.
- Kettlebell swings and goblet squats.

Every starter row has a stable ID, movement pattern, one primary target, distinct
assisting targets, equipment type, rep range, and practical load increment. Automated
catalogue checks reject duplicate IDs or names, unknown muscle groups, a primary
target repeated as assistance, and duplicate assisting targets.

## Mapping policy

- Primary means the main muscular target for JIEN's set-credit model, not the only
  tissue active during the movement.
- Assisting targets are limited to meaningful contributors. Routine stabilization is
  not automatically treated as half a hypertrophy set for every compound exercise.
- Exercise setup and technique can change emphasis. The Exercise targets panel keeps
  every mapping editable, and changes affect future sets only.
- Related regional targets are pooled only in the next-workout advisory. The detailed
  exercise record retains upper chest, deltoid heads, trap regions, rhomboids, abs,
  obliques, and other specific tags.

## Deliberate exclusions

The current logger records repetitions, load, and optional RPE. Timed carries,
isometric holds, distance-based work, Olympic lifts, plyometrics, and conditioning
drills are not included merely to inflate the list. Those movements need duration,
distance, velocity, power, side, or technique-specific fields before progression can
be represented accurately.

## Discovery

Exercise targets can be filtered by muscle area, equipment, built-in/custom status,
or review status. Search accepts multiple plain-language terms and includes exercise
name, movement pattern, equipment, primary and assisting muscle labels, and broad
areas such as legs, back, or arms. Recently used exercises remain first in workout
logging and planning.

## Routine starters

Workout planning offers push, pull, legs, upper-body, lower-body, and full-body
starters. Each starter selects one available exercise for each movement slot using
the equipment saved in the profile. It then applies only the user's existing
exercise history; missing loads and reps remain blank. Starters create an editable
draft and never save or replace a workout automatically.
