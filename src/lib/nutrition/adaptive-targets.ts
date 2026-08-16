export type AdaptiveNutritionHistoryDay = {
  date: string;
  bodyWeightKg: number | null;
  caloriesKcal: number | null;
  proteinG: number | null;
};

export type AdaptiveNutritionConfidence = 'insufficient' | 'low' | 'medium' | 'high';

export type AdaptiveNutritionDataIssue =
  | 'history_too_short'
  | 'weight_coverage_low'
  | 'calorie_coverage_low'
  | 'protein_coverage_low'
  | 'calorie_pattern_inconsistent';

export type AdaptiveNutritionReason =
  | AdaptiveNutritionDataIssue
  | 'weight_trend_unstable'
  | 'within_desired_range'
  | 'weight_change_above_desired_range'
  | 'weight_change_below_desired_range';

export type AdaptiveNutritionEvaluation = {
  action: 'hold' | 'recommend_adjustment';
  confidence: AdaptiveNutritionConfidence;
  dataSufficiency: {
    sufficient: boolean;
    daysEvaluated: number;
    completeWeeks: number;
    weightDays: number;
    calorieDays: number;
    proteinDays: number;
    issues: AdaptiveNutritionDataIssue[];
  };
  trend: {
    weeklyMedianWeightsKg: number[];
    smoothedWeeklyWeightChangeKg: number | null;
    smoothedWeeklyWeightChangePercent: number | null;
    weeklyAverageCaloriesKcal: number[];
    robustAverageCaloriesKcal: number | null;
    robustAverageProteinG: number | null;
    proteinTargetDaysPercent: number | null;
    proteinSignal: 'insufficient' | 'frequently_below' | 'generally_met';
  };
  recommendation: {
    direction: 'hold' | 'increase' | 'decrease';
    currentCaloriesKcal: number;
    suggestedCaloriesKcal: number;
    adjustmentKcal: number;
    reason: AdaptiveNutritionReason;
    requiresUserConfirmation: true;
  };
};

export type EvaluateAdaptiveNutritionInput = {
  currentCaloriesKcal: number;
  currentProteinTargetG: number;
  /** Desired body-weight change per week, as percent of body weight. */
  desiredWeeklyWeightChangePercent: number;
  history: AdaptiveNutritionHistoryDay[];
};

type DailyAggregate = {
  dayNumber: number;
  weights: number[];
  calories: number[];
  proteins: number[];
};

type WeeklyAggregate = {
  medianWeightKg: number | null;
  averageCaloriesKcal: number | null;
  averageProteinG: number | null;
  weightDays: number;
  calorieDays: number;
  proteinDays: number;
  proteinTargetDays: number;
};

const DAY_MS = 86_400_000;
const REQUIRED_WEEKS = 3;
const MAX_WEEKS = 4;
const MIN_WEIGHT_DAYS_PER_WEEK = 4;
const MIN_NUTRITION_DAYS_PER_WEEK = 5;
const MAX_WEEKLY_CALORIE_SPREAD_PERCENT = 12;
const MAX_DAILY_ADJUSTMENT_KCAL = 150;
const MAX_TARGET_ADJUSTMENT_PERCENT = 6;
const ADJUSTMENT_INCREMENT_KCAL = 25;

/**
 * Evaluate whether history supports a conservative target recommendation.
 * This function is pure decision support: it never persists or applies a target.
 */
export function evaluateAdaptiveNutritionTarget(
  input: EvaluateAdaptiveNutritionInput,
): AdaptiveNutritionEvaluation {
  validateInput(input);
  const daily = normalizeDailyHistory(input.history);
  if (daily.length === 0) {
    return insufficientEvaluation(input.currentCaloriesKcal, 0, [], ['history_too_short']);
  }

  const latestDay = daily[daily.length - 1]!.dayNumber;
  const firstEvaluatedDay = latestDay - MAX_WEEKS * 7 + 1;
  const evaluated = daily.filter((day) => day.dayNumber >= firstEvaluatedDay && day.dayNumber <= latestDay);
  const daysEvaluated = evaluated.length
    ? latestDay - evaluated[0]!.dayNumber + 1
    : 0;
  const weeks = buildWeeks(evaluated, latestDay, input.currentProteinTargetG);
  const recentRequired = weeks.slice(-REQUIRED_WEEKS);
  const issues = coverageIssues(recentRequired, evaluated);

  const eligibleFourthWeek = weeks.length === MAX_WEEKS && coverageIssues(weeks.slice(0, 1), evaluated, false).length === 0;
  const analysisWeeks = eligibleFourthWeek ? weeks : recentRequired;
  const weeklyCalories = analysisWeeks
    .map((week) => week.averageCaloriesKcal)
    .filter((value): value is number => value != null);
  if (issues.length === 0 && relativeSpreadPercent(weeklyCalories) > MAX_WEEKLY_CALORIE_SPREAD_PERCENT) {
    issues.push('calorie_pattern_inconsistent');
  }

  if (issues.length > 0) {
    return insufficientEvaluation(input.currentCaloriesKcal, daysEvaluated, analysisWeeks, issues);
  }

  const weeklyWeights = analysisWeeks.map((week) => week.medianWeightKg as number);
  const weeklyProteins = analysisWeeks.map((week) => week.averageProteinG as number);
  const smoothedWeeklyChangeKg = theilSenWeeklySlope(weeklyWeights);
  const referenceWeightKg = median(weeklyWeights);
  const smoothedWeeklyChangePercent = referenceWeightKg > 0
    ? smoothedWeeklyChangeKg / referenceWeightKg * 100
    : 0;
  const tolerancePercent = Math.max(0.15, Math.abs(input.desiredWeeklyWeightChangePercent) * 0.35);
  const gapPercent = smoothedWeeklyChangePercent - input.desiredWeeklyWeightChangePercent;
  const proteinLoggedDays = analysisWeeks.reduce((total, week) => total + week.proteinDays, 0);
  const proteinTargetDays = analysisWeeks.reduce((total, week) => total + week.proteinTargetDays, 0);
  const proteinTargetDaysPercent = proteinLoggedDays > 0 ? proteinTargetDays / proteinLoggedDays * 100 : null;
  const confidence = highConfidence(analysisWeeks, weeklyCalories) ? 'high' : 'medium';
  const trend = {
    weeklyMedianWeightsKg: weeklyWeights.map(roundOne),
    smoothedWeeklyWeightChangeKg: roundTwo(smoothedWeeklyChangeKg),
    smoothedWeeklyWeightChangePercent: roundTwo(smoothedWeeklyChangePercent),
    weeklyAverageCaloriesKcal: weeklyCalories.map(Math.round),
    robustAverageCaloriesKcal: Math.round(median(weeklyCalories)),
    robustAverageProteinG: roundOne(median(weeklyProteins)),
    proteinTargetDaysPercent: proteinTargetDaysPercent == null ? null : Math.round(proteinTargetDaysPercent),
    proteinSignal: proteinTargetDaysPercent != null && proteinTargetDaysPercent >= 70
      ? 'generally_met' as const
      : 'frequently_below' as const,
  };
  const sufficiency = dataSufficiency(true, daysEvaluated, analysisWeeks, []);

  if (Math.abs(gapPercent) <= tolerancePercent) {
    return holdEvaluation(input.currentCaloriesKcal, confidence, sufficiency, trend, 'within_desired_range');
  }
  if (!recentChangesConfirmDirection(weeklyWeights, input.desiredWeeklyWeightChangePercent, tolerancePercent, gapPercent)) {
    return holdEvaluation(input.currentCaloriesKcal, 'low', sufficiency, trend, 'weight_trend_unstable');
  }

  const direction = gapPercent > 0 ? 'decrease' : 'increase';
  const adjustmentKcal = conservativeAdjustment(
    direction,
    gapPercent,
    referenceWeightKg,
    input.currentCaloriesKcal,
  );
  return {
    action: 'recommend_adjustment',
    confidence,
    dataSufficiency: sufficiency,
    trend,
    recommendation: {
      direction,
      currentCaloriesKcal: input.currentCaloriesKcal,
      suggestedCaloriesKcal: input.currentCaloriesKcal + adjustmentKcal,
      adjustmentKcal,
      reason: direction === 'decrease'
        ? 'weight_change_above_desired_range'
        : 'weight_change_below_desired_range',
      requiresUserConfirmation: true,
    },
  };
}

function validateInput(input: EvaluateAdaptiveNutritionInput): void {
  if (!Number.isFinite(input.currentCaloriesKcal) || input.currentCaloriesKcal <= 0) {
    throw new Error('Current calories must be a positive number.');
  }
  if (!Number.isFinite(input.currentProteinTargetG) || input.currentProteinTargetG <= 0) {
    throw new Error('Current protein target must be a positive number.');
  }
  if (!Number.isFinite(input.desiredWeeklyWeightChangePercent)
    || input.desiredWeeklyWeightChangePercent < -1
    || input.desiredWeeklyWeightChangePercent > 1) {
    throw new Error('Desired weekly weight change must be between -1% and 1%.');
  }
}

function normalizeDailyHistory(history: AdaptiveNutritionHistoryDay[]): DailyAggregate[] {
  const byDay = new Map<number, DailyAggregate>();
  for (const row of history) {
    const dayNumber = parseDateKey(row.date);
    if (dayNumber == null) continue;
    const aggregate = byDay.get(dayNumber) ?? { dayNumber, weights: [], calories: [], proteins: [] };
    if (validRange(row.bodyWeightKg, 20, 500)) aggregate.weights.push(row.bodyWeightKg!);
    if (validRange(row.caloriesKcal, 1, 20_000)) aggregate.calories.push(row.caloriesKcal!);
    if (validRange(row.proteinG, 0, 1_000)) aggregate.proteins.push(row.proteinG!);
    byDay.set(dayNumber, aggregate);
  }
  return [...byDay.values()].sort((a, b) => a.dayNumber - b.dayNumber);
}

function buildWeeks(
  days: DailyAggregate[],
  latestDay: number,
  proteinTargetG: number,
): WeeklyAggregate[] {
  const result: WeeklyAggregate[] = [];
  for (let offset = MAX_WEEKS - 1; offset >= 0; offset -= 1) {
    const end = latestDay - offset * 7;
    const start = end - 6;
    const weekDays = days.filter((day) => day.dayNumber >= start && day.dayNumber <= end);
    const weights = weekDays.flatMap((day) => day.weights.length ? [median(day.weights)] : []);
    const calories = weekDays.flatMap((day) => day.calories.length ? [median(day.calories)] : []);
    const proteins = weekDays.flatMap((day) => day.proteins.length ? [median(day.proteins)] : []);
    result.push({
      medianWeightKg: weights.length ? median(weights) : null,
      averageCaloriesKcal: calories.length ? mean(calories) : null,
      averageProteinG: proteins.length ? mean(proteins) : null,
      weightDays: weights.length,
      calorieDays: calories.length,
      proteinDays: proteins.length,
      proteinTargetDays: proteins.filter((protein) => protein >= proteinTargetG * 0.9).length,
    });
  }
  return result;
}

function coverageIssues(
  weeks: WeeklyAggregate[],
  evaluated: DailyAggregate[],
  includeHistoryLength = true,
): AdaptiveNutritionDataIssue[] {
  const issues: AdaptiveNutritionDataIssue[] = [];
  const evaluatedSpanDays = evaluated.length
    ? evaluated[evaluated.length - 1]!.dayNumber - evaluated[0]!.dayNumber + 1
    : 0;
  if (includeHistoryLength && (weeks.length < REQUIRED_WEEKS || evaluatedSpanDays < REQUIRED_WEEKS * 7)) {
    issues.push('history_too_short');
  }
  if (weeks.some((week) => week.weightDays < MIN_WEIGHT_DAYS_PER_WEEK)) issues.push('weight_coverage_low');
  if (weeks.some((week) => week.calorieDays < MIN_NUTRITION_DAYS_PER_WEEK)) issues.push('calorie_coverage_low');
  if (weeks.some((week) => week.proteinDays < MIN_NUTRITION_DAYS_PER_WEEK)) issues.push('protein_coverage_low');
  return issues;
}

function recentChangesConfirmDirection(
  weeklyWeights: number[],
  desiredPercent: number,
  tolerancePercent: number,
  smoothedGapPercent: number,
): boolean {
  const changes = weeklyWeights.slice(1).map((weight, index) => {
    const previous = weeklyWeights[index]!;
    return (weight - previous) / previous * 100 - desiredPercent;
  });
  const recent = changes.slice(-2);
  return recent.length === 2 && recent.every((change) => smoothedGapPercent > 0
    ? change > tolerancePercent
    : change < -tolerancePercent);
}

function conservativeAdjustment(
  direction: 'increase' | 'decrease',
  gapPercent: number,
  referenceWeightKg: number,
  currentCaloriesKcal: number,
): number {
  // Energy-equivalent heuristic only; trend noise is controlled by the small cap.
  const estimatedDailyGap = Math.abs(gapPercent) / 100 * referenceWeightKg * 7_700 / 7;
  const cap = Math.min(
    MAX_DAILY_ADJUSTMENT_KCAL,
    currentCaloriesKcal * MAX_TARGET_ADJUSTMENT_PERCENT / 100,
  );
  const roundedEstimate = Math.max(
    ADJUSTMENT_INCREMENT_KCAL,
    Math.round(estimatedDailyGap / ADJUSTMENT_INCREMENT_KCAL) * ADJUSTMENT_INCREMENT_KCAL,
  );
  const magnitude = roundOne(Math.min(cap, Math.max(1, roundedEstimate)));
  return direction === 'decrease' ? -magnitude : magnitude;
}

function insufficientEvaluation(
  currentCaloriesKcal: number,
  daysEvaluated: number,
  requiredWeeks: WeeklyAggregate[],
  issues: AdaptiveNutritionDataIssue[],
): AdaptiveNutritionEvaluation {
  const weeklyWeights = requiredWeeks.map((week) => week.medianWeightKg).filter((value): value is number => value != null);
  const weeklyCalories = requiredWeeks.map((week) => week.averageCaloriesKcal).filter((value): value is number => value != null);
  const weeklyProteins = requiredWeeks.map((week) => week.averageProteinG).filter((value): value is number => value != null);
  return {
    action: 'hold',
    confidence: 'insufficient',
    dataSufficiency: dataSufficiency(false, daysEvaluated, requiredWeeks, unique(issues)),
    trend: {
      weeklyMedianWeightsKg: weeklyWeights.map(roundOne),
      smoothedWeeklyWeightChangeKg: null,
      smoothedWeeklyWeightChangePercent: null,
      weeklyAverageCaloriesKcal: weeklyCalories.map(Math.round),
      robustAverageCaloriesKcal: weeklyCalories.length ? Math.round(median(weeklyCalories)) : null,
      robustAverageProteinG: weeklyProteins.length ? roundOne(median(weeklyProteins)) : null,
      proteinTargetDaysPercent: null,
      proteinSignal: 'insufficient',
    },
    recommendation: {
      direction: 'hold',
      currentCaloriesKcal,
      suggestedCaloriesKcal: currentCaloriesKcal,
      adjustmentKcal: 0,
      reason: unique(issues)[0] ?? 'history_too_short',
      requiresUserConfirmation: true,
    },
  };
}

function holdEvaluation(
  currentCaloriesKcal: number,
  confidence: AdaptiveNutritionConfidence,
  sufficiency: AdaptiveNutritionEvaluation['dataSufficiency'],
  trend: AdaptiveNutritionEvaluation['trend'],
  reason: AdaptiveNutritionReason,
): AdaptiveNutritionEvaluation {
  return {
    action: 'hold',
    confidence,
    dataSufficiency: sufficiency,
    trend,
    recommendation: {
      direction: 'hold',
      currentCaloriesKcal,
      suggestedCaloriesKcal: currentCaloriesKcal,
      adjustmentKcal: 0,
      reason,
      requiresUserConfirmation: true,
    },
  };
}

function dataSufficiency(
  sufficient: boolean,
  daysEvaluated: number,
  weeks: WeeklyAggregate[],
  issues: AdaptiveNutritionDataIssue[],
): AdaptiveNutritionEvaluation['dataSufficiency'] {
  return {
    sufficient,
    daysEvaluated,
    completeWeeks: weeks.filter(hasMinimumCoverage).length,
    weightDays: weeks.reduce((total, week) => total + week.weightDays, 0),
    calorieDays: weeks.reduce((total, week) => total + week.calorieDays, 0),
    proteinDays: weeks.reduce((total, week) => total + week.proteinDays, 0),
    issues,
  };
}

function highConfidence(weeks: WeeklyAggregate[], weeklyCalories: number[]): boolean {
  return weeks.length === MAX_WEEKS
    && weeks.every((week) => week.weightDays >= 5 && week.calorieDays >= 6 && week.proteinDays >= 6)
    && relativeSpreadPercent(weeklyCalories) <= 6;
}

function hasMinimumCoverage(week: WeeklyAggregate): boolean {
  return week.weightDays >= MIN_WEIGHT_DAYS_PER_WEEK
    && week.calorieDays >= MIN_NUTRITION_DAYS_PER_WEEK
    && week.proteinDays >= MIN_NUTRITION_DAYS_PER_WEEK;
}

function theilSenWeeklySlope(values: number[]): number {
  const slopes: number[] = [];
  for (let start = 0; start < values.length - 1; start += 1) {
    for (let end = start + 1; end < values.length; end += 1) {
      slopes.push((values[end]! - values[start]!) / (end - start));
    }
  }
  return slopes.length ? median(slopes) : 0;
}

function relativeSpreadPercent(values: number[]): number {
  if (values.length < 2) return 0;
  const center = median(values);
  return center > 0 ? (Math.max(...values) - Math.min(...values)) / center * 100 : 0;
}

function parseDateKey(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? Math.floor(timestamp / DAY_MS)
    : null;
}

function validRange(value: number | null, minimum: number, maximum: number): boolean {
  return value != null && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
