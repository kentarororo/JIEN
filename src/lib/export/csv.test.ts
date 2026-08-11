import assert from 'node:assert/strict';
import test from 'node:test';

import { nutritionToCsv, workoutsToCsv } from './csv.ts';

test('workout CSV escapes commas and includes portable headers', () => {
  const csv = workoutsToCsv([{ workoutId: '1', performedOn: '2026-08-11', workoutTitle: 'Push, controlled', exercise: 'Chest Press', muscleGroup: 'chest', setNumber: 1, kind: 'working', reps: 10, load: 40, unit: 'kg', rpe: 8, volumeKg: 400 }]);
  assert.match(csv, /^workout_id,date,workout,/);
  assert.match(csv, /"Push, controlled"/);
  assert.match(csv, /400\.00/);
});

test('nutrition CSV escapes quotes and preserves macro columns', () => {
  const csv = nutritionToCsv([{ mealId: '1', eatenOn: '2026-08-11', eatenAt: '2026-08-11T12:00:00Z', mealName: 'Lunch', mealType: 'lunch', food: '6" sandwich', quantity: 1, unit: 'serving', caloriesKcal: 500, proteinG: 30, carbohydrateG: 55, fatG: 18, fibreG: null }]);
  assert.match(csv, /"6"" sandwich"/);
  assert.match(csv, /protein_g,carbohydrate_g,fat_g,fibre_g/);
});
