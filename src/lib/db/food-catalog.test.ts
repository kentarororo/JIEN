import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizePrivateFoodBarcode } from './private-food.ts';
import { parseCommunityFoods } from './community-food-contract.ts';

import { mapOpenFoodFactsProduct, rankOpenFoodFactsProductsForSingapore } from './open-food-facts.ts';
import { foodItemsEligibleForDiscoveryCache, parseFoodSearchData } from './food-search-contract.ts';

test('private barcode identity preserves leading zeros and rejects non-numeric identifiers', () => {
  assert.equal(normalizePrivateFoodBarcode('00 12345678905'), '0012345678905');
  assert.equal(normalizePrivateFoodBarcode(''), null);
  for (const value of ['abc12345678', '123', '123456789012345']) assert.throws(() => normalizePrivateFoodBarcode(value));
});

test('private foods migration grants only owner-scoped read/write and retains account deletion and logical clocks', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261008000100_private_foods.sql', import.meta.url), 'utf8');
  assert.match(sql, /id uuid primary key/);
  assert.match(sql, /references public.users\(id\) on delete cascade/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /revoke all on public.private_foods from public, anon, authenticated/);
  assert.match(sql, /grant select on public.private_foods to authenticated/);
  assert.equal((sql.match(/\(select auth.uid\(\)\) = user_id/g) ?? []).length, 4);
  assert.match(sql, /execute function private.set_updated_at\(\)/);
  assert.doesNotMatch(sql, /for delete|using \(true\)/);
});

test('community discovery is an authenticated, allowlisted projection with withdrawal and server moderation', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261008000100_private_foods.sql', import.meta.url), 'utf8');
  const projection = sql.slice(sql.indexOf('create function public.search_community_foods'));
  assert.match(projection, /security definer set search_path = ''/);
  assert.match(projection, /auth.uid\(\)\) is not null/);
  assert.match(projection, /f.is_shared and not f.community_hidden and f.deleted_at is null/);
  assert.match(projection, /revoke all on function public.search_community_foods\(text, text\) from public, anon/);
  assert.match(projection, /limit 20/);
  const returns = projection.slice(0, projection.indexOf('language sql'));
  assert.doesNotMatch(returns, /user_id|catalog_id|created_at|meal|photo|notes/);
  for (const grant of sql.matchAll(/grant (?:insert|update) \(([^;]+)\) on public.private_foods to authenticated/g)) {
    assert.doesNotMatch(grant[1]!, /community_hidden/);
  }
});

test('community results retain product identity without copying private fields or becoming stale discovery cache', () => {
  const raw = { id: '90000000-0000-4000-8000-000000000002', name: 'Soy drink', brand: 'SG Brand',
    barcode: '0012345678905', serving_quantity: 250, serving_unit: 'ml',
    calories_kcal: 120, protein_g: 10, carbohydrate_g: 12, fat_g: 4, fibre_g: null,
    user_id: 'must-not-copy', notes: 'private', is_verified: true };
  const [food] = parseCommunityFoods([raw]);
  assert.equal(food!.barcode, raw.barcode);
  assert.equal(food!.source, 'community');
  assert.equal(food!.confidence, null);
  assert.equal('user_id' in food!, false);
  assert.equal('notes' in food!, false);
  assert.deepEqual(foodItemsEligibleForDiscoveryCache([food!]), []);
  for (const changed of [{ protein_g: -1 }, { serving_quantity: 0 }, { barcode: '123' }, { id: 'bad' }, { fat_g: Infinity }]) {
    assert.throws(() => parseCommunityFoods([{ ...raw, ...changed }]));
  }
});

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
