import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFoodCopyMeals, type FoodCopyRow } from './food-copy.ts';

const row = (overrides: Partial<FoodCopyRow> = {}): FoodCopyRow => ({
  mealId: 'lunch', mealName: 'Hawker lunch', mealType: 'lunch', eatenAt: '2026-10-20T04:30:00.000Z',
  itemId: 'rice', sortOrder: 0, name: 'Chicken rice', quantity: 1, unit: 'plate',
  caloriesKcal: 650, proteinG: 35, carbohydrateG: 80, fatG: 18, fibreG: 3,
  ...overrides,
});

test('copies a day as grouped editable meals while preserving selected item portions', () => {
  const copied = buildFoodCopyMeals([
    row({ itemId: 'drink', sortOrder: 1, name: 'Kopi C', caloriesKcal: 90 }),
    row(),
    row({ mealId: 'shake', mealName: 'Protein shake', mealType: 'snack', itemId: 'whey', sortOrder: 0,
      name: 'Whey', quantity: 1.5, unit: 'scoop', caloriesKcal: 180 }),
  ], '2026-10-21', new Date('2026-10-21T14:00:00.000Z'));

  assert.equal(copied.length, 2);
  assert.deepEqual(copied[0]?.items.map((item) => item.name), ['Chicken rice', 'Kopi C']);
  assert.equal(copied[1]?.items[0]?.quantity, 1.5);
  assert.equal(copied[1]?.items[0]?.source, 'manual');
});

test('a selected subset copies only those foods and clamps a future same-day meal time', () => {
  const [copied] = buildFoodCopyMeals([row({ itemId: 'rice' })], '2026-10-21', new Date('2026-10-21T03:00:00.000Z'));
  assert.deepEqual(copied?.items.map((item) => item.name), ['Chicken rice']);
  assert.ok(new Date(copied!.eatenAt).getTime() <= new Date('2026-10-21T03:00:00.000Z').getTime());
});
