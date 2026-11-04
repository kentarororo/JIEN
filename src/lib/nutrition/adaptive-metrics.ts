import {
  buildSmoothedBodyWeightTrend,
  type SmoothedBodyWeightTrend,
} from '@/lib/wellness/body-trend';

import {
  isPlausibleCompleteDay,
  type AdaptiveNutritionHistoryDay,
} from './adaptive-targets';

export const EXPENDITURE_ENERGY_DENSITY_KCAL_PER_KG = 7_700;
export const EXPENDITURE_WINDOW_DAYS = 28;
export const EXPENDITURE_REQUIRED_COMPLETE_DAYS = 14;
export const EXPENDITURE_REQUIRED_WEIGHT_DAYS = 7;
export const EXPENDITURE_REQUIRED_SPAN_DAYS = 21;

export type ExpenditureEstimate = {
  ready: boolean;
  estimateKcal: number | null;
  rangeLowKcal: number | null;
  rangeHighKcal: number | null;
  confidence: 'insufficient' | 'medium' | 'high';
  completeDays: number;
  requiredCompleteDays: number;
  weightDays: number;
  requiredWeightDays: number;
  spanDays: number;
  requiredSpanDays: number;
  averageIntakeKcal: number | null;
  trendChangeKg: number | null;
};

export type AdaptiveNutritionMetrics = {
  bodyTrend: SmoothedBodyWeightTrend;
  expenditure: ExpenditureEstimate;
};

type NormalizedDay = {
  date: string;
  dayNumber: number;
  bodyWeightKg: number | null;
  caloriesKcal: number | null;
};

/**
 * Derives display-only trend weight and expenditure from local history. The function
 * is pure and never changes a target or treats a missing food day as zero intake.
 */
export function buildAdaptiveNutritionMetrics(
  history: AdaptiveNutritionHistoryDay[],
): AdaptiveNutritionMetrics {
  const days = normalizeDays(history);
  const bodyTrend = buildSmoothedBodyWeightTrend(days
    .filter((day): day is NormalizedDay & { bodyWeightKg: number } => day.bodyWeightKg != null)
    .map((day) => ({
      id: `weight-${day.date}`,
      loggedAt: `${day.date}T12:00:00`,
      bodyWeightKg: day.bodyWeightKg,
    })));

  if (!days.length) return { bodyTrend, expenditure: insufficientExpenditure(0, 0, 0, null) };

  const latestDay = days.at(-1)!.dayNumber;
  const windowStart = latestDay - EXPENDITURE_WINDOW_DAYS + 1;
  const windowDays = days.filter((day) => day.dayNumber >= windowStart);
  const completeIntakes = windowDays
    .map((day) => day.caloriesKcal)
    .filter((value): value is number => value != null);
  const trendPoints = bodyTrend.points.filter((point) => {
    const dayNumber = parseDateKey(point.date);
    return dayNumber != null && dayNumber >= windowStart && dayNumber <= latestDay;
  });
  const firstTrend = trendPoints[0] ?? null;
  const lastTrend = trendPoints.at(-1) ?? null;
  const firstTrendDay = firstTrend ? parseDateKey(firstTrend.date) : null;
  const lastTrendDay = lastTrend ? parseDateKey(lastTrend.date) : null;
  const spanDays = firstTrendDay != null && lastTrendDay != null ? lastTrendDay - firstTrendDay : 0;
  const averageIntakeKcal = completeIntakes.length ? mean(completeIntakes) : null;

  if (completeIntakes.length < EXPENDITURE_REQUIRED_COMPLETE_DAYS
    || trendPoints.length < EXPENDITURE_REQUIRED_WEIGHT_DAYS
    || spanDays < EXPENDITURE_REQUIRED_SPAN_DAYS
    || averageIntakeKcal == null
    || !firstTrend
    || !lastTrend) {
    return {
      bodyTrend,
      expenditure: insufficientExpenditure(
        completeIntakes.length,
        trendPoints.length,
        spanDays,
        averageIntakeKcal,
      ),
    };
  }

  const trendChangeKg = lastTrend.trendKg - firstTrend.trendKg;
  const dailyWeightChangeKg = trendChangeKg / spanDays;
  const rawEstimate = averageIntakeKcal
    - dailyWeightChangeKg * EXPENDITURE_ENERGY_DENSITY_KCAL_PER_KG;
  if (!Number.isFinite(rawEstimate) || rawEstimate < 800 || rawEstimate > 6_000) {
    return {
      bodyTrend,
      expenditure: insufficientExpenditure(
        completeIntakes.length,
        trendPoints.length,
        spanDays,
        averageIntakeKcal,
        trendChangeKg,
      ),
    };
  }

  const intakeNoise = robustSpread(completeIntakes) / Math.sqrt(completeIntakes.length);
  const weightResiduals = trendPoints.map((point) => Math.abs(point.bodyWeightKg - point.trendKg));
  const weightNoise = median(weightResiduals) * EXPENDITURE_ENERGY_DENSITY_KCAL_PER_KG / spanDays;
  const missingDayPenalty = (EXPENDITURE_WINDOW_DAYS - completeIntakes.length)
    / EXPENDITURE_WINDOW_DAYS * 100;
  const halfWidth = clamp(roundTo25(intakeNoise + weightNoise + missingDayPenalty), 100, 500);
  const estimateKcal = roundTo25(rawEstimate);
  const confidence = completeIntakes.length >= 21 && trendPoints.length >= 14 && spanDays >= 27
    ? 'high' as const
    : 'medium' as const;

  return {
    bodyTrend,
    expenditure: {
      ready: true,
      estimateKcal,
      rangeLowKcal: Math.max(800, estimateKcal - halfWidth),
      rangeHighKcal: Math.min(6_000, estimateKcal + halfWidth),
      confidence,
      completeDays: completeIntakes.length,
      requiredCompleteDays: EXPENDITURE_REQUIRED_COMPLETE_DAYS,
      weightDays: trendPoints.length,
      requiredWeightDays: EXPENDITURE_REQUIRED_WEIGHT_DAYS,
      spanDays,
      requiredSpanDays: EXPENDITURE_REQUIRED_SPAN_DAYS,
      averageIntakeKcal: Math.round(averageIntakeKcal),
      trendChangeKg: round(trendChangeKg, 2),
    },
  };
}

function normalizeDays(history: AdaptiveNutritionHistoryDay[]): NormalizedDay[] {
  const grouped = new Map<number, {
    date: string;
    weights: number[];
    completeCalories: number[];
  }>();
  for (const row of history) {
    const dayNumber = parseDateKey(row.date);
    if (dayNumber == null) continue;
    const day = grouped.get(dayNumber) ?? { date: row.date, weights: [], completeCalories: [] };
    if (row.bodyWeightKg != null && Number.isFinite(row.bodyWeightKg)
      && row.bodyWeightKg >= 20 && row.bodyWeightKg <= 500) {
      day.weights.push(row.bodyWeightKg);
    }
    if (row.dayState === 'complete' && isPlausibleCompleteDay(row.caloriesKcal)) {
      day.completeCalories.push(row.caloriesKcal!);
    }
    grouped.set(dayNumber, day);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([dayNumber, day]) => ({
      date: day.date,
      dayNumber,
      bodyWeightKg: day.weights.length ? median(day.weights) : null,
      caloriesKcal: day.completeCalories.length ? median(day.completeCalories) : null,
    }));
}

function insufficientExpenditure(
  completeDays: number,
  weightDays: number,
  spanDays: number,
  averageIntakeKcal: number | null,
  trendChangeKg: number | null = null,
): ExpenditureEstimate {
  return {
    ready: false,
    estimateKcal: null,
    rangeLowKcal: null,
    rangeHighKcal: null,
    confidence: 'insufficient',
    completeDays,
    requiredCompleteDays: EXPENDITURE_REQUIRED_COMPLETE_DAYS,
    weightDays,
    requiredWeightDays: EXPENDITURE_REQUIRED_WEIGHT_DAYS,
    spanDays,
    requiredSpanDays: EXPENDITURE_REQUIRED_SPAN_DAYS,
    averageIntakeKcal: averageIntakeKcal == null ? null : Math.round(averageIntakeKcal),
    trendChangeKg: trendChangeKg == null ? null : round(trendChangeKg, 2),
  };
}

function parseDateKey(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(timestamp / 86_400_000);
}

function robustSpread(values: number[]): number {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center))) * 1.4826;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function roundTo25(value: number): number {
  return Math.round(value / 25) * 25;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
