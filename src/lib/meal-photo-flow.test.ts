import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPhotoAnalysisDrafts,
  initialMealPhotoFlowState,
  reduceMealPhotoFlow,
  serializeMealPhotoProvenance,
} from './meal-photo-flow.ts';

const selection = { base64: 'encoded-photo', mediaType: 'image/jpeg', sourceLabel: 'Camera photo' };

test('retains the selected photo and context after a retryable failure', () => {
  let state = reduceMealPhotoFlow(initialMealPhotoFlowState, { type: 'selected', selection });
  state = reduceMealPhotoFlow(state, { type: 'description_changed', description: 'rice and chicken' });
  state = reduceMealPhotoFlow(state, { type: 'analysis_started' });
  state = reduceMealPhotoFlow(state, {
    type: 'analysis_failed',
    failure: { code: 'NETWORK_REQUIRED', message: 'Connection required.', retryable: true, status: 'offline' },
  });
  assert.equal(state.phase, 'failed');
  assert.equal(state.selection, selection);
  assert.equal(state.description, 'rice and chicken');
  assert.equal(state.failure?.retryable, true);
});

test('automatically inserts analyzed drafts exactly once per request', () => {
  const blank = { key: 'blank', name: '' };
  const analyzed = [{ key: 'ai-1', name: 'Rice' }, { key: 'ai-2', name: 'Chicken' }];
  const first = applyPhotoAnalysisDrafts([blank], analyzed, 'request-1', [], (item) => !item.name);
  assert.deepEqual(first.items, analyzed);
  assert.equal(first.insertedItems.length, 2);
  const repeated = applyPhotoAnalysisDrafts(first.items, analyzed, 'request-1', first.appliedRequestIds, (item) => !item.name);
  assert.deepEqual(repeated.items, analyzed);
  assert.equal(repeated.insertedItems.length, 0);
});

test('stores provenance only for AI items retained in the saved meal', () => {
  const encoded = serializeMealPhotoProvenance([
    { requestId: 'request-1', description: 'rice and chicken', itemKeys: ['ai-1', 'ai-2'] },
  ], ['ai-2']);
  assert.deepEqual(JSON.parse(encoded!), {
    version: 1,
    source: 'meal_photo_analysis',
    analyses: [{ requestId: 'request-1', description: 'rice and chicken', retainedItemCount: 1 }],
  });
  assert.equal(serializeMealPhotoProvenance([], []), null);
});
