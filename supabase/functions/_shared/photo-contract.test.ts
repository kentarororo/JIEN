import assert from 'node:assert/strict';
import test from 'node:test';

import { parseProviderPhotoItems } from './photo-contract.ts';
import { groundPhotoItems } from './photo-grounding.ts';
import { readFileSync } from 'node:fs';

const query = 'Rice, white, long-grain, regular, enriched, cooked';
const rawItem = { name: 'Cooked white rice', quantity: 150, unit: 'g', caloriesKcal: 240,
  proteinG: 4, carbohydrateG: 50, fatG: 1, fibreG: null, confidence: 0.9,
  nutritionBasis: 'estimate', assumptions: 'Cooked weight estimated from photo.', databaseQuery: query };
const rice = { fdcId: 12345, description: query, dataType: 'SR Legacy', foodNutrients: [
  { nutrientId: 1008, unitName: 'KCAL', value: 130 }, { nutrientId: 1003, unitName: 'G', value: 2.7 },
  { nutrientId: 1005, unitName: 'G', value: 28.2 }, { nutrientId: 1004, unitName: 'G', value: 0.3 },
] };
const parse = (item = rawItem) => parseProviderPhotoItems(JSON.stringify({ items: [item] }));

test('photo pipeline grounds an exact cooked-food match and scales per-100g values once', async () => {
  const [result] = await groundPhotoItems(parse(), { apiKey: 'test-key', fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.query, query);
    assert.deepEqual(body.dataType, ['Foundation', 'SR Legacy']);
    assert.equal(body.imageBase64, undefined);
    return new Response(JSON.stringify({ foods: [rice] }));
  } });
  assert.ok(result);
  assert.equal(result.caloriesKcal, 195);
  assert.equal(result.proteinG, 4.1);
  assert.equal(result.carbohydrateG, 42.3);
  assert.equal(result.fibreG, null, 'missing fibre is unknown, not zero');
  assert.equal(result.quantity, 150);
  assert.equal(result.photoReview.basis, 'usda');
  assert.equal(result.photoReview.referenceId, '12345');
  assert.match(result.photoReview.notes.join(' '), /portion still need review/);
});

test('photo grounding abstains for raw/cooked mismatch, duplicates, brands and missing nutrients', async () => {
  for (const foods of [
    [{ ...rice, description: query.replace('cooked', 'raw') }],
    [rice, { ...rice, fdcId: 54321 }], [{ ...rice, dataType: 'Branded' }],
    [{ ...rice, foodNutrients: rice.foodNutrients.filter((n) => n.nutrientId !== 1004) }],
    [{ ...rice, foodNutrients: rice.foodNutrients.map((n) => ({ ...n, unitName: 'KJ' })) }],
  ]) {
    const [result] = await groundPhotoItems(parse(), { apiKey: 'test-key', fetchImpl: async () => new Response(JSON.stringify({ foods })) });
    assert.ok(result);
    assert.equal(result.caloriesKcal, rawItem.caloriesKcal);
    assert.equal(result.photoReview.basis, 'estimated');
    assert.equal(result.photoReview.referenceId, null);
  }
});

test('labels, mixed-dish units, and missing USDA configuration do not trigger lookup', async () => {
  const noFetch = async () => { throw new Error('Unexpected external call'); };
  for (const item of [{ ...rawItem, nutritionBasis: 'label' }, { ...rawItem, unit: 'bowl' }]) {
    let calls = 0;
    const [result] = await groundPhotoItems(parse(item), { apiKey: 'key', fetchImpl: async () => { calls++; return noFetch(); } });
    assert.equal(calls, 0);
    assert.ok(result);
    assert.equal(result.caloriesKcal, 240);
  }
  assert.equal((await groundPhotoItems(parse(), { fetchImpl: noFetch }))[0]?.photoReview.basis, 'estimated');
});

test('database failures preserve the estimate and are not retried', async () => {
  for (const status of [429, 500]) {
    let calls = 0;
    const result = await groundPhotoItems(parse(), { apiKey: 'key', fetchImpl: async () => { calls++; return new Response('', { status }); } });
    assert.equal(calls, 1);
    assert.equal(result[0]?.photoReview.basis, 'estimated');
  }
  const result = await groundPhotoItems(parse(), { apiKey: 'key', timeoutMs: 1, fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('timeout')));
  }) });
  assert.equal(result[0]?.caloriesKcal, 240);
});

test('lookup count is bounded and identical food queries are deduplicated', async () => {
  const items = parseProviderPhotoItems(JSON.stringify({ items: Array.from({ length: 12 }, (_, i) => ({ ...rawItem, databaseQuery: `Food ${String.fromCharCode(65 + i)}` })) }));
  let calls = 0;
  await groundPhotoItems(items, { apiKey: 'key', fetchImpl: async () => { calls++; return new Response('{"foods":[]}'); } });
  assert.equal(calls, 6);
  calls = 0;
  await groundPhotoItems([...parse(), ...parse()], { apiKey: 'key', fetchImpl: async () => { calls++; return new Response('{"foods":[]}'); } });
  assert.equal(calls, 1);
});

test('implausible macro totals are flagged without rewriting label values', async () => {
  const [result] = await groundPhotoItems(parse({ ...rawItem, nutritionBasis: 'label', quantity: 10, caloriesKcal: 900 }));
  assert.ok(result);
  assert.equal(result.caloriesKcal, 900);
  assert.equal(result.photoReview.basis, 'label');
  assert.match(result.photoReview.notes.join(' '), /Calories and macros differ/);
  assert.match(result.photoReview.notes.join(' '), /exceed the serving weight/);
});

test('provider output cannot self-assert a verified database basis', () => {
  assert.throws(() => parse({ ...rawItem, nutritionBasis: 'usda' }), /PROVIDER_OUTPUT_INVALID/);
  assert.throws(() => parse({ ...rawItem, assumptions: 'a'.repeat(201) }), /PROVIDER_OUTPUT_INVALID/);
  const source = readFileSync(new URL('../analyze-food-photo/index.ts', import.meta.url), 'utf8');
  assert.match(source, /await groundPhotoItems\(items/);
  assert.match(source, /photoReview: item.photoReview/);
});

test('normalizes valid provider JSON without coercing fields', () => {
  const items = parseProviderPhotoItems(JSON.stringify({ items: [{
    name: 'Noodles',
    quantity: 1,
    unit: 'bowl',
    caloriesKcal: 520,
    proteinG: 21,
    carbohydrateG: 72,
    fatG: 16,
    fibreG: 5,
    confidence: 0.72,
  }] }));
  assert.equal(items[0]?.name, 'Noodles');
});

test('rejects malformed or unsafe provider output', () => {
  assert.throws(() => parseProviderPhotoItems('{not-json'), /PROVIDER_OUTPUT_INVALID/);
  assert.throws(() => parseProviderPhotoItems(JSON.stringify({ items: [{
    name: 'Noodles', quantity: 1, unit: 'bowl', caloriesKcal: '520', proteinG: 21,
    carbohydrateG: 72, fatG: 16, fibreG: 5, confidence: 0.72,
  }] })), /PROVIDER_OUTPUT_INVALID/);
  assert.throws(() => parseProviderPhotoItems('{"items":[]}'), /NO_FOOD_DETECTED/);
});
