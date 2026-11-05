import assert from 'node:assert/strict';
import test from 'node:test';

import { completionFlow, supersetLabels } from './superset.ts';

const g1 = '11111111-1111-4111-8111-111111111111';
const g2 = '22222222-2222-4222-8222-222222222222';

test('groups get letters in order of first appearance and members are numbered A1, A2, A3', () => {
  const labels = supersetLabels([
    { key: 'squat', groupId: g1 },
    { key: 'press', groupId: g1 },
    { key: 'curl', groupId: null },
    { key: 'row', groupId: g2 },
    { key: 'dip', groupId: g2 },
    { key: 'lunge', groupId: g1 },
  ]);
  assert.deepEqual([...labels.entries()].map(([key, value]) => [key, value.label, value.memberCount]), [
    ['squat', 'A1', 3], ['press', 'A2', 3], ['lunge', 'A3', 3], ['row', 'B1', 2], ['dip', 'B2', 2],
  ]);
  assert.equal(labels.has('curl'), false, 'ungrouped exercises get no label');
});

test('letters continue past Z as AA, AB', () => {
  const blocks = Array.from({ length: 28 }, (_, index) => {
    const id = `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`;
    return [{ key: `${index}a`, groupId: id }, { key: `${index}b`, groupId: id }];
  }).flat();
  const labels = supersetLabels(blocks);
  assert.equal(labels.get('25a')!.label, 'Z1');
  assert.equal(labels.get('26b')!.label, 'AA2');
  assert.equal(labels.get('27a')!.label, 'AB1');
});

test('completing a set mid-round moves to the next exercise and does not start rest', () => {
  const blocks = [{ key: 'squat', groupId: g1 }, { key: 'press', groupId: g1 }, { key: 'row', groupId: g1 }];
  assert.deepEqual(completionFlow(blocks, 'squat'), { nextBlockKey: 'press', startsRest: false });
  assert.deepEqual(completionFlow(blocks, 'press'), { nextBlockKey: 'row', startsRest: false });
});

test('rest starts only after the last exercise in the round', () => {
  const blocks = [{ key: 'squat', groupId: g1 }, { key: 'press', groupId: g1 }];
  assert.deepEqual(completionFlow(blocks, 'press'), { nextBlockKey: null, startsRest: true });
});

test('ungrouped exercises keep the old behaviour: rest after every set, no jump', () => {
  const blocks = [{ key: 'curl', groupId: null }, { key: 'squat', groupId: g1 }, { key: 'press', groupId: g1 }];
  assert.deepEqual(completionFlow(blocks, 'curl'), { nextBlockKey: null, startsRest: true });
  assert.deepEqual(completionFlow(blocks, 'missing'), { nextBlockKey: null, startsRest: true });
});

test('group order follows exercise order even when an ungrouped exercise sits between members', () => {
  const blocks = [{ key: 'squat', groupId: g1 }, { key: 'curl', groupId: null }, { key: 'press', groupId: g1 }];
  assert.deepEqual(completionFlow(blocks, 'squat'), { nextBlockKey: 'press', startsRest: false });
  assert.equal(supersetLabels(blocks).get('press')!.label, 'A2');
});
