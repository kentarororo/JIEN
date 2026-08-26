import assert from 'node:assert/strict';
import test from 'node:test';

import { mapOpenFoodFactsProduct } from './open-food-facts.ts';
import { foodItemsEligibleForDiscoveryCache, parseFoodSearchData } from './food-search-contract.ts';

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

test('accepts normalized licensed FatSecret search results', () => {
  const data = parseFoodSearchData({
    sources: ['fatsecret'],
    items: [{
      id: 'fatsecret-1641-50321',
      name: 'Chicken breast',
      brand: null,
      servingQuantity: 100,
      servingUnit: 'g',
      caloriesKcal: 195,
      proteinG: 29.55,
      carbohydrateG: 0,
      fatG: 7.72,
      fibreG: 0,
      source: 'fatsecret',
      sourceRef: '1641:50321',
      barcode: null,
      confidence: null,
    }],
  });

  assert.equal(data.items[0]?.source, 'fatsecret');
  assert.equal(data.items[0]?.sourceRef, '1641:50321');
});

test('rejects malformed provider food data before it reaches SQLite', () => {
  assert.throws(() => parseFoodSearchData({
    sources: ['fatsecret'],
    items: [{ source: 'fatsecret', name: 'Missing nutrition' }],
  }), /invalid food item/i);
});

test('does not bulk-cache unselected FatSecret search results', () => {
  const fatSecret = parseFoodSearchData({
    sources: ['fatsecret'],
    items: [{
      id: 'fatsecret-1641-50321', name: 'Chicken breast', brand: null,
      servingQuantity: 100, servingUnit: 'g', caloriesKcal: 195, proteinG: 29.55,
      carbohydrateG: 0, fatG: 7.72, fibreG: 0, source: 'fatsecret',
      sourceRef: '1641:50321', barcode: null, confidence: null,
    }],
  }).items[0]!;
  const starter = { ...fatSecret, id: 'starter-rice', source: 'starter' as const };

  assert.deepEqual(foodItemsEligibleForDiscoveryCache([fatSecret, starter]), [starter]);
});
