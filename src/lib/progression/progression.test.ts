import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateWeeklyVolume,
  buildMuscleGroupAdvisory,
  buildCompletedExerciseVolumeFeedback,
  buildMuscleGroupTrends,
  buildMuscleVolumeDropFlags,
  buildSetProgressionPlan,
  calculateOverloadChangePercent,
  calculateRecentExerciseBaseline,
  calculateSetVolumeKg,
  detectDeloadSignal,
  detectExercisePlateau,
  MUSCLE_GROUP_OPTIONS,
  muscleGroupLabel,
  normalizeMuscleGroupKey,
  suggestDoubleProgression,
} from './index.ts';
import { filterWorkoutHistory, groupWorkoutHistoryByMonth, summarizeExerciseHistory } from '../training/history.ts';
import { summarizeTrainingMuscleContext } from '../../../supabase/functions/_shared/training-context.ts';
import { trainingSetSql } from '../../../supabase/functions/_shared/training-set-policy.ts';
import { liveSetTarget } from './live-set-target.ts';

test('live targets react to entered values without treating them as completed history', () => {
  const rows = [{ load: '20', reps: '10', rpe: '', kind: 'working' as const, completed: false },
    { load: '', reps: '', rpe: '', kind: 'working' as const, completed: false }];
  const input = { rows, rowIndex: 1, unit: 'kg' as const, history: [], plan: null, allowIncrease: true, jointHold: false };
  const before = JSON.stringify(rows);
  assert.equal(liveSetTarget(input)?.targetReps, 10);
  assert.match(liveSetTarget(input)!.reason, /not a progression baseline/);
  assert.equal(liveSetTarget({ ...input, rows: [{ ...rows[0]!, load: '25' }, rows[1]!] })?.loadValue, 25);
  assert.equal(liveSetTarget({ ...input, rows: [rows[0]!, { ...rows[1]!, completed: true }] }), null);
  assert.equal(liveSetTarget({ ...input, rows: [rows[0]!, { ...rows[1]!, load: '20', reps: '11' }] }), null);
  assert.equal(liveSetTarget({ ...input, rows: [rows[0]!, { ...rows[1]!, kind: 'warmup' }] }), null);
  assert.equal(liveSetTarget({ ...input, rows: [rows[0]!, { ...rows[1]!, kind: 'drop' }] }), null);
  assert.equal(JSON.stringify(rows), before);
});

test('history-based live targets respect effort, failure, plan choice and different loads on every edit', () => {
  const history = [{ loadValue: 20, loadUnit: 'kg' as const, reps: 10, rpe: 8, kind: 'working' as const }];
  const plan = buildSetProgressionPlan({ sets: history, repMin: 8, repMax: 12, loadIncrement: 2.5 });
  const rows = [{ load: '20', reps: '10', rpe: '', kind: 'working' as const, completed: false }];
  const input = { rows, rowIndex: 0, unit: 'kg' as const, history, plan, allowIncrease: true, jointHold: false };
  assert.equal(liveSetTarget(input)?.targetReps, 11);
  assert.equal(liveSetTarget({ ...input, allowIncrease: false }), null);
  assert.equal(liveSetTarget({ ...input, jointHold: true }), null);
  for (const rpe of ['9.5', '10', '0', 'bad']) assert.equal(liveSetTarget({ ...input, rows: [{ ...rows[0]!, rpe }] }), null);
  assert.equal(liveSetTarget({ ...input, rows: [{ ...rows[0]!, kind: 'failure' }] }), null);
  assert.equal(liveSetTarget({ ...input, rows: [{ ...rows[0]!, load: '50' }] }), null);
  assert.equal(liveSetTarget({ ...input, rows: [{ ...rows[0]!, load: 'bad' }] }), null);
  assert.equal(liveSetTarget({ ...input, rows: [{ ...rows[0]!, reps: '12' }] }), null);
  assert.equal(liveSetTarget({ ...input, rows: [{ ...rows[0]!, rpe: '8' }] })?.targetReps, 11);
});

test('mixed set accounting agrees across muscle guidance and Edge context without mixing drop baselines', () => {
  const sets = (['working', 'failure', 'drop', 'warmup'] as const).map((kind) => ({
    kind, reps: 10, loadValue: 20, loadUnit: 'kg' as const, rpe: null,
    completedAt: '2026-09-14T10:00:00.000Z', movementPattern: 'horizontal_push',
    primaryMuscleGroup: 'chest', secondaryMuscleGroups: ['triceps'],
  }));
  const weekly = aggregateWeeklyVolume(sets)[0]!;
  assert.equal(weekly.totalKg, 600);
  assert.equal(weekly.muscleGroupSets.chest, 3);
  assert.equal(weekly.muscleGroupSets.triceps, 1.5);
  assert.deepEqual(calculateRecentExerciseBaseline([sets]), { volumeKg: 400, sessionCount: 1 });
  const now = new Date('2026-09-15T12:00:00.000Z');
  const local = buildMuscleGroupAdvisory(sets, now);
  const remote = summarizeTrainingMuscleContext(
    [{ id: 'w', performed_on: '2026-09-14' }],
    sets.map((set) => ({ workout_id: 'w', exercise_id: 'press', kind: set.kind,
      reps: set.reps, load_value: set.loadValue, load_unit: set.loadUnit,
      primary_muscle_group: set.primaryMuscleGroup, secondary_muscle_groups: set.secondaryMuscleGroups })),
    [], now,
  );
  assert.equal(local.coverage.find((group) => group.muscleGroup === 'chest')?.currentSetCredits, 3);
  assert.deepEqual(remote.advisory.coverage.map((group) => [group.muscleGroup, group.currentSetCredits]),
    local.coverage.map((group) => [group.muscleGroup, group.currentSetCredits]));
  assert.throws(() => trainingSetSql('s.kind); DELETE FROM workout_sets'), /Invalid/);
});

test('failure counts as completed work but never earns an increase, even with missing or contradictory effort', () => {
  for (const rpe of [null, 8, 10]) {
    const failure = { reps: 12, loadValue: 40, loadUnit: 'kg' as const, kind: 'failure' as const, rpe };
    const input = { sets: [failure], repMin: 8, repMax: 12, loadIncrement: 2.5 };
    assert.equal(suggestDoubleProgression(input).action, 'hold');
    assert.deepEqual(buildSetProgressionPlan(input).cues, []);
    assert.match(buildSetProgressionPlan(input).reason, /Completed reps count/);
    const feedback = buildCompletedExerciseVolumeFeedback({
      ...input, currentSets: [failure],
      baselineSessions: [[{ ...failure, kind: 'working', reps: 10, rpe: 8 }]],
    });
    assert.equal(feedback.currentVolumeKg, 480);
    assert.equal(feedback.changePercent, 20);
    assert.equal(feedback.status, 'hold');
    assert.deepEqual(feedback.cues, []);
    assert.equal(failure.rpe, rpe, 'derived guidance never overwrites observed effort');
  }
});

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

test('plateau review requires three flat comparable sessions', () => {
  const flat = ['2026-08-03', '2026-08-10', '2026-08-17'].map((performedOn, index) => ({
    workoutId: `flat-${index}`,
    performedOn,
    completedAt: `${performedOn}T10:00:00.000Z`,
    sets: [{ reps: 10, loadValue: 40, loadUnit: 'kg' as const, kind: 'working' as const }],
  }));
  assert.equal(detectExercisePlateau(flat.slice(0, 2)).status, 'insufficient');
  const plateau = detectExercisePlateau(flat);
  assert.equal(plateau.status, 'plateau');
  assert.equal(plateau.windowStart, '2026-08-03');
  assert.equal(plateau.windowEnd, '2026-08-17');
});

test('a rep increase or a load increase with fewer reps breaks a plateau', () => {
  const base = ['2026-08-03', '2026-08-10', '2026-08-17'].map((performedOn, index) => ({
    workoutId: `progress-${index}`,
    performedOn,
    completedAt: `${performedOn}T10:00:00.000Z`,
    sets: [{ reps: 10, loadValue: 40, loadUnit: 'kg' as const, kind: 'working' as const }],
  }));
  const repIncrease = base.map((item, index) => index === 2
    ? { ...item, sets: [{ ...item.sets[0]!, reps: 11 }] }
    : item);
  assert.equal(detectExercisePlateau(repIncrease).status, 'progressing');
  assert.equal(detectExercisePlateau(repIncrease).topRepIncrease, true);

  const loadIncrease = base.map((item, index) => index === 2
    ? { ...item, sets: [{ ...item.sets[0]!, reps: 8, loadValue: 45 }] }
    : item);
  assert.equal(detectExercisePlateau(loadIncrease).status, 'progressing');
  assert.equal(detectExercisePlateau(loadIncrease).topLoadIncrease, true);
});

test('an exercise weekly-volume increase breaks otherwise flat session metrics', () => {
  const sessions = [
    { workoutId: 'week-one', performedOn: '2026-08-03', completedAt: '2026-08-03T10:00:00.000Z', sets: [{ reps: 10, loadValue: 40, loadUnit: 'kg' as const, kind: 'working' as const }] },
    { workoutId: 'week-two-a', performedOn: '2026-08-10', completedAt: '2026-08-10T10:00:00.000Z', sets: [{ reps: 10, loadValue: 40, loadUnit: 'kg' as const, kind: 'working' as const }] },
    { workoutId: 'week-two-b', performedOn: '2026-08-12', completedAt: '2026-08-12T10:00:00.000Z', sets: [{ reps: 10, loadValue: 40, loadUnit: 'kg' as const, kind: 'working' as const }] },
  ];
  const review = detectExercisePlateau(sessions);
  assert.equal(review.status, 'progressing');
  assert.equal(review.weeklyVolumeIncrease, true);
});

test('joint holds and drop-only sessions stay out of plateau comparisons', () => {
  const sessions = [
    { workoutId: 'one', performedOn: '2026-08-03', completedAt: '2026-08-03T10:00:00.000Z', sets: [{ reps: 10, loadValue: 40, loadUnit: 'kg' as const, kind: 'working' as const }] },
    { workoutId: 'joint', performedOn: '2026-08-10', completedAt: '2026-08-10T10:00:00.000Z', jointHold: true, sets: [{ reps: 10, loadValue: 40, loadUnit: 'kg' as const, kind: 'working' as const }] },
    { workoutId: 'drop', performedOn: '2026-08-12', completedAt: '2026-08-12T10:00:00.000Z', sets: [{ reps: 12, loadValue: 20, loadUnit: 'kg' as const, kind: 'drop' as const }] },
    { workoutId: 'two', performedOn: '2026-08-17', completedAt: '2026-08-17T10:00:00.000Z', sets: [{ reps: 10, loadValue: 40, loadUnit: 'kg' as const, kind: 'failure' as const }] },
  ];
  const review = detectExercisePlateau(sessions);
  assert.equal(review.status, 'insufficient');
  assert.equal(review.comparableSessionCount, 2);
});

test('flags a muscle week more than one third below its four-week work average', () => {
  const weeks = aggregateWeeklyVolume([
    ...session('2026-07-20T10:00:00.000Z', 10),
    ...session('2026-07-27T10:00:00.000Z', 10),
    ...session('2026-08-03T10:00:00.000Z', 10),
    ...session('2026-08-10T10:00:00.000Z', 10),
    { ...session('2026-08-17T10:00:00.000Z', 10)[0]! },
  ]);
  const flags = buildMuscleVolumeDropFlags(weeks, new Date('2026-08-24T12:00:00.000Z'));
  const chest = flags.find((flag) => flag.muscleGroup === 'chest');
  assert.equal(Math.round(chest?.dropPercent ?? 0), 67);
  assert.equal(chest?.completedWeek, '2026-W34');
  assert.equal(chest?.currentWorkKg, 400);
  assert.equal(chest?.fourWeekAverageWorkKg, 1_200);

  const boundary = aggregateWeeklyVolume([
    ...session('2026-07-20T10:00:00.000Z', 10),
    ...session('2026-07-27T10:00:00.000Z', 10),
    ...session('2026-08-03T10:00:00.000Z', 10),
    ...session('2026-08-10T10:00:00.000Z', 10),
    ...session('2026-08-17T10:00:00.000Z', 10).slice(0, 2),
  ]);
  assert.equal(buildMuscleVolumeDropFlags(boundary, new Date('2026-08-24T12:00:00.000Z'))
    .some((flag) => flag.muscleGroup === 'chest'), false, 'exactly one third below is not more than one third');
});

test('does not flag an empty in-progress week after steady completed weeks', () => {
  const weeks = aggregateWeeklyVolume([
    ...session('2026-09-21T10:00:00.000Z', 10),
    ...session('2026-09-28T10:00:00.000Z', 10),
    ...session('2026-10-05T10:00:00.000Z', 10),
    ...session('2026-10-12T10:00:00.000Z', 10),
    ...session('2026-10-19T10:00:00.000Z', 10),
  ]);

  assert.deepEqual(
    buildMuscleVolumeDropFlags(weeks, new Date('2026-10-26T09:00:00+08:00')),
    [],
  );
});

test('uses the local workout date for ISO week buckets around Singapore Monday', () => {
  const [week] = aggregateWeeklyVolume([{
    ...session('2026-10-25T16:30:00.000Z', 10)[0]!,
    performedOn: '2026-10-26',
  }]);

  assert.equal(week?.week, '2026-W44');
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

// #22 progress charts: pure aggregation over a large synthetic 2+ year history.
import type { ExerciseHistorySession } from '../db/types.ts';
import {
  buildExerciseWeeklyTrend,
  buildMuscleWeeklyTrend,
  PROGRESS_CHART_RANGES,
  progressChartMuscles,
} from '../training/progress-charts.ts';
import { isoWeekKey } from './index.ts';

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const CHART_END = new Date(2026, 9, 24, 9); // Saturday 2026-10-24, local time
const CHART_END_KEY = '2026-10-24';

/** About 2.5 years of 3 sessions/week (Mon/Wed/Fri), working sets 5–15 reps, some lb sets. */
function syntheticExerciseHistory(weeks = 130, seed = 22): ExerciseHistorySession[] {
  const random = seededRandom(seed);
  const sessions: ExerciseHistorySession[] = [];
  const lastMonday = addDays(CHART_END_KEY, -5);
  for (let week = weeks - 1; week >= 0; week -= 1) {
    for (const offset of [0, 2, 4]) {
      const performedOn = addDays(lastMonday, -week * 7 + offset);
      if (performedOn > CHART_END_KEY || random() < 0.1) continue; // ~10% missed sessions leave gaps
      const sets = Array.from({ length: 3 }, (_, index) => {
        const lb = random() < 0.15;
        const loadKg = Math.round((40 + (weeks - week) * 0.2 + random() * 10) * 2) / 2;
        return {
          id: `${performedOn}-${index}`,
          reps: 5 + Math.floor(random() * 11),
          loadValue: lb ? Math.round(loadKg / 0.45359237) : loadKg,
          loadUnit: lb ? 'lb' as const : 'kg' as const,
          rpe: null,
        };
      });
      const volumeKg = sets.reduce((sum, set) => sum + (set.loadUnit === 'lb' ? set.loadValue * 0.45359237 : set.loadValue) * set.reps, 0);
      sessions.push({ workoutId: `w-${performedOn}`, workoutTitle: 'Synthetic', performedOn, completedAt: `${performedOn}T10:00:00.000Z`, jointHold: false, volumeKg, sets });
    }
  }
  return sessions.reverse(); // newest first, like getExerciseSessionHistory
}

function expectedExerciseWeek(sessions: ExerciseHistorySession[], week: string, repMin: number, repMax: number) {
  const inWeek = sessions.filter((session) => isoWeekKey(session.performedOn) === week);
  let best: { loadKg: number; reps: number } | null = null;
  for (const set of inWeek.flatMap((session) => session.sets)) {
    if (set.reps < repMin || set.reps > repMax) continue;
    const loadKg = set.loadUnit === 'lb' ? set.loadValue * 0.45359237 : set.loadValue;
    if (!best || loadKg > best.loadKg || (loadKg === best.loadKg && set.reps > best.reps)) best = { loadKg, reps: set.reps };
  }
  return {
    volumeKg: Math.round(inWeek.reduce((sum, session) => sum + session.volumeKg, 0) * 100) / 100,
    bestLoadKg: best ? Math.round(best.loadKg * 100) / 100 : null,
    bestReps: best?.reps ?? null,
  };
}

test('#22 exercise trend over 2+ years: dense consecutive weeks ending this week, exact weekly volume and best in-range set', () => {
  const sessions = syntheticExerciseHistory();
  assert.ok(sessions.length > 300, `synthetic history has ${sessions.length} sessions`);
  assert.ok(sessions.at(-1)!.performedOn < addDays(CHART_END_KEY, -2 * 365), 'history spans more than two years');
  for (const range of PROGRESS_CHART_RANGES) {
    const points = buildExerciseWeeklyTrend(sessions, 8, 12, range, CHART_END);
    assert.equal(points.length, range);
    assert.equal(points.at(-1)!.week, isoWeekKey(CHART_END_KEY));
    assert.equal(points[0]!.week, isoWeekKey(addDays(CHART_END_KEY, -(range - 1) * 7)));
    assert.equal(new Set(points.map((point) => point.week)).size, range, 'no duplicate weeks');
    for (const point of points) {
      assert.deepEqual(Object.keys(point).sort(), ['bestLoadKg', 'bestReps', 'volumeKg', 'week'], 'no 1RM or estimate fields');
      assert.deepEqual({ volumeKg: point.volumeKg, bestLoadKg: point.bestLoadKg, bestReps: point.bestReps }, expectedExerciseWeek(sessions, point.week, 8, 12), point.week);
      if (point.bestReps != null) assert.ok(point.bestReps >= 8 && point.bestReps <= 12);
    }
  }
  // Shorter ranges are exact suffixes of the 52-week series.
  const year = buildExerciseWeeklyTrend(sessions, 8, 12, 52, CHART_END);
  assert.deepEqual(buildExerciseWeeklyTrend(sessions, 8, 12, 12, CHART_END), year.slice(-12));
  assert.deepEqual(buildExerciseWeeklyTrend(sessions, 8, 12, 26, CHART_END), year.slice(-26));
  // Deterministic and independent of input order.
  const shuffled = [...sessions].sort((a, b) => a.workoutId.localeCompare(b.workoutId) * (a.performedOn.endsWith('1') ? -1 : 1));
  assert.deepEqual(buildExerciseWeeklyTrend(shuffled, 8, 12, 52, CHART_END), year);
});

test('#22 exercise trend: out-of-range reps, older sessions, gaps, lb loads and ties', () => {
  const thisMonday = addDays(CHART_END_KEY, -5);
  const session = (performedOn: string, sets: Array<[number, number, 'kg' | 'lb']>): ExerciseHistorySession => ({
    workoutId: performedOn, workoutTitle: 'QA', performedOn, completedAt: `${performedOn}T10:00:00.000Z`, jointHold: false,
    volumeKg: sets.reduce((sum, [load, reps, unit]) => sum + (unit === 'lb' ? load * 0.45359237 : load) * reps, 0),
    sets: sets.map(([loadValue, reps, loadUnit], index) => ({ id: `${performedOn}-${index}`, reps, loadValue, loadUnit, rpe: null })),
  });
  const points = buildExerciseWeeklyTrend([
    session(thisMonday, [[100, 3, 'kg'], [60, 8, 'kg'], [60, 10, 'kg']]), // the heavy triple is outside 8–12: best is 60 × 10 (tie → more reps)
    session(addDays(thisMonday, -7), [[150, 8, 'lb']]), // 68.04 kg
    session(addDays(thisMonday, -14), [[50, 15, 'kg']]), // logged, but no in-range set
    session(addDays(thisMonday, -7 * 12), [[999, 10, 'kg']]), // older than 12 weeks: ignored
  ], 8, 12, 12, CHART_END);
  assert.deepEqual(points.at(-1), { week: isoWeekKey(thisMonday), volumeKg: 1380, bestLoadKg: 60, bestReps: 10 });
  assert.deepEqual(points.at(-2), { week: isoWeekKey(addDays(thisMonday, -7)), volumeKg: 544.31, bestLoadKg: 68.04, bestReps: 8 });
  assert.deepEqual(points.at(-3), { week: isoWeekKey(addDays(thisMonday, -14)), volumeKg: 750, bestLoadKg: null, bestReps: null });
  assert.ok(points.slice(0, -3).every((point) => point.volumeKg === 0 && point.bestLoadKg == null), 'empty weeks are zero, not interpolated');
  assert.ok(points.every((point) => point.bestLoadKg !== 999));
  assert.deepEqual(buildExerciseWeeklyTrend([], 8, 12, 26, CHART_END).filter((point) => point.volumeKg || point.bestLoadKg), []);
});

test('#22 week keys stay consecutive across a 53-week ISO year', () => {
  // ISO 2026 has 53 weeks; a 12-week window ending in early January 2027 must include 2026-W53 once.
  const weeks = buildExerciseWeeklyTrend([], 8, 12, 12, new Date(2027, 0, 6, 12)).map((point) => point.week);
  assert.deepEqual(weeks.slice(-3), ['2026-W52', '2026-W53', '2027-W01']);
  assert.equal(new Set(weeks).size, 12);
});

test('#22 muscle trend over 2+ years matches aggregateWeeklyVolume per week, with programme muscles listed even before training', () => {
  const random = seededRandom(7);
  const sets = [];
  for (let day = 0; day < 800; day += 2) {
    const performedOn = addDays(CHART_END_KEY, -day);
    for (let index = 0; index < 4; index += 1) {
      sets.push({
        reps: 6 + Math.floor(random() * 8), loadValue: 20 + Math.floor(random() * 60), loadUnit: 'kg' as const,
        kind: index === 0 ? 'warmup' as const : 'working' as const,
        completedAt: `${performedOn}T1${index}:00:00.000Z`, performedOn, movementPattern: 'squat',
        primaryMuscleGroup: day % 4 === 0 ? 'quads' : 'chest', secondaryMuscleGroups: day % 4 === 0 ? ['glutes'] : ['triceps'],
      });
    }
  }
  const started = performance.now();
  const weeks = aggregateWeeklyVolume(sets);
  const quads = buildMuscleWeeklyTrend(weeks, 'quads', 52, CHART_END);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1_000, `aggregation took ${elapsed.toFixed(1)} ms for ${sets.length} sets`);
  assert.equal(quads.length, 52);
  assert.equal(quads.at(-1)!.week, isoWeekKey(CHART_END_KEY));
  const byWeek = new Map(weeks.map((week) => [week.week, week]));
  for (const point of quads) {
    const week = byWeek.get(point.week);
    assert.equal(point.setCredits, Math.round((week?.muscleGroupSets.quads ?? 0) * 100) / 100);
    assert.equal(point.volumeKg, Math.round((week?.muscleGroups.quads ?? 0) * 100) / 100);
  }
  // Full weeks: 3 or 4 quad sessions × 3 working sets each (warm-ups excluded).
  assert.ok(quads.slice(1, -1).every((point) => point.setCredits >= 3 && point.setCredits <= 12), JSON.stringify(quads.map((point) => point.setCredits)));
  const glutes = buildMuscleWeeklyTrend(weeks, 'glutes', 12, CHART_END);
  assert.deepEqual(glutes.map((point) => point.setCredits), quads.slice(-12).map((point) => point.setCredits / 2), 'assisting muscles count 0.5');
  assert.deepEqual(buildMuscleWeeklyTrend(weeks, 'hamstrings', 12, CHART_END).map((point) => point.setCredits), Array(12).fill(0));
  assert.deepEqual(progressChartMuscles(weeks, ['hamstrings', 'chest']), ['chest', 'glutes', 'hamstrings', 'quads', 'triceps']);
  assert.deepEqual(progressChartMuscles([], ['lats']), ['lats']);
});

test('#22 20,000 synthetic sessions aggregate into a 52-week chart quickly', () => {
  const base = syntheticExerciseHistory();
  const sessions = Array.from({ length: 20_000 }, (_, index) => ({ ...base[index % base.length]!, workoutId: `w-${index}` }));
  const started = performance.now();
  const points = buildExerciseWeeklyTrend(sessions, 6, 12, 52, CHART_END);
  const elapsed = performance.now() - started;
  assert.equal(points.length, 52);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(1)} ms`);
});
