import assert from 'node:assert/strict';
import test from 'node:test';

import {
  legacyWorkoutDraftStorageKey,
  parseWorkoutDraft,
  prefillWorkoutSetFromHistory,
  summarizeWorkoutDraft,
  workoutDraftContext,
  workoutDraftStorageKey,
} from './workout-draft.ts';

const owner = 'c42da174-94bc-4b52-9df9-6476353e127a';

test('workout recovery drafts are account and route scoped', () => {
  const value = JSON.stringify({
    version: 1, ownerUserId: owner, workoutId: 'workout-1', context: 'new:2026-08-20',
    title: 'Push day', unit: 'kg', startedAt: null, updatedAt: '2026-08-20T12:00:00.000Z',
    blocks: [{ exerciseId: 'bench', sets: [{ load: '80', reps: '8', rpe: '8' }] }],
  });
  assert.equal(parseWorkoutDraft(value, owner, 'new:2026-08-20')?.blocks[0]?.sets[0]?.load, '80');
  assert.equal(parseWorkoutDraft(value, 'other-user', 'new:2026-08-20'), null);
  assert.equal(parseWorkoutDraft(value, owner, 'new:2026-08-21'), null);
  assert.match(workoutDraftStorageKey(owner, 'new:2026-08-20'), new RegExp(`${owner}.*new%3A2026-08-20`));
  assert.match(legacyWorkoutDraftStorageKey(owner, 'new:2026-08-20'), /workout-draft:v1/);
});

test('workout draft contexts keep edits, plans, templates and dates separate', () => {
  assert.equal(workoutDraftContext({ editWorkoutId: 'w1' }), 'edit:w1');
  assert.equal(workoutDraftContext({ planWorkoutId: 'p1' }), 'plan:p1');
  assert.equal(workoutDraftContext({ templateWorkoutId: 't1' }), 'template:t1');
  assert.equal(workoutDraftContext({ date: '2026-08-20' }), 'new:2026-08-20');
});

test('history prefills targets without copying observed effort or completion', () => {
  const existing = { load: '', reps: '', rpe: '', kind: 'working' as const, completed: false };
  assert.deepEqual(prefillWorkoutSetFromHistory(existing, { load: '82.5', reps: '9' }), {
    load: '82.5', reps: '9', rpe: '', kind: 'working', completed: false,
  });
  assert.deepEqual(prefillWorkoutSetFromHistory(
    { ...existing, rpe: '8' },
    { load: '82.5', reps: '9' },
  ), { ...existing, rpe: '8' });
});

test('version two drafts preserve performed state and set kind while version one remains recoverable', () => {
  const versionTwo = JSON.stringify({
    version: 2, ownerUserId: owner, workoutId: 'workout-2', context: 'new:2026-09-04',
    title: 'Pull', unit: 'kg', startedAt: null, updatedAt: '2026-09-04T10:00:00.000Z',
    restTimerSeconds: 90, restEndsAt: 1_800_000_000_000,
    blocks: [{ exerciseId: 'row', sets: [{ load: '50', reps: '10', rpe: '8', kind: 'warmup', completed: true }] }],
  });
  const parsed = parseWorkoutDraft(versionTwo, owner, 'new:2026-09-04');
  assert.equal(parsed?.version, 2);
  assert.equal(parsed?.blocks[0]?.sets[0]?.kind, 'warmup');
  assert.equal(parsed?.blocks[0]?.sets[0]?.completed, true);
  assert.equal(parsed?.restTimerSeconds, 90);

  const legacy = JSON.stringify({
    version: 1, ownerUserId: owner, workoutId: 'workout-1', context: 'new:2026-09-04',
    title: 'Pull', unit: 'kg', startedAt: null, updatedAt: '2026-09-04T09:00:00.000Z',
    blocks: [{ exerciseId: 'row', sets: [{ load: '50', reps: '10', rpe: '8' }] }],
  });
  assert.equal(parseWorkoutDraft(legacy, owner, 'new:2026-09-04')?.blocks[0]?.sets[0]?.completed, false);
});

test('only completed working sets contribute to the active workout summary', () => {
  assert.deepEqual(summarizeWorkoutDraft([{ sets: [
    { load: '20', reps: '10', rpe: '', kind: 'warmup', completed: true },
    { load: '40', reps: '8', rpe: '8', kind: 'working', completed: true },
    { load: '40', reps: '8', rpe: '', kind: 'working', completed: false },
  ] }]), {
    completedSetCount: 2,
    needsAttentionCount: 1,
    blankSetCount: 0,
    work: 320,
  });
});
