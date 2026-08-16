import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateStartingNutritionTarget } from './targets.ts';
import {
  evaluateAdaptiveNutritionTarget,
  type AdaptiveNutritionHistoryDay,
} from './adaptive-targets.ts';

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
      bodyWeightKg: weeklyWeightKg[week]! + dailyOffsets[index % 7]!,
      caloriesKcal: options.weeklyCalories?.[week] ?? options.caloriesKcal ?? 2_400,
      proteinG: options.proteinG ?? 160,
    };
  });
}
