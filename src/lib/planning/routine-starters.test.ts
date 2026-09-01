import assert from 'node:assert/strict';
import test from 'node:test';

import type { Exercise } from '../db/types.ts';
import { DEFAULT_EXERCISES } from '../db/migrate.ts';
import {
  ROUTINE_STARTERS,
  rankRoutineStarters,
  repeatedMovementPatterns,
  resolveRoutineStarter,
  summarizePlannedMuscleCredits,
} from './routine-starters.ts';

const exercises = [
  exercise(59, 'Barbell Bench Press', 'barbell'),
  exercise(43, 'Dumbbell Bench Press', 'dumbbell'),
  exercise(1, 'Machine Chest Press', 'machine'),
  exercise(47, 'Push-up', 'bodyweight'),
  exercise(60, 'Incline Barbell Bench Press', 'barbell'),
  exercise(77, 'Incline Dumbbell Bench Press', 'dumbbell'),
  exercise(17, 'Incline Machine Chest Press', 'machine'),
  exercise(62, 'Barbell Overhead Press', 'barbell'),
  exercise(79, 'Dumbbell Shoulder Press', 'dumbbell'),
  exercise(4, 'Machine Shoulder Press', 'machine'),
  exercise(81, 'Dumbbell Lateral Raise', 'dumbbell'),
  exercise(5, 'Cable Lateral Raise', 'cable'),
  exercise(24, 'Machine Lateral Raise', 'machine'),
  exercise(72, 'EZ-bar Skull Crusher', 'barbell'),
  exercise(90, 'Dumbbell Overhead Triceps Extension', 'dumbbell'),
  exercise(39, 'Machine Triceps Dip', 'machine'),
  exercise(124, 'Parallel-bar Dip', 'bodyweight'),
];

test('routine starters expose the common lifting splits without activity-mode creep', () => {
  assert.deepEqual(ROUTINE_STARTERS.map((starter) => starter.id), ['push', 'pull', 'legs', 'upper', 'lower', 'full_body']);
});

test('a routine starter selects one available exercise per movement slot', () => {
  const push = ROUTINE_STARTERS.find((starter) => starter.id === 'push')!;
  const resolved = resolveRoutineStarter(push, exercises, ['dumbbells']);
  assert.deepEqual(resolved.map((exercise) => exercise.name), [
    'Dumbbell Bench Press',
    'Incline Dumbbell Bench Press',
    'Dumbbell Shoulder Press',
    'Dumbbell Lateral Raise',
    'Dumbbell Overhead Triceps Extension',
  ]);
});

test('bodyweight profiles receive only bodyweight choices and no duplicate exercise', () => {
  const push = ROUTINE_STARTERS.find((starter) => starter.id === 'push')!;
  const resolved = resolveRoutineStarter(push, exercises, ['bodyweight']);
  assert.deepEqual(resolved.map((exercise) => exercise.name), ['Push-up', 'Parallel-bar Dip']);
  assert.equal(new Set(resolved.map((exercise) => exercise.id)).size, resolved.length);
});

test('routine ranking matches ready muscle gaps without using recently trained gaps', () => {
  const rankedCatalog = exercises.map((item) => {
    if (item.name === 'Machine Chest Press' || item.name === 'Incline Machine Chest Press') {
      return { ...item, primaryMuscleGroup: 'chest', secondaryMuscleGroups: ['triceps', 'front_delts'] };
    }
    if (item.name === 'Machine Shoulder Press') {
      return { ...item, primaryMuscleGroup: 'front_delts', secondaryMuscleGroups: ['triceps', 'side_delts'] };
    }
    if (item.name === 'Machine Triceps Dip') {
      return { ...item, primaryMuscleGroup: 'triceps', secondaryMuscleGroups: ['chest'] };
    }
    return item;
  });
  const recommendations = rankRoutineStarters({
    catalog: rankedCatalog,
    availableEquipment: ['machines'],
    focus: [
      coverage('chest', 'Chest', 4, false),
      coverage('triceps', 'Triceps', 2, false),
      coverage('front_delts', 'Front delts', 6, true),
    ],
  });
  assert.equal(recommendations[0]?.starter.id, 'push');
  assert.deepEqual(recommendations[0]?.matchedFocus.map((item) => item.muscleGroup), ['chest', 'triceps']);
  assert.doesNotMatch(recommendations[0]?.reason ?? '', /front delts/i);
  assert.match(recommendations[0]?.reason ?? '', /equipment saved in your profile/i);
});

test('planned muscle coverage counts primary and assisting set credits without double counting', () => {
  const chestPress = { ...exercises[2]!, secondaryMuscleGroups: ['triceps', 'front_delts', 'chest'] };
  const summary = summarizePlannedMuscleCredits([{ exerciseId: chestPress.id, setCount: 3 }], [chestPress]);
  assert.deepEqual(summary.map((item) => [item.muscleGroup, item.setCredits]), [
    ['chest', 3],
    ['front_delts', 1.5],
    ['triceps', 1.5],
  ]);
});

test('repeated movement patterns are informational and deterministic', () => {
  const catalog = [
    { ...exercises[0]!, movementPattern: 'horizontal_push' },
    { ...exercises[1]!, movementPattern: 'horizontal_push' },
    { ...exercises[7]!, movementPattern: 'vertical_push' },
  ];
  assert.deepEqual(repeatedMovementPatterns(catalog.map((item) => item.id), catalog), [
    { movementPattern: 'horizontal_push', count: 2 },
  ]);
});

test('the reviewed catalogue ranks common splits for upper, lower, and mixed focus', () => {
  const catalog = DEFAULT_EXERCISES.map((item): Exercise => ({
    id: String(item[0]),
    name: String(item[1]),
    movementPattern: String(item[2]),
    primaryMuscleGroup: String(item[3]),
    secondaryMuscleGroups: JSON.parse(String(item[4])) as string[],
    equipment: String(item[5]),
    targetRepMin: Number(item[6]),
    targetRepMax: Number(item[7]),
    loadIncrement: Number(item[8]),
    notes: null,
    isArchived: false,
  }));
  const top = (gaps: Array<[string, string]>) => rankRoutineStarters({
    catalog,
    availableEquipment: ['machines'],
    focus: gaps.map(([group, label]) => coverage(group, label, 3, false)),
  })[0]?.starter.id;
  assert.equal(top([['lats', 'Lats'], ['upper_back', 'Upper back'], ['biceps', 'Biceps']]), 'pull');
  assert.equal(top([['quads', 'Quadriceps'], ['hamstrings', 'Hamstrings'], ['glutes', 'Glutes']]), 'legs');
  assert.equal(top([['chest', 'Chest'], ['quads', 'Quadriceps'], ['lats', 'Lats']]), 'full_body');
});

function coverage(muscleGroup: string, label: string, remainingSetCredits: number, trainedWithin48Hours: boolean) {
  return {
    muscleGroup,
    label,
    currentSetCredits: 0,
    baselineSetCredits: remainingSetCredits,
    remainingSetCredits,
    lastTrainedAt: null,
    trainedWithin48Hours,
  };
}

function exercise(suffix: number, name: string, equipment: string): Exercise {
  return {
    id: `10000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
    name,
    movementPattern: 'test',
    primaryMuscleGroup: 'chest',
    secondaryMuscleGroups: [],
    equipment,
    targetRepMin: 8,
    targetRepMax: 12,
    loadIncrement: 2.5,
    notes: null,
    isArchived: false,
  };
}
