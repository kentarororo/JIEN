# Deterministic adaptive nutrition

JIEN's adaptive nutrition evaluator is pure decision support. It reads already-
aggregated local-day history and returns either `hold` or a review-only calorie
recommendation. It cannot write a target, close an effective target range, or change
macros automatically. The macro-target screen may copy a recommendation into its
editable form only after the user selects it; saving remains a separate confirmation.

## Inputs

- Current daily calorie and protein targets.
- A desired weekly body-weight change expressed as a percentage between `-1%` and
  `+1%`. The evaluator does not infer this direction from a broad composition goal.
- One daily aggregate per local calendar date containing optional body weight,
  calories, and protein. Invalid dates or implausible numeric values are treated as
  missing observations rather than coerced.

## Data sufficiency

The latest four rolling seven-day windows are inspected. The newest three windows
must span at least 21 days and each contain:

- body weight on at least four days;
- calorie totals on at least five days; and
- protein totals on at least five days.

A fourth eligible week improves confidence. Weekly calorie averages must also stay
within a 12% relative spread; otherwise changes in weight cannot be attributed to a
stable enough intake signal and the result is `hold`. Missing-history and consistency
reasons are returned as machine-readable issue codes.

## Robust trend

Daily duplicate observations are collapsed with a median. Each week's weight is its
median daily weight, limiting the effect of a single unusual measurement. The weekly
rate is a Theil–Sen slope: the median of every pairwise slope between weekly medians.
This is less sensitive to one noisy week than comparing the first and last values.

The smoothed rate is converted to percent of the median weight. A tolerance band is
the larger of `0.15` percentage points or 35% of the requested rate. A rate inside
that band returns `hold`. A rate outside it still returns `hold` with low confidence
unless both most-recent week-to-week changes support the same direction.

## Conservative recommendation

When coverage, intake consistency, smoothing, and recent-direction checks all pass,
the evaluator may recommend increasing or decreasing calories. It uses a bounded
energy-equivalent heuristic only to size the step; it is not a prediction of an
individual physiological response.

The absolute daily step is capped at both:

- 150 kcal; and
- 6% of the current calorie target.

Normal steps are rounded to 25 kcal before the cap. The result always includes
`requiresUserConfirmation: true`. Protein history is reported separately as
`generally_met` or `frequently_below` using days at or above 90% of the current
protein target; this evaluator never invents or applies a new protein target.

## Confidence

- `insufficient`: coverage or intake consistency failed; no adjustment.
- `low`: data exists but recent weight direction conflicts with the smoothed trend;
  no adjustment.
- `medium`: three qualifying weeks support the result.
- `high`: four weeks have stronger coverage and weekly calorie spread is at most 6%.

The evaluator makes no diagnosis or treatment claim. Illness, pregnancy, disordered-
eating concerns, unexplained weight changes, or other clinical contexts belong
outside this calculation and require appropriate professional review.
