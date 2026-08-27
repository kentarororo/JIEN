import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapOpenFoodFactsSearchResponse,
  searchOpenFoodFactsFoods,
} from './open-food-facts-search.ts';

const payload = {
  hits: [{
    code: 'global-1',
    product_name: 'Global soy drink',
    brands: ['Global'],
    countries_tags: ['en:australia'],
    nutriments: { 'energy-kcal_100g': 40, proteins_100g: 3, carbohydrates_100g: 4, fat_100g: 1.5 },
  }, {
    code: 'sg-1',
    product_name: 'Singapore soy drink',
    brands: ['Local', 'Brand'],
    countries_tags: ['en:singapore'],
    nutriments: { 'energy-kcal_100g': 48, proteins_100g: 3.2, carbohydrates_100g: 5, fat_100g: 2 },
  }],
};

test('maps Search-a-licious results and prioritizes Singapore-tagged products', () => {
  const items = mapOpenFoodFactsSearchResponse(payload);
  assert.equal(items[0]?.name, 'Singapore soy drink');
  assert.equal(items[0]?.brand, 'Local, Brand');
  assert.equal(items[0]?.source, 'open_food_facts');
  assert.equal(items[0]?.sourceRef, 'sg-1');
  assert.equal(items[1]?.name, 'Global soy drink');
});

test('uses the privacy-preserving POST search contract with bounded fields', async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({ input: String(input), init });
    return Response.json(payload);
  };

  const items = await searchOpenFoodFactsFoods('soy drink', fakeFetch);
  assert.equal(items.length, 2);
  assert.equal(requests[0]?.input, 'https://search.openfoodfacts.org/search');
  assert.equal(requests[0]?.init?.method, 'POST');
  const body = JSON.parse(String(requests[0]?.init?.body));
  assert.equal(body.q, 'soy drink');
  assert.equal(body.page_size, 24);
  assert.ok(body.fields.includes('countries_tags'));
});
