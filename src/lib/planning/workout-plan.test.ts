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
