# Deterministic adaptive nutrition

JIEN's adaptive nutrition evaluator is pure decision support. It reads already-
aggregated local-day history and returns either `hold` or a review-only calorie
recommendation. It cannot write a target, close an effective target range, or change
macros automatically. The macro-target screen may copy a recommendation into its
editable form only after the user selects it; saving remains a separate confirmation.

## Trend weight

Trend weight is a time-aware exponentially weighted moving average of the latest valid
weight on each local date. The first reading seeds the series. Later readings use a
seven-day half-life, so half of a reading's influence remains after seven calendar
days; gaps advance the decay by the actual number of elapsed days. Raw measurements
are never rewritten. JIEN shows `Need more data (x of 7 days)` until seven distinct
weigh-in days exist, then shows the latest trend beside the raw points.

## Expenditure estimate

Estimated expenditure uses the latest 28 local days. Only food days explicitly marked
Complete with at least 800 kcal contribute to average intake. Partial, not-logged,
empty, and implausibly low Complete days are excluded rather than treated as zero.
The estimate is:

`average complete-day intake - (trend-weight change / elapsed days × 7,700 kcal/kg)`

The `7,700 kcal/kg` energy-density value is a sizing heuristic, not an individual
physiology claim. A value is withheld until the window has at least 14 qualifying
intake days, seven weigh-in days, and 21 elapsed days between its first and last trend
points. The displayed range combines robust intake variation, raw-to-trend weight
noise, and missing-day coverage, rounds to 25 kcal, and is bounded to a 100–500 kcal
half-width. High confidence requires 21 qualifying intake days, 14 weigh-in days, and
the full 28-day span; otherwise a qualifying estimate is medium confidence.

## Inputs

- Current daily calorie and protein targets.
- A desired weekly body-weight change expressed as a percentage between `-1%` and
  `+1%`. The evaluator does not infer this direction from a broad composition goal.
- One daily aggregate per local calendar date containing its food-log state and
  optional body weight, calories, and protein. Invalid dates or implausible numeric
  values are treated as missing observations rather than coerced.

## Data sufficiency

The latest four rolling seven-day windows are inspected. The newest three windows
must span at least 21 days and each contain:

- body weight on at least four days;
- at least five food-log days explicitly marked complete;
- calorie totals on at least five complete days; and
- protein totals on at least five complete days.

Partial and not-logged food days do not contribute intake totals or zeroes. Body
weight remains independent and still counts on either kind of day.

A fourth eligible week improves confidence. Weekly calorie averages must also stay
within a 12% relative spread; otherwise changes in weight cannot be attributed to a
stable enough intake signal and the result is `hold`. Missing-history and consistency
reasons are returned as machine-readable issue codes. `complete_day_coverage_low`
specifically means that a required week has too few explicitly complete food days.

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

## Weekly check-in

The user may opt into a local weekday stored with the versioned nutrition target. On
that day, the existing deterministic evaluator produces a review card. Insufficient
history shows coverage progress; an in-range result recommends holding; an out-of-
range result shows the conservatively capped calorie target and the existing protein
target. Weight-rate evidence does not invent a new protein prescription. Nothing is
written until the user taps **Apply weekly targets**. That action uses the normal
local-first target save and queues the accepted `adaptive` target for sync.
