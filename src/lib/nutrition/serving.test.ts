import assert from 'node:assert/strict';
import test from 'node:test';

import {
  convertServingQuantity,
  scaleServingMacros,
  servingScale,
  servingUnitOptions,
} from './serving.ts';

test('scales food macros when the portion changes', () => {
  const scale = servingScale(150, 'g', 100, 'g');
  assert.equal(scale, 1.5);
  assert.deepEqual(
    scaleServingMacros(
      { caloriesKcal: 100, proteinG: 10, carbohydrateG: 5, fatG: 2, fibreG: 1 },
      scale!,
    ),
    { caloriesKcal: 150, proteinG: 15, carbohydrateG: 7.5, fatG: 3, fibreG: 1.5 },
  );
});

test('converts compatible units without changing the physical portion', () => {
  assert.ok(Math.abs(convertServingQuantity(100, 'g', 'oz')! - 3.527396) < 0.0001);
  assert.equal(servingScale(1, 'kg', 100, 'g'), 10);
  assert.equal(servingScale(1, 'cup', 100, 'g'), null);
  assert.deepEqual(servingUnitOptions('ml'), ['ml', 'l', 'cup', 'tbsp', 'tsp']);
});
