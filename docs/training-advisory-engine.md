# Muscle-group training advisory

JIEN separates two questions that require different measurements:

1. **What should receive attention next?** Use completed working-set credits by
   muscle group across recent calendar weeks.
2. **How should a specific exercise progress?** Use that exercise's own prior sets,
   rep range, load increment, RPE, and joint hold state.

This prevents a cable fly, push-up, and chest press from being compared by raw
`load × reps` as though their external loads were interchangeable. Their chest set
credits can contribute to one higher-level chest view, while their load and rep
progressions remain movement-specific.

## Evidence translated into product rules

- Resistance-training volume has a positive dose-response relationship with
  hypertrophy, with diminishing returns. A 2025 meta-regression found that counting
  indirect work as half a set fit the evidence better than counting it as either a
  full set or no set. JIEN therefore counts a primary target as `1.0` and each unique
  assisting target as `0.5`.
- The 2026 ACSM position stand reports that higher weekly volume can enhance
  hypertrophy and uses roughly ten weekly sets per muscle group as a general
  reference. JIEN does not turn that population-level reference into an automatic
  personal prescription. The first advisory baseline is the user's own recent
  training pattern.
- Exercise selection is not irrelevant. Systematic variation can change regional
  hypertrophy and strength, while excessive random variation can hinder adaptation.
  JIEN retains the exact exercise, movement pattern, and detailed muscle tags in the
  record; only the dashboard's coverage view pools related regions.
- `Load × reps` can describe work within a repeated movement, but volume-load is not
  always an appropriate way to equate different hypertrophy programs. JIEN therefore
  keeps it in exercise/session detail and does not use it to rank muscles.
- Hypertrophy can occur across a wide range of loads when effort is sufficient, while
  heavier loading remains more specific to maximal strength. JIEN's muscle advisory
  does not infer growth or strength from load alone.

Primary references:

- [ACSM 2026 resistance-training position stand](https://pubmed.ncbi.nlm.nih.gov/41843416/)
- [2025 dose-response meta-regression of direct and indirect sets](https://pubmed.ncbi.nlm.nih.gov/41343037/)
- [Systematic review of exercise variation](https://pubmed.ncbi.nlm.nih.gov/35438660/)
- [Review of methods for equating resistance-training volume](https://pubmed.ncbi.nlm.nih.gov/33826122/)
- [Network meta-analysis of load, hypertrophy, and strength](https://pubmed.ncbi.nlm.nih.gov/33433148/)

## Deterministic advisory model

The engine runs locally over completed working sets:

1. Normalize detailed exercise targets into reporting families where the anatomy is
   intentionally pooled: upper chest into chest; middle/lower traps and rhomboids
   into upper back; abs and obliques into core; brachialis into the elbow-flexor
   family. Deltoid heads, lats, upper traps, lower back, hips, and lower-leg groups
   remain distinct where pooling would hide a meaningful training gap.
2. Count each working set once for its primary family and half for each unique
   assisting family. Warm-ups do not count.
3. Average each family's set credits across up to four completed ISO calendar weeks.
   Weeks after the first recent log count even when that muscle received zero sets.
4. Compare the current week's credits with that personal baseline. Rank the largest
   remaining gaps, then remove muscles trained within the last 48 hours from the
   immediate focus list.
5. Return one of four explicit states: more history needed, muscle focus available,
   largest gaps trained recently, or usual weekly coverage reached.

The 48-hour rule is a conservative prioritization heuristic, not a declaration that
a muscle is or is not physiologically recovered. The interface tells the user to use
current soreness, joint status, and recovery before repeating recent work.

## Recording integrity

Every saved set snapshots its primary and assisting muscle targets. Editing an
exercise later changes future logs only; it does not reclassify historical workouts.
Legacy rows are backfilled non-destructively from their current exercise mapping.
Cloud readers prefer the snapshot and fall back to the exercise row during the
rolling deployment.

The reviewed 132-exercise starter catalogue covers the common machine, cable,
barbell, dumbbell, Smith-machine, bodyweight, and kettlebell movements used in
general strength and hypertrophy routines. It avoids broad/specific double counting,
uses specific shoulder and upper-back regions where attribution is useful, attributes
abdominal flexion and rotation separately, and includes adductor, hip-abductor,
serratus, brachialis, lower-back, and lower-leg work. Custom exercises remain
editable through Exercise targets.

## Safety and limits

- Set credits estimate exposure; they do not measure activation, effective reps,
  fatigue, recovery, strength, or muscle growth.
- No workout, set, or target is changed automatically.
- Joint considerations continue to hold numeric progression by default unless the
  user explicitly chooses to continue for that session.
- Exercise-specific double progression remains the sole numeric source for load and
  rep suggestions.
- AI may explain this deterministic output but cannot replace its numbers or state.
