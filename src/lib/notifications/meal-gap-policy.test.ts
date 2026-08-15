import assert from 'node:assert/strict';
import test from 'node:test';

import { getMealGapTrigger } from './meal-gap-policy.ts';

test('meal-gap reminder requires opt-in and a real gap', () => {
  const now = new Date('2026-08-11T12:00:00');
  assert.equal(getMealGapTrigger({ enabled: false, patternEstablished: true, mealCount: 0, expectedMeals: 2, checkHour: 20, now }), null);
  assert.equal(getMealGapTrigger({ enabled: true, patternEstablished: false, mealCount: 0, expectedMeals: 2, checkHour: 20, now }), null);
  assert.equal(getMealGapTrigger({ enabled: true, patternEstablished: true, mealCount: 2, expectedMeals: 2, checkHour: 20, now }), null);
});

test('meal-gap reminder is not scheduled after its contextual check time', () => {
  const before = getMealGapTrigger({ enabled: true, patternEstablished: true, mealCount: 1, expectedMeals: 2, checkHour: 20, now: new Date('2026-08-11T12:00:00') });
  const after = getMealGapTrigger({ enabled: true, patternEstablished: true, mealCount: 1, expectedMeals: 2, checkHour: 20, now: new Date('2026-08-11T21:00:00') });
  assert.equal(before?.getHours(), 20);
  assert.equal(after, null);
});
