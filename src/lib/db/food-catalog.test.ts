import assert from 'node:assert/strict';
import test from 'node:test';

import { mapOpenFoodFactsProduct } from './open-food-facts.ts';

test('maps serving nutrition from Open Food Facts', () => {
  const item = mapOpenFoodFactsProduct({
    code: '12345678',
    product_name: 'Protein yogurt',
    brands: 'Example',
    serving_quantity: 170,
    serving_quantity_unit: 'g',
    nutriments: {
      'energy-kcal_serving': 120,
      proteins_serving: 18,
      carbohydrates_serving: 8,
      fat_serving: 2,
      fiber_serving: 1,
    },
  });

  assert.equal(item?.servingQuantity, 170);
  assert.equal(item?.servingUnit, 'g');
  assert.equal(item?.caloriesKcal, 120);
  assert.equal(item?.source, 'open_food_facts');
});

test('falls back to nutrition per 100 g and converts kilojoules', () => {
  const item = mapOpenFoodFactsProduct({
    code: '87654321',
    product_name: 'Rice crackers',
    nutriments: {
      'energy-kj_100g': 1673.6,
      proteins_100g: 8,
      carbohydrates_100g: 80,
      fat_100g: 4,
    },
  });

  assert.equal(item?.servingQuantity, 100);
  assert.equal(item?.servingUnit, 'g');
  assert.ok(Math.abs((item?.caloriesKcal ?? 0) - 400) < 0.0001);
});
