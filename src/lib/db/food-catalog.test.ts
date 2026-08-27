import assert from 'node:assert/strict';
import test from 'node:test';

import { mapOpenFoodFactsProduct, rankOpenFoodFactsProductsForSingapore } from './open-food-facts.ts';
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

test('maps the brand array returned by Open Food Facts search', () => {
  const item = mapOpenFoodFactsProduct({
    code: '88880001',
    product_name: 'Soy drink',
    brands: ['Example', 'Singapore'],
    nutriments: { 'energy-kcal_100g': 48, proteins_100g: 3, carbohydrates_100g: 5, fat_100g: 2 },
  });

  assert.equal(item?.brand, 'Example, Singapore');
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

test('prioritizes Singapore-tagged Open Food Facts matches without changing provider order otherwise', () => {
  const globalFirst = { code: '1', product_name: 'Global first' };
  const singaporeFirst = { code: '2', product_name: 'Singapore first', countries_tags: ['en:singapore'] };
  const globalSecond = { code: '3', product_name: 'Global second', countries_tags: ['en:malaysia'] };
  const singaporeSecond = { code: '4', product_name: 'Singapore second', countries_tags: ['singapore'] };

  assert.deepEqual(
    rankOpenFoodFactsProductsForSingapore([globalFirst, singaporeFirst, globalSecond, singaporeSecond]),
    [singaporeFirst, singaporeSecond, globalFirst, globalSecond],
  );
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

test('accepts normalized Open Food Facts results from the server search path', () => {
  const data = parseFoodSearchData({
    sources: ['open_food_facts'],
    items: [{
      id: 'off-88880001',
      name: 'Singapore soy drink',
      brand: 'Example',
      servingQuantity: 100,
      servingUnit: 'g',
      caloriesKcal: 48,
      proteinG: 3.2,
      carbohydrateG: 5,
      fatG: 2,
      fibreG: null,
      source: 'open_food_facts',
      sourceRef: '88880001',
      barcode: '88880001',
      confidence: null,
    }],
  });

  assert.equal(data.sources[0], 'open_food_facts');
  assert.equal(data.items[0]?.source, 'open_food_facts');
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
