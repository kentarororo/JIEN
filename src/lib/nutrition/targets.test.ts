import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateStartingNutritionTarget } from './targets.ts';

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
