import assert from 'node:assert/strict';
import test from 'node:test';

import type { Exercise } from '../db/types.ts';
import { ROUTINE_STARTERS, resolveRoutineStarter } from './routine-starters.ts';

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
