import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateStartingNutritionTarget } from './targets.ts';
import {
  evaluateAdaptiveNutritionTarget,
  isPlausibleCompleteDay,
  MIN_PLAUSIBLE_COMPLETE_DAY_KCAL,
  type AdaptiveNutritionHistoryDay,
} from './adaptive-targets.ts';
import {
  buildAdaptiveNutritionMetrics,
  EXPENDITURE_ENERGY_DENSITY_KCAL_PER_KG,
} from './adaptive-metrics.ts';
import { buildWeeklyNutritionCheckIn } from './weekly-check-in.ts';
import type { NutritionTarget } from '../db/types.ts';

test('creates an editable starting target from weight and goal', () => {
  assert.deepEqual(calculateStartingNutritionTarget({ bodyWeightKg: 80, goals: ['composition'] }), {
    caloriesKcal: 2240,
    proteinG: 144,
    carbohydrateG: 272,
    fatG: 64,
    fibreG: 31,
  });
});

test('uses a higher starting energy budget for strength', () => {
  const composition = calculateStartingNutritionTarget({ bodyWeightKg: 70, goals: ['composition'] });
  const strength = calculateStartingNutritionTarget({ bodyWeightKg: 70, goals: ['strength'] });
  assert.ok(strength.caloriesKcal > composition.caloriesKcal);
});

test('treats separate strength and composition goals as a combined goal', () => {
  const combined = calculateStartingNutritionTarget({
    bodyWeightKg: 80,
    goals: ['strength', 'composition'],
  });

  assert.equal(combined.caloriesKcal, 2400);
});

test('holds with explicit insufficiency when recent logging coverage is too sparse', () => {
  const result = evaluateAdaptiveNutritionTarget({
    currentCaloriesKcal: 2_400,
    currentProteinTargetG: 150,
    desiredWeeklyWeightChangePercent: -0.5,
    history: buildHistory([80, 79.8], { days: 14 }),
  });

  assert.equal(result.action, 'hold');
  assert.equal(result.confidence, 'insufficient');
  assert.equal(result.dataSufficiency.sufficient, false);
  assert.ok(result.dataSufficiency.completeWeeks < 3);
  assert.ok(result.dataSufficiency.issues.includes('history_too_short'));
  assert.equal(result.recommendation.adjustmentKcal, 0);
});

test('uses weekly medians and a robust slope instead of reacting to one weight outlier', () => {
  const history = buildHistory([80, 79.9, 79.8, 79.7]);
  history[24]!.bodyWeightKg = 95;
  const result = evaluateAdaptiveNutritionTarget({
    currentCaloriesKcal: 2_400,
    currentProteinTargetG: 150,
    desiredWeeklyWeightChangePercent: -0.5,
    history,
  });

  assert.equal(result.action, 'recommend_adjustment');
  assert.equal(result.confidence, 'high');
  assert.equal(result.recommendation.direction, 'decrease');
  assert.equal(result.recommendation.requiresUserConfirmation, true);
  assert.ok(result.recommendation.adjustmentKcal < 0);
  assert.ok(Math.abs(result.recommendation.adjustmentKcal) <= 150);
  assert.ok(Math.abs(result.recommendation.adjustmentKcal) <= 2_400 * 0.06);
  assert.ok((result.trend.weeklyMedianWeightsKg.at(-1) ?? 0) < 81);
  assert.equal(result.trend.proteinSignal, 'generally_met');
});

test('holds when the smoothed trend is already within the desired range', () => {
  const result = evaluateAdaptiveNutritionTarget({
    currentCaloriesKcal: 2_300,
    currentProteinTargetG: 145,
    desiredWeeklyWeightChangePercent: -0.5,
    history: buildHistory([80, 79.6, 79.2, 78.8], { caloriesKcal: 2_300 }),
  });

  assert.equal(result.action, 'hold');
  assert.equal(result.recommendation.reason, 'within_desired_range');
  assert.equal(result.recommendation.suggestedCaloriesKcal, 2_300);
  assert.equal(result.dataSufficiency.sufficient, true);
});

test('holds at low confidence when recent weekly changes disagree with the smoothed direction', () => {
  const result = evaluateAdaptiveNutritionTarget({
    currentCaloriesKcal: 2_400,
    currentProteinTargetG: 150,
    desiredWeeklyWeightChangePercent: -0.5,
    history: buildHistory([80, 79.5, 79.2, 79.4]),
  });

  assert.equal(result.action, 'hold');
  assert.equal(result.confidence, 'low');
  assert.equal(result.recommendation.reason, 'weight_trend_unstable');
});

test('holds when weekly calorie averages are too inconsistent for attribution', () => {
  const result = evaluateAdaptiveNutritionTarget({
    currentCaloriesKcal: 2_400,
    currentProteinTargetG: 150,
    desiredWeeklyWeightChangePercent: 0,
    history: buildHistory([80, 80.1, 80.2, 80.3], { weeklyCalories: [1_800, 2_600, 1_900, 2_700] }),
  });

  assert.equal(result.action, 'hold');
  assert.equal(result.confidence, 'insufficient');
  assert.ok(result.dataSufficiency.issues.includes('calorie_pattern_inconsistent'));
});

test('requires protein logging coverage but never invents a protein target change', () => {
  const history = buildHistory([80, 79.9, 79.8, 79.7]);
  for (let index = 0; index < history.length; index += 1) {
    if (index % 7 >= 3) history[index]!.proteinG = null;
  }
  const result = evaluateAdaptiveNutritionTarget({
    currentCaloriesKcal: 2_400,
    currentProteinTargetG: 150,
    desiredWeeklyWeightChangePercent: -0.5,
    history,
  });

  assert.equal(result.action, 'hold');
  assert.equal(result.confidence, 'insufficient');
  assert.ok(result.dataSufficiency.issues.includes('protein_coverage_low'));
  assert.equal(result.recommendation.suggestedCaloriesKcal, 2_400);
});

test('excludes partial food days from intake coverage and averages', () => {
  const history = buildHistory([80, 79.9, 79.8, 79.7]);
  history[3] = { ...history[3]!, dayState: 'partial', caloriesKcal: 12_000, proteinG: 900 };
  const result = evaluateAdaptiveNutritionTarget({
    currentCaloriesKcal: 2_400,
    currentProteinTargetG: 150,
    desiredWeeklyWeightChangePercent: -0.5,
    history,
  });

  assert.equal(result.dataSufficiency.sufficient, true);
  assert.equal(result.dataSufficiency.completeDays, 27);
  assert.equal(result.dataSufficiency.calorieDays, 27);
  assert.equal(result.trend.robustAverageCaloriesKcal, 2_400);
  assert.equal(result.trend.robustAverageProteinG, 160);
});

test('counts body weight from partial food days while reporting too few complete days', () => {
  const history = buildHistory([80, 79.9, 79.8], { days: 21 });
  for (let index = 0; index < history.length; index += 1) {
    if (index % 7 < 4) history[index] = { ...history[index]!, dayState: 'partial' };
  }
  const result = evaluateAdaptiveNutritionTarget({
    currentCaloriesKcal: 2_400,
    currentProteinTargetG: 150,
    desiredWeeklyWeightChangePercent: -0.5,
    history,
  });

  assert.equal(result.dataSufficiency.weightDays, 21);
  assert.equal(result.dataSufficiency.completeDays, 9);
  assert.ok(result.dataSufficiency.issues.includes('complete_day_coverage_low'));
  assert.equal(result.dataSufficiency.issues.includes('weight_coverage_low'), false);
});

test('does not turn a not-logged day into a zero-calorie observation', () => {
  const history = buildHistory([80, 79.9, 79.8, 79.7]);
  for (let index = 0; index < history.length; index += 7) {
    history[index] = { ...history[index]!, dayState: 'not_logged', caloriesKcal: 0, proteinG: 0 };
  }
  const result = evaluateAdaptiveNutritionTarget({
    currentCaloriesKcal: 2_400,
    currentProteinTargetG: 150,
    desiredWeeklyWeightChangePercent: -0.5,
    history,
  });

  assert.equal(result.dataSufficiency.sufficient, true);
  assert.equal(result.dataSufficiency.calorieDays, 24);
  assert.equal(result.trend.robustAverageCaloriesKcal, 2_400);
});

test('excludes empty and implausibly low Complete days from nutrition coverage and averages', () => {
  assert.equal(MIN_PLAUSIBLE_COMPLETE_DAY_KCAL, 800);
  assert.equal(isPlausibleCompleteDay(null), false);
  assert.equal(isPlausibleCompleteDay(MIN_PLAUSIBLE_COMPLETE_DAY_KCAL - 1), false);
  assert.equal(isPlausibleCompleteDay(MIN_PLAUSIBLE_COMPLETE_DAY_KCAL), true);

  const history = buildHistory([80, 79.9, 79.8, 79.7]);
  history[2] = { ...history[2]!, caloriesKcal: null, proteinG: null };
  history[9] = { ...history[9]!, caloriesKcal: MIN_PLAUSIBLE_COMPLETE_DAY_KCAL - 1, proteinG: 900 };
  const result = evaluateAdaptiveNutritionTarget({
    currentCaloriesKcal: 2_400,
    currentProteinTargetG: 150,
    desiredWeeklyWeightChangePercent: -0.5,
    history,
  });

  assert.equal(result.dataSufficiency.sufficient, true);
  assert.equal(result.dataSufficiency.completeDays, 26);
  assert.equal(result.dataSufficiency.calorieDays, 26);
  assert.equal(result.dataSufficiency.proteinDays, 26);
  assert.equal(result.trend.robustAverageCaloriesKcal, 2_400);
  assert.equal(result.trend.robustAverageProteinG, 160);
});

test('caps a large recommendation by both 150 kcal and six percent of the current target', () => {
  const result = evaluateAdaptiveNutritionTarget({
    currentCaloriesKcal: 2_000,
    currentProteinTargetG: 140,
    desiredWeeklyWeightChangePercent: -0.5,
    history: buildHistory([80, 81, 82, 83], { caloriesKcal: 2_000 }),
  });

  assert.equal(result.action, 'recommend_adjustment');
  assert.equal(result.recommendation.adjustmentKcal, -120);
  assert.equal(result.recommendation.suggestedCaloriesKcal, 1_880);
});

function buildHistory(
  weeklyWeightKg: number[],
  options: {
    days?: number;
    caloriesKcal?: number;
    weeklyCalories?: number[];
    proteinG?: number;
  } = {},
): AdaptiveNutritionHistoryDay[] {
  const days = options.days ?? weeklyWeightKg.length * 7;
  const start = Date.UTC(2026, 6, 20);
  const dailyOffsets = [-0.08, -0.04, 0, 0.04, 0.08, -0.02, 0.02];
  return Array.from({ length: days }, (_, index) => {
    const week = Math.min(Math.floor(index / 7), weeklyWeightKg.length - 1);
    return {
      date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      dayState: 'complete',
      bodyWeightKg: weeklyWeightKg[week]! + dailyOffsets[index % 7]!,
      caloriesKcal: options.weeklyCalories?.[week] ?? options.caloriesKcal ?? 2_400,
      proteinG: options.proteinG ?? 160,
    };
  });
}

// ---------------------------------------------------------------------------
// #19 AC5: synthetic 4-8 week datasets for trend weight, expenditure and the
// weekly check-in. Each scenario has a known "true" maintenance intake so the
// estimate can be checked against physics, not against the implementation.
// ---------------------------------------------------------------------------

type Scenario = {
  weeks: number;
  intakeKcal: number;
  weeklyChangeKg: number;
  startKg?: number;
  weightNoiseKg?: number;
  intakeNoiseKcal?: number;
  /** Returns how a day is logged; default is a weigh-in and a Complete food day. */
  logging?: (index: number, random: () => number) => { weighIn: boolean; dayState: AdaptiveNutritionHistoryDay['dayState'] };
  seed?: number;
};

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function syntheticHistory(scenario: Scenario): AdaptiveNutritionHistoryDay[] {
  const random = seededRandom(scenario.seed ?? 19);
  const start = Date.UTC(2026, 7, 3);
  const noise = (amplitude = 0) => (random() * 2 - 1) * amplitude;
  return Array.from({ length: scenario.weeks * 7 }, (_, index) => {
    const logging = scenario.logging?.(index, random) ?? { weighIn: true, dayState: 'complete' as const };
    const trueKg = (scenario.startKg ?? 80) + scenario.weeklyChangeKg * index / 7;
    const complete = logging.dayState === 'complete';
    return {
      date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      dayState: logging.dayState,
      bodyWeightKg: logging.weighIn ? Math.round((trueKg + noise(scenario.weightNoiseKg)) * 10) / 10 : null,
      caloriesKcal: complete ? Math.round(scenario.intakeKcal + noise(scenario.intakeNoiseKcal)) : null,
      proteinG: complete ? 160 : null,
    };
  });
}

function trueExpenditureKcal(scenario: Scenario): number {
  return scenario.intakeKcal - scenario.weeklyChangeKg / 7 * EXPENDITURE_ENERGY_DENSITY_KCAL_PER_KG;
}

function assertEstimateMatchesTruth(scenario: Scenario, toleranceKcal: number) {
  const { expenditure } = buildAdaptiveNutritionMetrics(syntheticHistory(scenario));
  const truth = trueExpenditureKcal(scenario);
  assert.equal(expenditure.ready, true, 'enough history produces an estimate');
  assert.ok(expenditure.estimateKcal != null && expenditure.rangeLowKcal != null && expenditure.rangeHighKcal != null);
  assert.ok(Math.abs(expenditure.estimateKcal - truth) <= toleranceKcal,
    `estimate ${expenditure.estimateKcal} within ${toleranceKcal} kcal of true ${truth}`);
  assert.ok(expenditure.rangeLowKcal <= truth && truth <= expenditure.rangeHighKcal,
    `true ${truth} inside ${expenditure.rangeLowKcal}-${expenditure.rangeHighKcal}`);
  assert.equal(expenditure.estimateKcal % 25, 0, 'rounded to 25 kcal');
  const halfWidth = (expenditure.rangeHighKcal - expenditure.rangeLowKcal) / 2;
  assert.ok(halfWidth >= 100 && halfWidth <= 500, 'range half-width is bounded to 100-500 kcal');
  return expenditure;
}

const STABLE: Scenario = { weeks: 6, intakeKcal: 2_500, weeklyChangeKg: 0 };
const CUTTING: Scenario = { weeks: 6, intakeKcal: 2_000, weeklyChangeKg: -0.5 };
const GAINING: Scenario = { weeks: 8, intakeKcal: 3_000, weeklyChangeKg: 0.25 };
const NOISY: Scenario = { weeks: 6, intakeKcal: 2_500, weeklyChangeKg: 0, weightNoiseKg: 0.8, intakeNoiseKcal: 400, seed: 7 };
const GAPPY: Scenario = {
  weeks: 6,
  intakeKcal: 2_200,
  weeklyChangeKg: -0.25,
  // Every third day has no weigh-in; each week has one partial and one forgotten
  // (not-logged) food day, which must be excluded rather than counted as 0 kcal.
  logging: (index) => ({
    weighIn: index % 3 !== 1,
    dayState: index % 7 === 2 ? 'partial' : index % 7 === 5 ? 'not_logged' : 'complete',
  }),
};

test('AC5 stable: 6 weeks at maintenance gives a flat trend and expenditure equal to intake, high confidence', () => {
  const metrics = buildAdaptiveNutritionMetrics(syntheticHistory(STABLE));
  assert.equal(metrics.bodyTrend.trendWeightReady, true);
  assert.ok(Math.abs(metrics.bodyTrend.latestTrendKg! - 80) < 0.05);
  const expenditure = assertEstimateMatchesTruth(STABLE, 50);
  assert.equal(expenditure.confidence, 'high');
  assert.equal(expenditure.completeDays, 28);
});

test('AC5 cutting: 6 weeks at 2,000 kcal losing 0.5 kg/week estimates ~2,550 kcal', () => {
  const metrics = buildAdaptiveNutritionMetrics(syntheticHistory(CUTTING));
  // Trend follows the loss but lags the newest raw weigh-in (smoothing, not echoing).
  const latest = metrics.bodyTrend.points.at(-1)!;
  assert.ok(latest.trendKg > latest.bodyWeightKg);
  assert.ok(latest.trendKg < 80 - 2, 'trend has moved down most of the 3 kg lost');
  assert.ok(metrics.expenditure.trendChangeKg! < 0);
  assertEstimateMatchesTruth(CUTTING, 150);
});

test('AC5 gaining: 8 weeks at 3,000 kcal gaining 0.25 kg/week estimates ~2,725 kcal', () => {
  const metrics = buildAdaptiveNutritionMetrics(syntheticHistory(GAINING));
  assert.ok(metrics.expenditure.trendChangeKg! > 0);
  assert.equal(metrics.expenditure.confidence, 'high');
  assertEstimateMatchesTruth(GAINING, 100);
});

test('AC5 noisy: ±0.8 kg scale noise and ±400 kcal intake noise still land near truth with a wider range', () => {
  const noisy = assertEstimateMatchesTruth(NOISY, 150);
  const clean = buildAdaptiveNutritionMetrics(syntheticHistory(STABLE)).expenditure;
  assert.ok(noisy.rangeHighKcal! - noisy.rangeLowKcal! > clean.rangeHighKcal! - clean.rangeLowKcal!,
    'noisier input widens the range');
  const trend = buildAdaptiveNutritionMetrics(syntheticHistory(NOISY)).bodyTrend;
  const rawSpread = Math.max(...trend.points.map((point) => point.bodyWeightKg)) - Math.min(...trend.points.map((point) => point.bodyWeightKg));
  const trendSpread = Math.max(...trend.points.slice(7).map((point) => point.trendKg)) - Math.min(...trend.points.slice(7).map((point) => point.trendKg));
  assert.ok(trendSpread < rawSpread / 2, 'smoothing removes most day-to-day scale noise');
});

test('AC5 gappy: partial and forgotten days are excluded, never treated as 0 kcal', () => {
  const history = syntheticHistory(GAPPY);
  const expenditure = assertEstimateMatchesTruth(GAPPY, 150);
  assert.equal(expenditure.completeDays, 20, '4 weeks × 5 Complete days in the 28-day window');
  assert.equal(expenditure.confidence, 'medium', 'fewer than 21 Complete days is medium confidence');
  assert.equal(expenditure.averageIntakeKcal, 2_200, 'missing days do not drag average intake down');
  // Same data but with the gaps logged as Complete 0 kcal days: still excluded (<800 kcal guard).
  const zeroed = history.map((day) => day.dayState === 'complete' ? day : { ...day, dayState: 'complete' as const, caloriesKcal: 0 });
  assert.equal(buildAdaptiveNutritionMetrics(zeroed).expenditure.averageIntakeKcal, 2_200);
});

test('AC3: thin data shows "need more data" progress instead of a precise number', () => {
  const tenDays = syntheticHistory({ ...STABLE, weeks: 4 }).slice(0, 10);
  const metrics = buildAdaptiveNutritionMetrics(tenDays);
  assert.equal(metrics.expenditure.ready, false);
  assert.equal(metrics.expenditure.confidence, 'insufficient');
  assert.equal(metrics.expenditure.estimateKcal, null);
  assert.equal(metrics.expenditure.rangeLowKcal, null);
  assert.deepEqual([metrics.expenditure.completeDays, metrics.expenditure.requiredCompleteDays], [10, 14]);
  const fourWeighIns = syntheticHistory(STABLE).slice(0, 4);
  const trend = buildAdaptiveNutritionMetrics(fourWeighIns).bodyTrend;
  assert.equal(trend.trendWeightReady, false);
  assert.equal(trend.latestTrendKg, null);
  assert.deepEqual([trend.trendWeightDays, trend.trendWeightRequiredDays], [4, 7]);
  assert.equal(buildAdaptiveNutritionMetrics([]).expenditure.confidence, 'insufficient');
});

const checkInTarget = (overrides: Partial<NutritionTarget> = {}): NutritionTarget => ({
  id: 'target-1',
  effectiveFrom: '2026-08-03',
  caloriesKcal: 2_500,
  proteinG: 160,
  carbohydrateG: 300,
  fatG: 70,
  fibreG: 30,
  desiredWeeklyWeightChangePercent: -0.5,
  weeklyCheckInDay: 1,
  ...overrides,
});
// 2026-09-14 is a Monday (weekday 1), the day after the 6-week datasets end.
const CHECK_IN_MONDAY = new Date(2026, 8, 14, 9);

function weeklyCheckIn(scenario: Scenario, target: NutritionTarget, today = CHECK_IN_MONDAY) {
  const evaluation = evaluateAdaptiveNutritionTarget({
    currentCaloriesKcal: target.caloriesKcal,
    currentProteinTargetG: target.proteinG,
    desiredWeeklyWeightChangePercent: target.desiredWeeklyWeightChangePercent,
    history: syntheticHistory(scenario),
  });
  return buildWeeklyNutritionCheckIn(target, evaluation, today);
}

test('AC4 check-in: stable weight while aiming to cut proposes a capped decrease, protein unchanged, target untouched', () => {
  const target = checkInTarget();
  const before = structuredClone(target);
  const checkIn = weeklyCheckIn(STABLE, target);
  assert.equal(checkIn.state, 'ready');
  assert.ok(checkIn.suggestedCaloriesKcal < 2_500);
  assert.ok(2_500 - checkIn.suggestedCaloriesKcal <= 150, 'step capped at 150 kcal');
  assert.equal(checkIn.suggestedProteinG, 160);
  assert.deepEqual(target, before, 'building the card never mutates the saved target');
});

test('AC4 check-in: cutting on pace holds; gaining while aiming to gain holds', () => {
  // -0.5 kg/week at ~79 kg is ~-0.63%/week, inside the band around -0.5%.
  assert.equal(weeklyCheckIn(CUTTING, checkInTarget({ caloriesKcal: 2_000 })).state, 'hold');
  const gain = weeklyCheckIn({ ...GAINING, weeks: 6 }, checkInTarget({ caloriesKcal: 3_000, desiredWeeklyWeightChangePercent: 0.3 }));
  assert.equal(gain.state, 'hold');
  assert.equal(gain.suggestedCaloriesKcal, 3_000);
});

test('AC4 check-in: off, not due, and not enough data never propose a change', () => {
  assert.equal(weeklyCheckIn(STABLE, checkInTarget({ weeklyCheckInDay: null })).state, 'off');
  assert.equal(weeklyCheckIn(STABLE, checkInTarget(), new Date(2026, 8, 15, 9)).state, 'not_due');
  const thin = weeklyCheckIn({ ...STABLE, weeks: 2 }, checkInTarget());
  assert.equal(thin.state, 'need_more_data');
  assert.equal(thin.suggestedCaloriesKcal, 2_500);
});
