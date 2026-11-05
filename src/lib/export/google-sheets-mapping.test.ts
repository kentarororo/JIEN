import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGoogleSheetsTabs } from './google-sheets-mapping.ts';

const workout = { workoutId: 'w1', performedOn: '2026-11-04', workoutTitle: 'Push', exercise: 'Chest Press', muscleGroup: 'chest', setNumber: 1, kind: 'working' as const, reps: 10, load: 40, unit: 'kg' as const, rpe: 8, volumeKg: 400 };
const day = { date: '2026-11-04', dayState: 'complete' as const, caloriesKcal: 2150.456, proteinG: 160.004, carbohydrateG: 210.5, fatG: 70.125, bodyWeightKg: 82.35 };

test('Workouts tab has the agreed columns in order and one row per set', () => {
  const workouts = buildGoogleSheetsTabs({ workouts: [workout, { ...workout, setNumber: 2, reps: 8, rpe: null, volumeKg: 320 }], nutrition: [] })[0]!;
  assert.equal(workouts.title, 'Workouts');
  assert.deepEqual(workouts.values[0]!, ['Date', 'Workout', 'Exercise', 'Set', 'Weight (kg)', 'Reps', 'RPE', 'Volume (kg·reps)']);
  assert.equal(workouts.values.length, 3);
  assert.deepEqual(workouts.values[1]!.slice(1), ['Push', 'Chest Press', 1, 40, 10, 8, 400]);
  assert.equal(workouts.values[2]![6], '', 'a missing RPE is a blank cell, not 0');
});

test('Nutrition tab has the agreed columns, rounds to 2 decimals and leaves no weigh-in blank', () => {
  const nutrition = buildGoogleSheetsTabs({ workouts: [], nutrition: [day, { ...day, date: '2026-11-05', dayState: 'partial', bodyWeightKg: null }] })[1]!;
  assert.equal(nutrition.title, 'Nutrition');
  assert.deepEqual(nutrition.values[0]!, ['Date', 'Day state', 'Kcal', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Weigh-in (kg)']);
  assert.deepEqual(nutrition.values[1]!.slice(1), ['complete', 2150.46, 160, 210.5, 70.13, 82.35]);
  assert.deepEqual(nutrition.values[2]!.slice(1, 2), ['partial']);
  assert.equal(nutrition.values[2]![6], '');
});

test('dates become Google Sheets date serials so the yyyy-mm-dd format applies', () => {
  const [workouts, nutrition] = buildGoogleSheetsTabs({ workouts: [{ ...workout, performedOn: '1970-01-01' }], nutrition: [{ ...day, date: '2026-11-04' }] }) as [ReturnType<typeof buildGoogleSheetsTabs>[number], ReturnType<typeof buildGoogleSheetsTabs>[number]];
  assert.equal(workouts.values[1]![0], 25_569);
  assert.equal(nutrition.values[1]![0], 25_569 + Date.UTC(2026, 10, 4) / 86_400_000);
});

test('pound loads are converted to kilograms in the Weight column', () => {
  const workouts = buildGoogleSheetsTabs({ workouts: [{ ...workout, load: 100, unit: 'lb', volumeKg: 453.59 }], nutrition: [] })[0]!;
  assert.equal(workouts.values[1]![4], 45.36);
  assert.equal(workouts.values[1]![7], 453.59);
});

test('an invalid stored date fails the export with a readable message instead of writing a bad row', () => {
  assert.throws(() => buildGoogleSheetsTabs({ workouts: [{ ...workout, performedOn: '04/11/2026' }], nutrition: [] }), /export date is invalid/);
});

test('empty data still writes both header rows', () => {
  const tabs = buildGoogleSheetsTabs({ workouts: [], nutrition: [] });
  assert.deepEqual(tabs.map((tab) => [tab.title, tab.values.length]), [['Workouts', 1], ['Nutrition', 1]]);
});
