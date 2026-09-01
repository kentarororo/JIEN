import assert from 'node:assert/strict';
import test from 'node:test';

import type { Exercise } from '../db/types.ts';
import { exerciseEquipmentFamily, exerciseEquipmentLabel, filterExerciseCatalog } from './exercise-catalog.ts';

const catalog: Exercise[] = [
  exercise('back-squat', 'Barbell Back Squat', 'quads', ['glutes', 'adductors'], 'barbell'),
  exercise('split-squat', 'Bulgarian Split Squat', 'quads', ['glutes', 'adductors'], 'dumbbell'),
  exercise('smith-press', 'Smith Machine Shoulder Press', 'front_delts', ['triceps', 'side_delts'], 'smith_machine'),
  exercise('pulldown', 'Single-arm Lat Pulldown', 'lats', ['biceps'], 'cable'),
];

test('search accepts multiple plain-language muscle, equipment, and name terms', () => {
  assert.deepEqual(filterExerciseCatalog(catalog, { query: 'quadriceps dumbbell' }).map((item) => item.id), ['split-squat']);
  assert.deepEqual(filterExerciseCatalog(catalog, { query: 'single arm back' }).map((item) => item.id), ['pulldown']);
  assert.deepEqual(filterExerciseCatalog(catalog, { query: 'shoulders smith' }).map((item) => item.id), ['smith-press']);
});

test('quick filters include assisting muscles and group Smith equipment with machines', () => {
  assert.deepEqual(filterExerciseCatalog(catalog, { muscleSection: 'Legs', equipment: 'barbell' }).map((item) => item.id), ['back-squat']);
  assert.deepEqual(filterExerciseCatalog(catalog, { muscleSection: 'Arms', equipment: 'machine' }).map((item) => item.id), ['smith-press']);
  assert.equal(exerciseEquipmentLabel('smith_machine'), 'Smith machine');
});

test('exercises without equipment retain the bodyweight fallback', () => {
  assert.equal(exerciseEquipmentFamily(null), 'bodyweight');
  assert.equal(exerciseEquipmentLabel(undefined), 'Bodyweight');
});

function exercise(id: string, name: string, primaryMuscleGroup: string, secondaryMuscleGroups: string[], equipment: string): Exercise {
  return {
    id,
    name,
    movementPattern: 'test_pattern',
    primaryMuscleGroup,
    secondaryMuscleGroups,
    equipment,
    targetRepMin: 8,
    targetRepMax: 12,
    loadIncrement: 2.5,
    notes: null,
    isArchived: false,
  };
}
