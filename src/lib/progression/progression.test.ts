import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateWeeklyVolume,
  buildMuscleGroupAdvisory,
  buildCompletedExerciseVolumeFeedback,
  buildMuscleGroupTrends,
  buildSetProgressionPlan,
  calculateOverloadChangePercent,
  calculateRecentExerciseBaseline,
  calculateSetVolumeKg,
  detectDeloadSignal,
  MUSCLE_GROUP_OPTIONS,
  muscleGroupLabel,
  normalizeMuscleGroupKey,
  suggestDoubleProgression,
} from './index.ts';
import { filterWorkoutHistory, groupWorkoutHistoryByMonth, summarizeExerciseHistory } from '../training/history.ts';

test('bodybuilding taxonomy includes specific traps, trunk, hip and lower-leg groups', () => {
  const groups = new Set<string>(MUSCLE_GROUP_OPTIONS.map((option) => option.value));
  for (const required of ['upper_traps', 'middle_traps', 'lower_traps', 'rhomboids', 'serratus_anterior', 'hip_abductors', 'hip_flexors', 'tibialis_anterior', 'neck']) {
    assert.equal(groups.has(required), true, `${required} should be selectable`);
  }
  assert.equal(normalizeMuscleGroupKey('external rotators'), 'rotator_cuff');
  assert.equal(normalizeMuscleGroupKey('trapezius'), 'upper_traps');
  assert.equal(muscleGroupLabel('middle_traps'), 'Middle traps');
});

test('compares only against a meaningful prior volume', () => {
  assert.equal(calculateOverloadChangePercent(1_050, 1_000), 5);
  assert.equal(calculateOverloadChangePercent(950, 1_000), -5);
  assert.equal(calculateOverloadChangePercent(100, 0), null);
});

test('normalizes pounds and ignores warm-up volume', () => {
  assert.ok(Math.abs(calculateSetVolumeKg({ reps: 10, loadValue: 100, loadUnit: 'lb' }) - 453.59237) < 0.001);
  assert.equal(calculateSetVolumeKg({ reps: 10, loadValue: 50, loadUnit: 'kg', kind: 'warmup' }), 0);
});

test('uses the median of up to three matching sessions as the recent exercise baseline', () => {
  const session = (loadValue: number) => [{ reps: 10, loadValue, loadUnit: 'kg' as const, kind: 'working' as const }];
  assert.deepEqual(calculateRecentExerciseBaseline([
    session(20),
    session(10),
    session(100),
    session(5),
  ]), { volumeKg: 200, sessionCount: 3 });
  assert.deepEqual(calculateRecentExerciseBaseline([session(10), session(20)]), {
    volumeKg: 150,
    sessionCount: 2,
  });
  assert.deepEqual(calculateRecentExerciseBaseline([[{ ...session(10)[0]!, kind: 'warmup' }]]), {
    volumeKg: null,
    sessionCount: 0,
  });
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

test('completed exercise review establishes a baseline without inventing a target', () => {
  const result = buildCompletedExerciseVolumeFeedback({
    currentSets: [
      { reps: 10, loadValue: 40, loadUnit: 'kg', rpe: 8 },
      { reps: 10, loadValue: 40, loadUnit: 'kg', rpe: 8 },
    ],
    baselineSessions: null,
    repMin: 8,
    repMax: 12,
    loadIncrement: 2.5,
  });
  assert.equal(result.status, 'baseline');
  assert.equal(result.currentVolumeKg, 800);
  assert.equal(result.targetVolumeKg, null);
  assert.equal(result.cues.length, 0);
});

test('completed exercise review confirms when the five-percent guide is reached', () => {
  const result = buildCompletedExerciseVolumeFeedback({
    currentSets: [{ reps: 11, loadValue: 10, loadUnit: 'kg', rpe: 8 }],
    baselineSessions: [[{ reps: 10, loadValue: 10, loadUnit: 'kg', rpe: 8 }]],
    repMin: 8,
    repMax: 12,
    loadIncrement: 2.5,
  });
  assert.equal(result.status, 'target_reached');
  assert.equal(result.changePercent, 10);
  assert.equal(result.cues.length, 0);
});

test('completed exercise review resists one unusually high recent session', () => {
  const result = buildCompletedExerciseVolumeFeedback({
    currentSets: [{ reps: 11, loadValue: 10, loadUnit: 'kg', rpe: 8 }],
    baselineSessions: [
      [{ reps: 30, loadValue: 10, loadUnit: 'kg', rpe: 10 }],
      [{ reps: 10, loadValue: 10, loadUnit: 'kg', rpe: 8 }],
      [{ reps: 9, loadValue: 10, loadUnit: 'kg', rpe: 8 }],
    ],
    repMin: 8,
    repMax: 12,
    loadIncrement: 2.5,
  });
  assert.equal(result.baselineVolumeKg, 100);
  assert.equal(result.baselineSessionCount, 3);
  assert.equal(result.changePercent, 10);
  assert.equal(result.status, 'target_reached');
});

test('completed exercise review offers one controlled rep toward the guide', () => {
  const sets = [0, 1, 2].map(() => ({ reps: 10, loadValue: 10, loadUnit: 'kg' as const, rpe: 8 }));
  const result = buildCompletedExerciseVolumeFeedback({
    currentSets: sets,
    baselineSessions: [sets],
    repMin: 8,
    repMax: 12,
    loadIncrement: 2.5,
  });
  assert.equal(result.status, 'progress');
  assert.equal(result.cueTiming, 'next_session');
  assert.deepEqual(result.cues.map((cue) => [cue.workingSetIndex, cue.targetReps]), [[0, 11]]);
  assert.ok(Math.abs((result.projectedChangePercent ?? 0) - (10 / 3)) < 0.001);
});

test('completed exercise review holds under joint or high-effort constraints', () => {
  const previousSets = [{ reps: 10, loadValue: 10, loadUnit: 'kg' as const, rpe: 8 }];
  const jointHold = buildCompletedExerciseVolumeFeedback({
    currentSets: previousSets,
    baselineSessions: [previousSets],
    repMin: 8,
    repMax: 12,
    loadIncrement: 2.5,
    jointFlag: true,
  });
  assert.equal(jointHold.status, 'hold');
  assert.equal(jointHold.cues.length, 0);

  const effortHold = buildCompletedExerciseVolumeFeedback({
    currentSets: [{ ...previousSets[0]!, reps: 12, rpe: 9.5 }],
    baselineSessions: [previousSets],
    repMin: 8,
    repMax: 12,
    loadIncrement: 2.5,
  });
  assert.equal(effortHold.status, 'hold');
  assert.equal(effortHold.cues.length, 0);
  assert.ok((effortHold.changePercent ?? 0) > 5, 'a high-effort hold outranks target celebration');
});

test('completed exercise review defers a load increase to the next session', () => {
  const topSets = [0, 1, 2].map(() => ({ reps: 12, loadValue: 40, loadUnit: 'kg' as const, rpe: 8 }));
  const result = buildCompletedExerciseVolumeFeedback({
    currentSets: topSets,
    baselineSessions: [topSets],
    repMin: 8,
    repMax: 12,
    loadIncrement: 2.5,
  });
  assert.equal(result.status, 'progress');
  assert.equal(result.cueTiming, 'next_session');
  assert.equal(result.cues.length, 3);
  assert.deepEqual(result.cues.map((cue) => [cue.loadValue, cue.targetReps]), [
    [42.5, 8],
    [42.5, 8],
    [42.5, 8],
  ]);
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
  assert.equal(chest?.status, 'steady', 'different reps do not inflate muscle-group set exposure');
  assert.equal(chest?.setChangePercent, 0);
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

test('builds next-workout focus from a four-week muscle baseline instead of the latest exercise', () => {
  const history = [
    ...session('2026-07-27T10:00:00.000Z', 8),
    ...session('2026-08-03T10:00:00.000Z', 10),
    ...session('2026-08-10T10:00:00.000Z', 12),
    ...session('2026-08-17T10:00:00.000Z', 9),
    {
      reps: 10, loadValue: 30, loadUnit: 'kg' as const, completedAt: '2026-08-24T10:00:00.000Z',
      movementPattern: 'vertical_pull', primaryMuscleGroup: 'lats', secondaryMuscleGroups: ['biceps'],
    },
  ];
  const advisory = buildMuscleGroupAdvisory(history, new Date('2026-08-27T12:00:00.000Z'));
  assert.equal(advisory.status, 'focus');
  assert.equal(advisory.baselineWeekCount, 4);
  assert.equal(advisory.focus[0]?.muscleGroup, 'chest');
  assert.equal(advisory.focus[0]?.baselineSetCredits, 3);
  assert.equal(advisory.focus[0]?.currentSetCredits, 0);
  assert.equal(advisory.focus.some((item) => item.muscleGroup === 'front_delts'), true);
});

test('pools exercise angles into muscle families and counts assisting work once', () => {
  const advisory = buildMuscleGroupAdvisory([
    {
      reps: 10, loadValue: 40, loadUnit: 'kg', completedAt: '2026-08-17T10:00:00.000Z',
      movementPattern: 'incline_push', primaryMuscleGroup: 'upper_chest', secondaryMuscleGroups: ['chest', 'triceps'],
    },
    {
      reps: 12, loadValue: 20, loadUnit: 'kg', completedAt: '2026-08-24T10:00:00.000Z',
      movementPattern: 'horizontal_push', primaryMuscleGroup: 'chest', secondaryMuscleGroups: ['triceps'],
    },
  ], new Date('2026-08-27T12:00:00.000Z'));
  const chest = advisory.coverage.find((item) => item.muscleGroup === 'chest');
  assert.equal(chest?.baselineSetCredits, 1, 'upper-chest and chest tags collapse without double credit');
  assert.equal(chest?.currentSetCredits, 1);
  assert.equal(advisory.status, 'covered');
});

test('does not suggest repeating a recent muscle gap as the next focus', () => {
  const history = [
    ...session('2026-08-10T10:00:00.000Z', 10),
    ...session('2026-08-17T10:00:00.000Z', 10),
    { ...session('2026-08-26T12:00:00.000Z', 10)[0]! },
  ];
  const advisory = buildMuscleGroupAdvisory(history, new Date('2026-08-27T12:00:00.000Z'));
  assert.equal(advisory.status, 'recovery');
  assert.equal(advisory.focus[0]?.trainedWithin48Hours, true);
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

test('filters workout history by exercise text and normalized muscle group, then preserves month order', () => {
  const workouts = [
    { id: 'a', title: 'Push', performedOn: '2026-08-20', exerciseNames: ['Machine Chest Press'], muscleGroups: ['chest'] },
    { id: 'b', title: 'Pull', performedOn: '2026-08-12', exerciseNames: ['Seated Cable Row'], muscleGroups: ['upper_back'] },
    { id: 'c', title: 'Legs', performedOn: '2026-07-30', exerciseNames: ['Leg Press'], muscleGroups: ['quads'] },
  ];
  assert.deepEqual(filterWorkoutHistory(workouts, 'cable', null).map((workout) => workout.id), ['b']);
  assert.deepEqual(filterWorkoutHistory(workouts, '', 'Quadriceps').map((workout) => workout.id), ['c']);
  assert.deepEqual(groupWorkoutHistoryByMonth(workouts).map((group) => [group.month, group.workouts.length]), [
    ['2026-08', 2],
    ['2026-07', 1],
  ]);
});

test('exercise history compares only the latest two completed sessions and plots chronologically', () => {
  const sessions = [
    { workoutId: 'latest', volumeKg: 1_050 },
    { workoutId: 'previous', volumeKg: 1_000 },
    { workoutId: 'older', volumeKg: 900 },
  ];
  const summary = summarizeExerciseHistory(sessions);
  assert.equal(summary.latest?.workoutId, 'latest');
  assert.equal(summary.previous?.workoutId, 'previous');
  assert.equal(summary.changePercent, 5);
  assert.equal(summary.maximumVolumeKg, 1_050);
  assert.deepEqual(summary.chronological.map((session) => session.workoutId), ['older', 'previous', 'latest']);
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
