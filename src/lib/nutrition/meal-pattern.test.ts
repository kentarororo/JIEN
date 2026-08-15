import assert from 'node:assert/strict';
import test from 'node:test';

import { inferMealLoggingPattern } from './meal-pattern.ts';

test('meal reminders wait for enough recent logging history', () => {
  assert.deepEqual(inferMealLoggingPattern([2, 2, 3]), {
    established: false,
    expectedMeals: null,
    sampleDays: 3,
  });
});

test('meal reminders use the bounded median of established daily counts', () => {
  assert.deepEqual(inferMealLoggingPattern([3, 2, 4, 2, 3]), {
    established: true,
    expectedMeals: 3,
    sampleDays: 5,
  });
  assert.equal(inferMealLoggingPattern([9, 7, 8, 6]).expectedMeals, 5);
  assert.equal(inferMealLoggingPattern([1, 1, 1, 1]).established, false);
});
