import assert from 'node:assert/strict';
import test from 'node:test';

import type { Exercise, WorkoutSet } from '../db/types.ts';
import {
  applyStoredJointConsiderationHold,
  buildPlannedWorkoutExercise,
  hasStoredJointConsideration,
  parsePlannedWorkoutPlan,
  rebuildPlannedWorkoutProgression,
} from './workout-plan.ts';
import { applySessionApproach } from './session-approach.ts';
import { recommendNextSession, SESSION_REFERENCE_MAX_AGE_DAYS } from './next-session-recommendation.ts';

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

test('failure-only history remains usable and preserves its hold through plan save, parse and rebuilding', () => {
  const history = [{ ...set(12, 40, null), kind: 'failure' as const }];
  const before = JSON.stringify(history);
  const planned = buildPlannedWorkoutExercise({ exercise, history, preferredLoadUnit: 'kg' });
  assert.equal(planned.sets.length, 1);
  assert.equal(planned.sets[0]?.sourceKind, 'failure');
  assert.equal(planned.sets[0]?.rpe, null, 'no synthetic RPE');
  assert.equal(planned.progression.action, 'hold');
  const parsed = parsePlannedWorkoutPlan(JSON.stringify({ version: 1, exercises: [planned] }));
  assert.ok(parsed);
  for (const jointFlag of [true, false]) {
    const rebuilt = rebuildPlannedWorkoutProgression(parsed.exercises, [exercise], jointFlag);
    assert.equal(rebuilt[0]?.progression.action, 'hold');
    assert.deepEqual(rebuilt[0]?.progression.cues, []);
  }
  assert.equal(JSON.stringify(history), before);
  assert.equal(parsePlannedWorkoutPlan({ version: 1, exercises: [{ ...planned,
    sets: [{ ...planned.sets[0], sourceKind: 'made_up' }] }] }), null);
});

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

test('stored profile considerations preserve prior sets and suppress progression cues', () => {
  assert.equal(hasStoredJointConsideration(['  ', 'right wrist']), true);
  assert.equal(hasStoredJointConsideration(['', '  ']), false);
  assert.equal(hasStoredJointConsideration(undefined), false);

  const plan = buildPlannedWorkoutExercise({
    exercise,
    history: [set(12, 40, 8), set(12, 40, 9)],
    preferredLoadUnit: 'kg',
    jointFlag: hasStoredJointConsideration(['right wrist—avoid loaded extension']),
  });

  assert.deepEqual(plan.sets.map((item) => [item.loadValue, item.reps]), [[40, 12], [40, 12]]);
  assert.equal(plan.progression.action, 'hold');
  assert.deepEqual(plan.progression.cues, []);
  assert.match(plan.progression.reason, /saved joint or injury consideration/i);
  assert.match(plan.progression.reason, /no load or rep increase/i);

  const savedPlan = { version: 1 as const, exercises: [{ ...plan, progression: {
    action: 'add_load' as const,
    reason: 'Previously saved increase.',
    cues: [{
      workingSetIndex: 0,
      action: 'add_load' as const,
      loadValue: 42.5,
      targetReps: 8,
      changePercent: 6.25,
      label: 'Try 42.5 kg x 8',
    }],
  } }] };
  const overlaid = applyStoredJointConsiderationHold(savedPlan, true);
  assert.equal(overlaid?.exercises[0]?.progression.action, 'hold');
  assert.deepEqual(overlaid?.exercises[0]?.progression.cues, []);
  assert.equal(savedPlan.exercises[0]?.progression.action, 'add_load');

  const continuedPlan = { ...savedPlan, jointProgressionChoice: 'continue' as const };
  assert.equal(applyStoredJointConsiderationHold(continuedPlan, true)?.exercises[0]?.progression.action, 'add_load');

  const [continued] = rebuildPlannedWorkoutProgression(overlaid?.exercises ?? [], [exercise], false);
  assert.equal(continued?.progression.action, 'add_load');
  assert.deepEqual(continued?.progression.cues.map((cue) => cue.loadValue), [42.5, 42.5]);
});

test('planned workout parsing rejects malformed provider or sync content', () => {
  const validExercise = buildPlannedWorkoutExercise({ exercise, history: [set(10, 40, 8)], preferredLoadUnit: 'kg' });
  assert.ok(parsePlannedWorkoutPlan(JSON.stringify({ version: 1, exercises: [validExercise] })));
  assert.equal(parsePlannedWorkoutPlan({ version: 1, exercises: [validExercise], jointProgressionChoice: 'continue' })?.jointProgressionChoice, 'continue');
  const programme = parsePlannedWorkoutPlan({
    version: 1,
    exercises: [validExercise],
    programContext: {
      splitId: 'push_pull_legs',
      sessionIndex: 4,
      availableMinutes: 45,
      missedSessionPolicy: 'reschedule',
    },
  });
  assert.deepEqual(programme?.programContext, {
    splitId: 'push_pull_legs',
    sessionIndex: 4,
    availableMinutes: 45,
    missedSessionPolicy: 'reschedule',
  });
  assert.equal(parsePlannedWorkoutPlan({ version: 1, exercises: [validExercise], jointProgressionChoice: 'always' }), null);
  assert.equal(parsePlannedWorkoutPlan({ version: 1, exercises: [validExercise], sessionApproach: 'ease_off' })?.sessionApproach, 'ease_off');
  assert.equal(parsePlannedWorkoutPlan({ version: 1, exercises: [validExercise], sessionApproach: 'max_out' }), null);
  assert.equal(parsePlannedWorkoutPlan({ version: 1, exercises: [validExercise], programContext: {
    splitId: 'push_pull_legs', sessionIndex: -1, availableMinutes: 45, missedSessionPolicy: 'reschedule',
  } }), null);
  assert.equal(parsePlannedWorkoutPlan({ version: 1, exercises: [validExercise], programContext: {
    splitId: 'upper_lower', sessionIndex: 1, availableMinutes: 75, missedSessionPolicy: 'skip',
  } }), null);
  assert.equal(parsePlannedWorkoutPlan('{bad json'), null);
  assert.equal(parsePlannedWorkoutPlan({ version: 1, exercises: [{ ...validExercise, sets: [{ loadValue: -1, loadUnit: 'kg', reps: 8 }] }] }), null);
});

test('post-session approaches preserve history and make their plan effect explicit', () => {
  const base = buildPlannedWorkoutExercise({
    exercise,
    history: [set(12, 40, 8), set(12, 40, 8), set(12, 40, 8)],
    preferredLoadUnit: 'kg',
  });

  const progress = applySessionApproach(base, 'progress');
  assert.deepEqual(progress.sets, base.sets);
  assert.equal(progress.progression.action, 'add_load');

  const repeat = applySessionApproach(base, 'repeat');
  assert.deepEqual(repeat.sets, base.sets);
  assert.equal(repeat.progression.action, 'hold');
  assert.deepEqual(repeat.progression.cues, []);
  assert.match(repeat.progression.reason, /no increase/i);

  const easier = applySessionApproach(base, 'ease_off');
  assert.equal(easier.sets.length, 2);
  assert.deepEqual(easier.sets, base.sets.slice(0, 2));
  assert.equal(easier.progression.action, 'hold');
  assert.deepEqual(easier.progression.cues, []);
  assert.match(easier.progression.reason, /one working set was removed/i);

  assert.equal(base.sets.length, 3);
  assert.equal(base.progression.action, 'add_load');
  const rebuilt = rebuildPlannedWorkoutProgression([easier], [exercise], false, 'ease_off');
  assert.equal(rebuilt[0]?.sets.length, 2, 'recalculation must not remove another set');
  assert.deepEqual(rebuilt[0]?.progression.cues, []);
});

test('ease off never removes the only working set', () => {
  const base = buildPlannedWorkoutExercise({
    exercise,
    history: [set(10, 40, 8)],
    preferredLoadUnit: 'kg',
  });
  const easier = applySessionApproach(base, 'ease_off');
  assert.equal(easier.sets.length, 1);
  assert.match(easier.progression.reason, /has one working set/i);
});

const reviewNow = new Date('2026-09-14T12:00:00.000Z');
const recentReview = { completedAt: '2026-09-13T12:00:00.000Z', now: reviewNow };

test('recommendation requires usable sets and never treats absent effort as readiness', () => {
  assert.equal(recommendNextSession({ ...recentReview, sets: [] }).approach, null);
  assert.equal(recommendNextSession({ ...recentReview, sets: [{ ...set(12, 40, 8), kind: 'warmup' }] }).approach, null);
  assert.equal(recommendNextSession({ ...recentReview, sets: [{ ...set(12, 40, 8), kind: 'drop' }] }).approach, null);
  for (const rpe of [null, NaN, 0]) {
    assert.equal(recommendNextSession({ ...recentReview, sets: [set(10, 40, rpe)], feedback: 'as_expected' }).code, 'missing_effort');
  }
  for (const invalid of [{ loadValue: -1 }, { reps: 1.5 }, { targetRepMin: 0 }, { targetRepMax: 2 }, { loadIncrement: NaN }]) {
    assert.equal(recommendNextSession({ ...recentReview, sets: [{ ...set(10, 40, 8), ...invalid }] }).approach, null);
  }
});

test('recommendation honours failure, high effort and profile considerations before increases', () => {
  const failure = { ...set(12, 40, null), kind: 'failure' as const };
  assert.equal(recommendNextSession({ ...recentReview, sets: [failure] }).code, 'failure');
  assert.equal(recommendNextSession({ ...recentReview, sets: [set(12, 40, 10)] }).code, 'high_effort');
  assert.equal(recommendNextSession({ ...recentReview, sets: [set(12, 40, 8)], jointFlag: true, feedback: 'harder' }).code, 'joint_review');
  assert.equal(recommendNextSession({ ...recentReview, sets: [set(12, 40, 8), { ...failure, exerciseId: 'other' }] }).approach, 'repeat');
});

test('fresh feedback suggests a lighter plan only when a main set can be removed', () => {
  const sets = [set(10, 40, 8), set(10, 40, 8)];
  const untouched = JSON.stringify(sets);
  for (const feedback of ['harder', 'returning'] as const) {
    const advice = recommendNextSession({ ...recentReview, sets, feedback });
    assert.equal(advice.approach, 'ease_off');
    const plan = applySessionApproach(buildPlannedWorkoutExercise({ exercise, history: sets, preferredLoadUnit: 'kg' }), advice.approach!);
    assert.equal(plan.sets.length, 1);
    assert.equal(plan.sets[0]?.loadValue, 40);
    assert.deepEqual(plan.progression.cues, []);
    assert.equal(recommendNextSession({ ...recentReview, sets: [sets[0]!], feedback }).code, 'single_sets');
    assert.equal(recommendNextSession({ ...recentReview, sets: [sets[0]!, { ...sets[1]!, kind: 'drop' }], feedback }).code, 'single_sets');
  }
  assert.equal(JSON.stringify(sets), untouched);
});

test('recommendation distinguishes an old reference from a claimed training break', () => {
  const sets = [set(10, 40, 8)];
  const boundary = reviewNow.getTime() - SESSION_REFERENCE_MAX_AGE_DAYS * 86_400_000;
  assert.equal(recommendNextSession({ sets, now: reviewNow, completedAt: new Date(boundary).toISOString() }).approach, 'progress');
  for (const completedAt of [new Date(boundary - 1).toISOString(), null, 'invalid', '2027-01-01']) {
    assert.equal(recommendNextSession({ sets, now: reviewNow, completedAt }).code, 'old_reference');
  }
  assert.equal(recommendNextSession({ ...recentReview, sets, startedAt: '2026-08-01T12:00:00Z' }).code, 'old_reference',
    'recording an old workout today does not make its training recent');
});

test('eligible recommendation keeps rep and load targets in the existing per-exercise engine', () => {
  for (const reps of [10, 12]) {
    const sets = [set(reps, 40, 8), set(reps, 40, 9)];
    const advice = recommendNextSession({ ...recentReview, sets });
    assert.equal(advice.approach, 'progress');
    const original = buildPlannedWorkoutExercise({ exercise, history: sets, preferredLoadUnit: 'kg' });
    const plan = applySessionApproach(original, advice.approach!);
    assert.deepEqual(plan, original);
    assert.equal(plan.progression.action, reps === 12 ? 'add_load' : 'add_reps');
  }
  const mixed = [set(10, 40, 8), { ...set(12, 80, 8), exerciseId: 'second', loadUnit: 'lb' as const }];
  assert.equal(recommendNextSession({ ...recentReview, sets: mixed }).approach, 'progress');
});
