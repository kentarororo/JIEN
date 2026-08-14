import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateWeeklyVolume,
  buildSetProgressionPlan,
  calculateOverloadChangePercent,
  calculateSetVolumeKg,
  detectDeloadSignal,
  suggestDoubleProgression,
} from './index.ts';

test('compares only against a meaningful prior volume', () => {
  assert.equal(calculateOverloadChangePercent(1_050, 1_000), 5);
  assert.equal(calculateOverloadChangePercent(950, 1_000), -5);
  assert.equal(calculateOverloadChangePercent(100, 0), null);
});

test('normalizes pounds and ignores warm-up volume', () => {
  assert.ok(Math.abs(calculateSetVolumeKg({ reps: 10, loadValue: 100, loadUnit: 'lb' }) - 453.59237) < 0.001);
  assert.equal(calculateSetVolumeKg({ reps: 10, loadValue: 50, loadUnit: 'kg', kind: 'warmup' }), 0);
});

test('adds load only when every working set reaches the top of range with effort recorded', () => {
  const result = suggestDoubleProgression({
    sets: [
      { reps: 12, loadValue: 40, loadUnit: 'kg', rpe: 8 },
      { reps: 12, loadValue: 40, loadUnit: 'kg', rpe: 9 },
      { reps: 12, loadValue: 40, loadUnit: 'kg', rpe: 8 },
    ],
    repMin: 8,
    repMax: 12,
    loadIncrement: 2.5,
  });
  assert.deepEqual(result, {
    action: 'add_load',
    loadValue: 42.5,
    targetReps: [8, 8, 8],
    reason: 'Every working set reached 12 reps; add the smallest load step.',
  });
});

test('keeps exact mixed loads and returns opt-in guidance for only the relevant set', () => {
  const plan = buildSetProgressionPlan({
    sets: [
      { reps: 10, loadValue: 42.5, loadUnit: 'kg', rpe: 8 },
      { reps: 8, loadValue: 40, loadUnit: 'kg', rpe: 9 },
      { reps: 9, loadValue: 37.5, loadUnit: 'kg', rpe: 9 },
    ],
    repMin: 8,
    repMax: 12,
    loadIncrement: 2.5,
  });
  assert.equal(plan.action, 'add_reps');
  assert.deepEqual(plan.cues, [{
    workingSetIndex: 1,
    action: 'add_reps',
    loadValue: 40,
    targetReps: 9,
    changePercent: null,
    label: 'Try 40 kg x 9 · +1 rep',
  }]);
});

test('increments every prior set independently and blocks a load jump without RPE', () => {
  const progressed = buildSetProgressionPlan({
    sets: [
      { reps: 12, loadValue: 42.5, loadUnit: 'kg', rpe: 8 },
      { reps: 12, loadValue: 40, loadUnit: 'kg', rpe: 9 },
    ],
    repMin: 8,
    repMax: 12,
    loadIncrement: 2.5,
  });
  assert.deepEqual(progressed.cues.map((cue) => cue.loadValue), [45, 42.5]);
  assert.deepEqual(progressed.cues.map((cue) => cue.targetReps), [8, 8]);

  const missingEffort = buildSetProgressionPlan({
    sets: [{ reps: 12, loadValue: 40, loadUnit: 'kg' }],
    repMin: 8,
    repMax: 12,
    loadIncrement: 2.5,
  });
  assert.equal(missingEffort.action, 'hold');
  assert.equal(missingEffort.cues.length, 0);
});

test('adds one rep to the lowest set and holds on a joint flag', () => {
  const addRep = suggestDoubleProgression({
    sets: [
      { reps: 10, loadValue: 40, loadUnit: 'kg' },
      { reps: 8, loadValue: 40, loadUnit: 'kg' },
      { reps: 9, loadValue: 40, loadUnit: 'kg' },
    ],
    repMin: 8,
    repMax: 12,
    loadIncrement: 2.5,
  });
  assert.equal(addRep.action, 'add_reps');
  if (addRep.action === 'add_reps') assert.deepEqual(addRep.targetReps, [10, 9, 9]);

  const hold = suggestDoubleProgression({
    sets: [{ reps: 12, loadValue: 40, loadUnit: 'kg' }],
    repMin: 8,
    repMax: 12,
    loadIncrement: 2.5,
    jointFlag: true,
  });
  assert.equal(hold.action, 'hold');
});

test('keeps rear delts and core as explicit volume buckets', () => {
  const result = aggregateWeeklyVolume([
    {
      reps: 12,
      loadValue: 10,
      loadUnit: 'kg',
      completedAt: '2026-08-10T10:00:00.000Z',
      movementPattern: 'horizontal_abduction',
      primaryMuscleGroup: 'rear_delts',
      secondaryMuscleGroups: ['upper_back'],
    },
    {
      reps: 15,
      loadValue: 20,
      loadUnit: 'kg',
      completedAt: '2026-08-10T10:05:00.000Z',
      movementPattern: 'spinal_flexion',
      primaryMuscleGroup: 'core',
      secondaryMuscleGroups: [],
    },
  ]);
  assert.equal(result[0]?.muscleGroups.rear_delts, 120);
  assert.equal(result[0]?.muscleGroups.upper_back, 60);
  assert.equal(result[0]?.muscleGroups.core, 300);
});

test('flags sustained stagnation and a twenty percent drop', () => {
  assert.equal(detectDeloadSignal([1000, 1010, 1015, 1020]).kind, 'stagnation');
  assert.equal(detectDeloadSignal([1200, 900]).kind, 'volume_drop');
  assert.equal(detectDeloadSignal([1000, 1100]).kind, 'none');
});
