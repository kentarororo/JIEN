import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeTrainingMuscleContext } from './training-context.ts';
import { summarizeLoggedNutrition } from './nutrition-context.ts';

test('summarizes four logged weeks by primary and secondary muscles without claiming growth', () => {
  const workouts = [
    { id: 'w1', performed_on: '2026-07-20' },
    { id: 'w2', performed_on: '2026-07-27' },
    { id: 'w3', performed_on: '2026-08-03' },
    { id: 'w4', performed_on: '2026-08-10' },
  ];
  const sets = workouts.flatMap((workout, weekIndex) => [0, 1, 2].map(() => ({
    workout_id: workout.id,
    exercise_id: 'press',
    reps: [8, 9, 10, 12][weekIndex]!,
    load_value: 40,
    load_unit: 'kg',
    kind: 'working',
  })));
  const result = summarizeTrainingMuscleContext(workouts, sets, [{
    id: 'press', primary_muscle_group: 'chest', secondary_muscle_groups: ['triceps', 'front_delts'],
  }], new Date('2026-08-17T12:00:00.000Z'));

  assert.equal(result.weeks.length, 4);
  assert.equal(result.weeks.at(-1)?.muscleGroups.find((group) => group.muscleGroup === 'chest')?.weightedSets, 3);
  assert.equal(result.weeks.at(-1)?.muscleGroups.find((group) => group.muscleGroup === 'triceps')?.weightedSets, 1.5);
  assert.equal(result.latestVsPrevious.find((group) => group.muscleGroup === 'chest')?.status, 'steady');
  assert.equal(result.latestVsPrevious.find((group) => group.muscleGroup === 'chest')?.setChangePercent, 0);
  assert.equal(result.latestVsPrevious.find((group) => group.muscleGroup === 'chest')?.workChangePercent, 20);
  assert.equal(result.advisory.status, 'focus');
  assert.equal(result.advisory.baselineWeekCount, 4);
  assert.deepEqual(result.advisory.focus.map((item) => item.muscleGroup), ['chest', 'front_delts', 'triceps']);
  assert.equal(result.advisory.focus[0]?.remainingSetCredits, 3);
});

test('pools related exercise angles for advisory focus without double-crediting a set', () => {
  const result = summarizeTrainingMuscleContext(
    [
      { id: 'prior', performed_on: '2026-08-10' },
      { id: 'current', performed_on: '2026-08-17' },
    ],
    [
      {
        workout_id: 'prior', exercise_id: 'incline', reps: 10, load_value: 40, load_unit: 'kg', kind: 'working',
        primary_muscle_group: 'upper_chest', secondary_muscle_groups: ['chest', 'front_delts'],
      },
      {
        workout_id: 'current', exercise_id: 'flat', reps: 10, load_value: 40, load_unit: 'kg', kind: 'working',
        primary_muscle_group: 'chest', secondary_muscle_groups: [],
      },
    ],
    [],
    new Date('2026-08-18T12:00:00.000Z'),
  );
  const chest = result.advisory.coverage.find((item) => item.muscleGroup === 'chest');
  assert.equal(chest?.baselineSetCredits, 1);
  assert.equal(chest?.currentSetCredits, 1);
  assert.equal(chest?.remainingSetCredits, 0);
});

test('uses set-level muscle snapshots after an exercise target is edited', () => {
  const result = summarizeTrainingMuscleContext(
    [{ id: 'w1', performed_on: '2026-08-10' }],
    [{
      workout_id: 'w1', exercise_id: 'press', reps: 10, load_value: 40, load_unit: 'kg', kind: 'working',
      primary_muscle_group: 'chest', secondary_muscle_groups: ['triceps'],
    }],
    [{ id: 'press', primary_muscle_group: 'front_delts', secondary_muscle_groups: ['triceps'] }],
  );
  assert.equal(result.weeks[0]?.muscleGroups.some((group) => group.muscleGroup === 'chest'), true);
  assert.equal(result.weeks[0]?.muscleGroups.some((group) => group.muscleGroup === 'front_delts'), false);
});

test('marks an incomplete current week as partial instead of down', () => {
  const workouts = [
    { id: 'prior', performed_on: '2026-08-10' },
    { id: 'current', performed_on: '2026-08-17' },
  ];
  const sets = [
    ...[0, 1, 2].map(() => ({ workout_id: 'prior', exercise_id: 'press', reps: 12, load_value: 40, load_unit: 'kg', kind: 'working' })),
    { workout_id: 'current', exercise_id: 'press', reps: 8, load_value: 40, load_unit: 'kg', kind: 'working' },
  ];
  const result = summarizeTrainingMuscleContext(workouts, sets, [
    { id: 'press', primary_muscle_group: 'chest', secondary_muscle_groups: [] },
  ], new Date('2026-08-17T12:00:00.000Z'));
  assert.equal(result.latestIsPartialWeek, true);
  assert.equal(result.latestVsPrevious[0]?.status, 'partial');
});

test('keeps a not-yet-trained body part neutral during the current partial week', () => {
  const result = summarizeTrainingMuscleContext(
    [
      { id: 'prior', performed_on: '2026-08-10' },
      { id: 'current', performed_on: '2026-08-17' },
    ],
    [
      { workout_id: 'prior', exercise_id: 'row', reps: 10, load_value: 40, load_unit: 'kg', kind: 'working' },
      { workout_id: 'current', exercise_id: 'press', reps: 8, load_value: 40, load_unit: 'kg', kind: 'working' },
    ],
    [
      { id: 'row', primary_muscle_group: 'upper_back', secondary_muscle_groups: [] },
      { id: 'press', primary_muscle_group: 'chest', secondary_muscle_groups: [] },
    ],
    new Date('2026-08-17T12:00:00.000Z'),
  );
  assert.equal(result.latestVsPrevious.find((group) => group.muscleGroup === 'upper_back')?.status, 'partial');
});

test('counts zero-load working sets and excludes warmups', () => {
  const result = summarizeTrainingMuscleContext(
    [{ id: 'w1', performed_on: '2026-08-10' }],
    [
      { workout_id: 'w1', exercise_id: 'core', reps: 15, load_value: 0, load_unit: 'kg', kind: 'working' },
      { workout_id: 'w1', exercise_id: 'core', reps: 10, load_value: 10, load_unit: 'kg', kind: 'warmup' },
    ],
    [{ id: 'core', primary_muscle_group: 'core', secondary_muscle_groups: [] }],
  );
  assert.equal(result.weeks[0]?.totalWorkingSets, 1);
  assert.equal(result.weeks[0]?.muscleGroups[0]?.weightedSets, 1);
  assert.equal(result.weeks[0]?.totalWorkKg, 0);
});

test('keeps nutrition context date-specific and explicit about logged-day coverage', () => {
  const result = summarizeLoggedNutrition(
    [
      { id: 'm1', eaten_on: '2026-08-10' },
      { id: 'm2', eaten_on: '2026-08-10' },
      { id: 'm3', eaten_on: '2026-08-12' },
    ],
    [
      { meal_id: 'm1', calories_kcal: 500, protein_g: 40, carbohydrate_g: 60, fat_g: 12 },
      { meal_id: 'm2', calories_kcal: 700, protein_g: 50, carbohydrate_g: 80, fat_g: 20 },
      { meal_id: 'm3', calories_kcal: 800, protein_g: 60, carbohydrate_g: 90, fat_g: 25 },
    ],
    { calories_kcal: 2200, protein_g: 160, carbohydrate_g: 250, fat_g: 70 },
  );

  assert.equal(result.daysLogged, 2);
  assert.equal(result.mealCount, 3);
  assert.deepEqual(result.loggedDays[0], {
    date: '2026-08-10', mealCount: 2, caloriesKcal: 1200, proteinG: 90, carbohydrateG: 140, fatG: 32,
  });
  assert.deepEqual(result.loggedDayAverages, {
    caloriesKcal: 1000, proteinG: 75, carbohydrateG: 115, fatG: 28.5,
  });
  assert.equal(result.currentTarget?.proteinG, 160);
});

test('does not mistake absent food rows for negative macros or invent unlogged dates', () => {
  const result = summarizeLoggedNutrition(
    [{ id: 'empty-meal', eaten_on: '2026-08-15' }],
    [{ meal_id: 'unknown', calories_kcal: -5, protein_g: 'bad', carbohydrate_g: null, fat_g: null }],
    null,
  );
  assert.equal(result.daysLogged, 1);
  assert.deepEqual(result.totals, { caloriesKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 });
  assert.equal(result.currentTarget, null);
});
