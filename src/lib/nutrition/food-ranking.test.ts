import assert from 'node:assert/strict';
import test from 'node:test';

import { rankFoodCandidates } from './food-ranking.ts';

const candidates = [
  { id: 'provider', name: 'Char Kway Teow', brand: 'Provider', source: 'open_food_facts' },
  { id: 'history', name: 'Char Koay Teow', brand: null, source: 'custom', isFromHistory: true,
    usageCount: 6, timeOfDayUsageCount: 4, lastUsedAt: '2026-10-20T12:00:00.000Z' },
  { id: 'saved', name: 'Chicken rice', brand: null, source: 'custom', usageCount: 2,
    lastUsedAt: '2026-10-19T12:00:00.000Z' },
  { id: 'starter', name: 'Chicken breast', brand: null, source: 'starter' },
];

test('ranks personal history above provider matches and learns the current time of day', () => {
  assert.deepEqual(
    rankFoodCandidates(candidates, 'char kway teow', 8, new Date('2026-10-22T12:00:00.000Z')).map((food) => food.id),
    ['history', 'provider'],
  );
  assert.equal(rankFoodCandidates(candidates, '', 1, new Date('2026-10-22T12:00:00.000Z'))[0]?.id, 'history');
});

test('matches local abbreviations and ordinary typos without sending a network query', () => {
  assert.deepEqual(rankFoodCandidates(candidates, 'ckt').map((food) => food.id), ['history', 'provider']);
  assert.deepEqual(rankFoodCandidates(candidates, 'chiken rice').map((food) => food.id), ['saved']);
});
