import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeRecordPredicate,
  localMealTimestamp,
  mealDateQueryKey,
  tombstonePayload,
  validateMealEdit,
} from './meal-record.ts';
import { toLocalDateKey } from '../time.ts';
import { buildRepeatMealDraft, resolveRepeatMealTarget } from './meal-template.ts';

test('item edits recalculate all meal totals', () => {
  const eatenAt = localMealTimestamp('2026-08-12', '18:45');
  const meal = validateMealEdit({
    name: '  Dinner  ',
    eatenAt,
    items: [
      { id: 'rice', name: 'Rice', quantity: 200, unit: 'g', caloriesKcal: 260, proteinG: 5.4, carbohydrateG: 56.4, fatG: 0.6, fibreG: 0.8 },
      { id: 'tofu', name: 'Tofu', quantity: 100, unit: 'g', caloriesKcal: 144, proteinG: 17.3, carbohydrateG: 2.8, fatG: 8.7, fibreG: 2.3 },
    ],
  }, new Date(2026, 7, 14, 12).getTime());

  assert.equal(meal.name, 'Dinner');
  assert.equal(meal.eatenOn, '2026-08-12');
  assert.deepEqual(meal.totals, {
    caloriesKcal: 404,
    proteinG: 22.700000000000003,
    carbohydrateG: 59.199999999999996,
    fatG: 9.299999999999999,
    fibreG: 3.0999999999999996,
  });
});

test('historical meal date keys remain local calendar days', () => {
  const timestamp = localMealTimestamp('2026-01-03', '00:15');
  assert.equal(toLocalDateKey(new Date(timestamp)), '2026-01-03');
  assert.equal(mealDateQueryKey('2026-01-03'), '2026-01-03');
  assert.throws(() => mealDateQueryKey('2026-02-30'), /valid meal date/);
});

test('tombstones preserve the snapshot while advancing sync time', () => {
  const deletedAt = '2026-08-14T04:05:00.000Z';
  assert.deepEqual(
    tombstonePayload({ id: 'meal-1', name: 'Lunch', client_updated_at: 'old', deleted_at: null }, deletedAt),
    { id: 'meal-1', name: 'Lunch', client_updated_at: deletedAt, deleted_at: deletedAt },
  );
});

test('shared active-row predicate excludes soft-deleted records', () => {
  assert.equal(activeRecordPredicate('m'), 'm.deleted_at IS NULL');
  assert.equal(activeRecordPredicate('food_items'), 'food_items.deleted_at IS NULL');
  assert.throws(() => activeRecordPredicate('m; DROP TABLE meals'), /Invalid query alias/);
});

test('repeating a saved meal copies editable snapshots without claiming a new AI analysis', () => {
  let key = 0;
  const repeated = buildRepeatMealDraft({
    name: 'Chicken rice',
    type: 'lunch',
    items: [{
      name: 'Chicken rice', quantity: 1.5, unit: 'serving', caloriesKcal: 700,
      proteinG: 42, carbohydrateG: 88, fatG: 18, fibreG: 4,
    }],
  }, 'snack', () => `copy-${++key}`);

  assert.equal(repeated.name, 'Chicken rice');
  assert.equal(repeated.type, 'lunch');
  assert.deepEqual(repeated.foods.map((food) => ({
    key: food.key,
    quantity: food.quantity,
    calories: food.calories,
    source: food.source,
    confidence: food.confidence,
    sourceLabel: food.sourceLabel,
  })), [{
    key: 'copy-1', quantity: '1.5', calories: '700', source: 'manual', confidence: null,
    sourceLabel: 'Copied from saved meal',
  }]);
});

test('repeat-meal target defaults to today and offers yesterday (#29)', () => {
  const target = resolveRepeatMealTarget(undefined, '2026-10-21');
  assert.deepEqual(target, { date: '2026-10-21', today: '2026-10-21', yesterday: '2026-10-20', viewedDate: null });
});

test('repeat-meal target adds the viewed Food day as a choice only when it is an earlier, distinct day (#29)', () => {
  assert.equal(resolveRepeatMealTarget('2026-10-17', '2026-10-21').viewedDate, '2026-10-17');
  assert.equal(resolveRepeatMealTarget('2026-10-17', '2026-10-21').date, '2026-10-21', 'viewing a past day keeps Today as the default');
  assert.equal(resolveRepeatMealTarget('2026-10-21', '2026-10-21').viewedDate, null, 'today already has its own choice');
  assert.equal(resolveRepeatMealTarget('2026-10-20', '2026-10-21').viewedDate, null, 'yesterday already has its own choice');
  assert.equal(resolveRepeatMealTarget('2026-10-25', '2026-10-21').viewedDate, null, 'a future day is never offered');
  assert.equal(resolveRepeatMealTarget('not-a-date', '2026-10-21').viewedDate, null);
});

test('repeat-meal target uses a valid back-fill day as the default and ignores future or malformed ones (#29)', () => {
  assert.equal(resolveRepeatMealTarget('2026-10-17', '2026-10-21', '2026-10-18').date, '2026-10-18');
  assert.equal(resolveRepeatMealTarget('2026-10-17', '2026-10-21', '2026-10-30').date, '2026-10-21');
  assert.equal(resolveRepeatMealTarget('2026-10-17', '2026-10-21', '18/10/2026').date, '2026-10-21');
});

test('repeat-meal targets cross month and year boundaries on local calendar days (#29)', () => {
  assert.equal(resolveRepeatMealTarget(undefined, '2026-01-01').yesterday, '2025-12-31');
  assert.equal(resolveRepeatMealTarget(undefined, '2026-03-01').yesterday, '2026-02-28');
});
