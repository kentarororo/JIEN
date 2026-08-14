import assert from 'node:assert/strict';
import test from 'node:test';

import { parseProviderPhotoItems } from './photo-contract.ts';

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
