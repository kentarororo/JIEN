import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mealDraftContext,
  mealDraftHasContent,
  mealDraftStorageKey,
  parseMealDraft,
  type MealDraftSnapshot,
} from './meal-draft.ts';

function draft(): MealDraftSnapshot {
  return {
    version: 1,
    ownerUserId: 'user-a',
    context: 'date:2026-08-21',
    name: 'Post training',
    type: 'dinner',
    foods: [{
      key: 'food-1', catalogId: 'catalog-1', name: 'Chicken rice', quantity: '1.5', unit: 'serving',
      calories: '650', protein: '42', carbs: '78', fat: '18', fibre: '4', source: 'ai_photo',
      sourceLabel: 'AI photo estimate', confidence: 0.8, referenceQuantity: 1, referenceUnit: 'serving',
      referenceMacros: { caloriesKcal: 433.3, proteinG: 28, carbohydrateG: 52, fatG: 12, fibreG: 2.7 },
    }],
    appliedPhotoRequestIds: ['request-1'],
    photoAnalyses: [{ requestId: 'request-1', description: 'chicken rice', itemKeys: ['food-1'] }],
    updatedAt: '2026-08-21T10:00:00.000Z',
  };
}

test('meal drafts are isolated by account and logging context', () => {
  const serialized = JSON.stringify(draft());
  assert.ok(parseMealDraft(serialized, 'user-a', 'date:2026-08-21'));
  assert.equal(parseMealDraft(serialized, 'user-b', 'date:2026-08-21'), null);
  assert.equal(parseMealDraft(serialized, 'user-a', 'date:2026-08-22'), null);
  assert.notEqual(mealDraftStorageKey('user-a', 'date:2026-08-21'), mealDraftStorageKey('user-b', 'date:2026-08-21'));
  assert.equal(mealDraftContext('2026-08-21', 'job/id'), 'photo:job/id');
});

test('meal draft recovery preserves editable rows and AI provenance', () => {
  const restored = parseMealDraft(JSON.stringify(draft()), 'user-a', 'date:2026-08-21');
  assert.equal(restored?.foods[0]?.quantity, '1.5');
  assert.deepEqual(restored?.photoAnalyses[0]?.itemKeys, ['food-1']);
  assert.deepEqual(restored?.appliedPhotoRequestIds, ['request-1']);
});

test('meal draft parser rejects malformed and oversized data, then removes detached provenance', () => {
  assert.equal(parseMealDraft('{bad json', 'user-a', 'date:2026-08-21'), null);
  assert.equal(parseMealDraft(JSON.stringify({ ...draft(), foods: [] }), 'user-a', 'date:2026-08-21'), null);
  assert.deepEqual(
    parseMealDraft(JSON.stringify({ ...draft(), photoAnalyses: [{ requestId: 'request-1', description: '', itemKeys: ['missing-food'] }] }), 'user-a', 'date:2026-08-21')?.photoAnalyses,
    [],
  );
  assert.equal(parseMealDraft(JSON.stringify({ ...draft(), foods: Array(31).fill(draft().foods[0]) }), 'user-a', 'date:2026-08-21'), null);
});

test('draft persistence contains no raw photo payload and ignores untouched defaults', () => {
  const serialized = JSON.stringify(draft());
  assert.equal(serialized.includes('base64'), false);
  assert.equal(serialized.includes('mediaType'), false);
  assert.equal(mealDraftHasContent({ name: 'Meal', type: 'dinner', foods: [{ ...draft().foods[0]!, name: '', calories: '', protein: '', carbs: '', fat: '', fibre: '' }], photoAnalyses: [] }, 'dinner'), false);
  assert.equal(mealDraftHasContent(draft(), 'dinner'), true);
});
