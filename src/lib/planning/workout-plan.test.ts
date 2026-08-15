import assert from 'node:assert/strict';
import test from 'node:test';

import type { Exercise, WorkoutSet } from '../db/types.ts';
import { buildPlannedWorkoutExercise, parsePlannedWorkoutPlan } from './workout-plan.ts';

const exercise: Exercise = {
  id: 'exercise-1',
  name: 'Chest press',
  movementPattern: 'horizontal_push',
  primaryMuscleGroup: 'chest',
  secondaryMuscleGroups: ['triceps'],
  equipment: 'machine',
  targetRepMin: 8,
  targetRepMax: 12,
  loadIncrement: 2.5,
  notes: null,
  isArchived: false,
};

function set(reps: number, loadValue: number, rpe: number | null): WorkoutSet {
  return {
    id: `set-${reps}-${rpe}`,
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    primaryMuscleGroup: exercise.primaryMuscleGroup,
    secondaryMuscleGroups: exercise.secondaryMuscleGroups,
    targetRepMin: 8,
    targetRepMax: 12,
    loadIncrement: 2.5,
    reps,
    loadValue,
    loadUnit: 'kg',
    rpe,
    kind: 'working',
    completedAt: '2026-08-14T10:00:00.000Z',
    sortOrder: 0,
  };
}

test('planned exercise preserves the previous exposure and keeps cues separate', () => {
  const plan = buildPlannedWorkoutExercise({
    exercise,
    history: [set(12, 40, 8), set(12, 40, 9)],
    preferredLoadUnit: 'kg',
  });
  assert.deepEqual(plan.sets.map((item) => [item.loadValue, item.reps]), [[40, 12], [40, 12]]);
  assert.equal(plan.progression.action, 'add_load');
  assert.deepEqual(plan.progression.cues.map((cue) => [cue.loadValue, cue.targetReps]), [[42.5, 8], [42.5, 8]]);
});

test('an exercise without history gets blank targets instead of invented loads', () => {
  const plan = buildPlannedWorkoutExercise({ exercise, history: [], preferredLoadUnit: 'lb' });
  assert.equal(plan.sets.length, 3);
  assert.deepEqual(plan.sets[0], { loadValue: null, loadUnit: 'lb', reps: null });
  assert.equal(plan.progression.action, 'start');
});

test('planned workout parsing rejects malformed provider or sync content', () => {
  const validExercise = buildPlannedWorkoutExercise({ exercise, history: [set(10, 40, 8)], preferredLoadUnit: 'kg' });
  assert.ok(parsePlannedWorkoutPlan(JSON.stringify({ version: 1, exercises: [validExercise] })));
  assert.equal(parsePlannedWorkoutPlan('{bad json'), null);
  assert.equal(parsePlannedWorkoutPlan({ version: 1, exercises: [{ ...validExercise, sets: [{ loadValue: -1, loadUnit: 'kg', reps: 8 }] }] }), null);
});
