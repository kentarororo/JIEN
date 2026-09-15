import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProgrammeProgress, parseTrainingProgramme, type ProgrammeHistorySet, type TrainingProgramme } from './training-programme.ts';

import type { Exercise } from '../db/types.ts';

const targetProgramme: TrainingProgramme = { version: 1, goal: 'muscle', sessionsPerWeek: 3,
  targets: [{ muscleGroup: 'chest', weeklySetCredits: 8 }, { muscleGroup: 'triceps', weeklySetCredits: 5 }] };
const programmeSet: ProgrammeHistorySet = { workoutId: 'one', performedOn: '2026-09-14', completedAt: '2026-09-14T12:00:00Z',
  movementPattern: 'horizontal_push', primaryMuscleGroup: 'upper_chest', secondaryMuscleGroups: ['chest', 'triceps', 'triceps'],
  reps: 10, loadValue: 0, loadUnit: 'kg', kind: 'working' };

test('programme targets validate user-entered choices without inventing prescriptions', () => {
  assert.deepEqual(parseTrainingProgramme(JSON.stringify(targetProgramme)), targetProgramme);
  for (const value of [null, 'bad', [], {}, { ...targetProgramme, version: 2 }, { ...targetProgramme, goal: 'magic' },
    ...[0, 1.5, 8, '3', Infinity].map((sessionsPerWeek) => ({ ...targetProgramme, sessionsPerWeek })),
    { ...targetProgramme, targets: [] }, { ...targetProgramme, targets: Array(7).fill(targetProgramme.targets[0]) },
    { ...targetProgramme, targets: [targetProgramme.targets[0], targetProgramme.targets[0]] },
    ...['upper_chest', 'unknown'].map((muscleGroup) => ({ ...targetProgramme, targets: [{ muscleGroup, weeklySetCredits: 8 }] })),
    ...[0, 0.25, 40.5, NaN, Infinity, '8'].map((weeklySetCredits) => ({ ...targetProgramme, targets: [{ muscleGroup: 'chest', weeklySetCredits }] })),
  ]) assert.equal(parseTrainingProgramme(value), null, JSON.stringify(value));
  for (const weeklySetCredits of [0.5, 8.5, 40]) assert.ok(parseTrainingProgramme({ ...targetProgramme, targets: [{ muscleGroup: 'chest', weeklySetCredits }] }));
});

test('programme separates chosen targets, habitual history, completed work and the recent-training cue', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  const history = [
    { ...programmeSet, performedOn: '2026-09-07' }, // last week, entered retrospectively
    programmeSet, { ...programmeSet, kind: 'failure' as const }, { ...programmeSet, kind: 'drop' as const },
    { ...programmeSet, kind: 'warmup' as const }, { ...programmeSet, performedOn: '2026-09-18' },
    { ...programmeSet, performedOn: '2026-02-31' }, { ...programmeSet, reps: 0 }, { ...programmeSet, loadValue: -1 },
  ];
  const result = buildProgrammeProgress(targetProgramme, history, now);
  assert.equal(result.baselineWeekCount, 1);
  assert.deepEqual(result.rows.map((row) => [row.muscleGroup, row.completed, row.usual, row.remaining, row.trainedRecently]),
    [['chest', 3, 1, 5, false], ['triceps', 1.5, 0.5, 3.5, false]]);
  assert.equal(result.focus.length, 2);
  const recent = buildProgrammeProgress(targetProgramme, [{ ...programmeSet, completedAt: now.toISOString() }], now);
  assert.equal(recent.focus.length, 0, 'recent work suppresses routine highlighting, not credit');
  assert.equal(recent.rows[0]?.completed, 1);
  assert.equal(recent.rows[0]?.usual, null, 'missing history is not zero habitual training');
  const met = buildProgrammeProgress({ ...targetProgramme, targets: [{ muscleGroup: 'chest', weeklySetCredits: 0.5 }] }, [programmeSet], now);
  assert.equal(met.rows[0]?.remaining, 0);
  assert.equal(met.focus.length, 0, 'meeting a goal never silently increases it');
});

test('programme targets use the local calendar week, including Monday just after midnight', () => {
  const now = new Date(2026, 8, 14, 0, 5);
  const result = buildProgrammeProgress(targetProgramme, [
    { ...programmeSet, performedOn: '2026-09-13', completedAt: new Date(2026, 8, 13, 10).toISOString() },
    { ...programmeSet, performedOn: '2026-09-14', completedAt: now.toISOString() },
  ], now);
  assert.equal(result.rows[0]?.completed, 1);
  assert.equal(result.rows[0]?.usual, 1);
});
import { DEFAULT_EXERCISES } from '../db/migrate.ts';
import {
  ROUTINE_STARTERS,
  TRAINING_SPLITS,
  rankRoutineStarters,
  repeatedMovementPatterns,
  resolveRoutineStarter,
  routineStarterForProgram,
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
  assert.deepEqual(TRAINING_SPLITS.map((split) => split.id), ['push_pull_legs', 'upper_lower', 'full_body']);
});

test('programme sessions advance deterministically and wrap without losing the split', () => {
  assert.equal(routineStarterForProgram('push_pull_legs', 0).id, 'push');
  assert.equal(routineStarterForProgram('push_pull_legs', 1).id, 'pull');
  assert.equal(routineStarterForProgram('push_pull_legs', 2).id, 'legs');
  assert.equal(routineStarterForProgram('push_pull_legs', 3).id, 'push');
  assert.equal(routineStarterForProgram('upper_lower', 7).id, 'lower');
  assert.equal(routineStarterForProgram('full_body', 12).id, 'full_body');
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
