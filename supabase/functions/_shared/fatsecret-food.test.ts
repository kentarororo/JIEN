import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapFatSecretSearchResponse,
  resetFatSecretTokenCacheForTests,
  resolveFatSecretConfiguration,
  searchFatSecretFoods,
} from './fatsecret-food.ts';

const searchPayload = {
  foods_search: {
    results: {
      food: [{
        food_id: '50953',
        food_name: 'Whole Grain Cheerios',
        brand_name: 'General Mills',
        servings: {
          serving: [{
            serving_id: '100675',
            serving_description: '1 cup',
            metric_serving_amount: '30.000',
            metric_serving_unit: 'g',
            is_default: '1',
            calories: '100',
            carbohydrate: '20.00',
            protein: '3.00',
            fat: '2.00',
            fiber: '3.0',
          }, {
            serving_id: '0',
            serving_description: '100 g',
            metric_serving_amount: '100.0',
            metric_serving_unit: 'g',
            calories: '333',
            carbohydrate: '66.67',
            protein: '10.00',
            fat: '6.67',
            fiber: '10.0',
          }],
        },
      }],
    },
  },
};

test('FatSecret stays disabled unless durable offline snapshots are explicitly licensed', () => {
  assert.equal(resolveFatSecretConfiguration({
    FATSECRET_CLIENT_ID: 'client',
    FATSECRET_CLIENT_SECRET: 'secret',
  }), null);
  assert.equal(resolveFatSecretConfiguration({
    FATSECRET_CLIENT_ID: 'client',
    FATSECRET_CLIENT_SECRET: 'secret',
    FATSECRET_OFFLINE_SNAPSHOT_LICENSED: 'false',
  }), null);
});

test('maps the default serving and retains only the storable food and serving ids as provenance', () => {
  const items = mapFatSecretSearchResponse(searchPayload);
  assert.deepEqual(items[0], {
    id: 'fatsecret-50953-100675',
    name: 'Whole Grain Cheerios',
    brand: 'General Mills',
    servingQuantity: 30,
    servingUnit: 'g',
    caloriesKcal: 100,
    proteinG: 3,
    carbohydrateG: 20,
    fatG: 2,
    fibreG: 3,
    source: 'fatsecret',
    sourceRef: '50953:100675',
    barcode: null,
    confidence: null,
  });
});

test('licensed provider integration authenticates server-side and calls v5 with localization', async () => {
  resetFatSecretTokenCacheForTests();
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes('/connect/token')) {
      return Response.json({ access_token: 'server-token', expires_in: 86400 });
    }
    return Response.json(searchPayload);
  };

  const config = resolveFatSecretConfiguration({
    FATSECRET_CLIENT_ID: 'client',
    FATSECRET_CLIENT_SECRET: 'secret',
    FATSECRET_OFFLINE_SNAPSHOT_LICENSED: 'true',
    FATSECRET_REGION: 'SG',
    FATSECRET_LANGUAGE: 'en',
  });
  assert.ok(config);
  const items = await searchFatSecretFoods('cheerios', config, fakeFetch);

  assert.equal(items[0]?.source, 'fatsecret');
  assert.equal(requests.length, 2);
  const authHeaders = requests[0]?.init?.headers as Record<string, string>;
  assert.match(authHeaders.Authorization ?? '', /^Basic /);
  const searchUrl = new URL(requests[1]?.url ?? 'https://invalid.test');
  assert.equal(searchUrl.pathname, '/rest/foods/search/v5');
  assert.equal(searchUrl.searchParams.get('region'), 'SG');
  assert.equal(searchUrl.searchParams.get('language'), 'en');
  assert.equal(searchUrl.searchParams.get('flag_default_serving'), 'true');
  assert.equal((requests[1]?.init?.headers as Record<string, string>)?.Authorization, 'Bearer server-token');
});
