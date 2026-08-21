import assert from 'node:assert/strict';
import test from 'node:test';

import { parseWorkoutDraft, workoutDraftContext, workoutDraftStorageKey } from './workout-draft.ts';

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
});

test('workout draft contexts keep edits, plans, templates and dates separate', () => {
  assert.equal(workoutDraftContext({ editWorkoutId: 'w1' }), 'edit:w1');
  assert.equal(workoutDraftContext({ planWorkoutId: 'p1' }), 'plan:p1');
  assert.equal(workoutDraftContext({ templateWorkoutId: 't1' }), 'template:t1');
  assert.equal(workoutDraftContext({ date: '2026-08-20' }), 'new:2026-08-20');
});
