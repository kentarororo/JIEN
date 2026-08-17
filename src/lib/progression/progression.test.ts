import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateWeeklyVolume,
  buildMuscleGroupTrends,
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

  const planHold = buildSetProgressionPlan({
    sets: [{ reps: 12, loadValue: 40, loadUnit: 'kg', rpe: 8 }],
    repMin: 8,
    repMax: 12,
    loadIncrement: 2.5,
    jointFlag: true,
  });
  assert.equal(planHold.action, 'hold');
  assert.deepEqual(planHold.cues, []);
  assert.match(planHold.reason, /previous sets remain visible/i);
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
  assert.equal(result[0]?.muscleGroupSets.rear_delts, 1);
  assert.equal(result[0]?.muscleGroupSets.upper_back, 0.5);
});

test('turns a month of logged workouts into readable body-part trends and a next-session cue', () => {
  const weeks = aggregateWeeklyVolume([
    ...session('2026-07-20T10:00:00.000Z', 8),
    ...session('2026-07-27T10:00:00.000Z', 9),
    ...session('2026-08-03T10:00:00.000Z', 10),
    ...session('2026-08-10T10:00:00.000Z', 12),
    {
      reps: 15, loadValue: 0, loadUnit: 'kg', completedAt: '2026-08-10T10:30:00.000Z',
      movementPattern: 'hip_flexion', primaryMuscleGroup: 'core', secondaryMuscleGroups: [],
    },
  ]);
  const trends = buildMuscleGroupTrends(weeks, 4, new Date('2026-08-17T12:00:00.000Z'));
  const chest = trends.find((trend) => trend.muscleGroup === 'chest');
  const triceps = trends.find((trend) => trend.muscleGroup === 'triceps');
  const core = trends.find((trend) => trend.muscleGroup === 'core');

  assert.equal(weeks.length, 4);
  assert.equal(chest?.activeWeeks, 4);
  assert.equal(chest?.currentSetEquivalents, 3);
  assert.equal(chest?.previousSetEquivalents, 3);
  assert.equal(chest?.workChangePercent, 20);
  assert.equal(chest?.status, 'up');
  assert.equal(triceps?.currentSetEquivalents, 1.5, 'secondary muscles receive half-set credit');
  assert.equal(core?.currentSetEquivalents, 1, 'zero-load bodyweight work still counts as a working set');

  const next = buildSetProgressionPlan({
    sets: [8, 8, 8].map(() => ({ reps: 12, loadValue: 40, loadUnit: 'kg' as const, rpe: 8 })),
    repMin: 8,
    repMax: 12,
    loadIncrement: 2.5,
  });
  assert.equal(next.action, 'add_load');
  assert.deepEqual(next.cues.map((cue) => [cue.loadValue, cue.targetReps]), [[42.5, 8], [42.5, 8], [42.5, 8]]);
});

test('does not call a partially logged current week a body-part decline', () => {
  const weeks = aggregateWeeklyVolume([
    ...session('2026-08-10T10:00:00.000Z', 12),
    { ...session('2026-08-17T10:00:00.000Z', 8)[0]! },
  ]);
  const chest = buildMuscleGroupTrends(weeks, 4, new Date('2026-08-17T12:00:00.000Z'))
    .find((trend) => trend.muscleGroup === 'chest');
  assert.equal(chest?.isPartialWeek, true);
  assert.equal(chest?.status, 'partial');
});

test('does not call an untrained body part inactive while the current week is still partial', () => {
  const weeks = aggregateWeeklyVolume([
    ...session('2026-08-10T10:00:00.000Z', 12),
    {
      completedAt: '2026-08-17T10:00:00.000Z', reps: 8, loadValue: 40, loadUnit: 'kg', kind: 'working',
      movementPattern: 'horizontal_push', primaryMuscleGroup: 'chest', secondaryMuscleGroups: ['triceps'],
    },
  ]);
  const frontDelts = buildMuscleGroupTrends(weeks, 4, new Date('2026-08-17T12:00:00.000Z'))
    .find((trend) => trend.muscleGroup === 'front_delts');
  assert.equal(frontDelts?.currentSetEquivalents, 0);
  assert.equal(frontDelts?.status, 'partial');
});

test('flags sustained stagnation and a twenty percent drop', () => {
  assert.equal(detectDeloadSignal([1000, 1010, 1015, 1020]).kind, 'stagnation');
  assert.equal(detectDeloadSignal([1200, 900]).kind, 'volume_drop');
  assert.equal(detectDeloadSignal([1000, 1100]).kind, 'none');
});

function session(completedAt: string, reps: number) {
  return [0, 1, 2].map(() => ({
    reps,
    loadValue: 40,
    loadUnit: 'kg' as const,
    completedAt,
    movementPattern: 'horizontal_push',
    primaryMuscleGroup: 'chest',
    secondaryMuscleGroups: ['triceps', 'front_delts'],
  }));
}
