import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contextQueriesSucceeded,
  parseWellnessChatRequest,
  storedReplyMatchesRequest,
} from './wellness-contract.ts';

const ids = {
  conversationId: '10000000-0000-4000-8000-000000000001',
  userMessageId: '10000000-0000-4000-8000-000000000002',
  assistantMessageId: '10000000-0000-4000-8000-000000000003',
  exerciseId: '10000000-0000-4000-8000-000000000004',
};

function request() {
  return {
    version: 1,
    data: {
      conversationId: ids.conversationId,
      userMessageId: ids.userMessageId,
      assistantMessageId: ids.assistantMessageId,
      assistantSequence: 3,
      mode: 'plan_explanation',
      planBrief: {
        version: 1,
        generatedAt: '2026-08-16T01:02:03.000Z',
        sourceWorkoutId: null,
        sourceWorkoutTitle: 'Push day',
        activeJointFlag: false,
        weeklyVolumeKg: [1_200, 1_260],
        deloadSignal: { kind: 'none', message: 'No deload signal.' },
        exercises: [{
          exerciseId: ids.exerciseId,
          exerciseName: 'Chest press',
          action: 'add_reps',
          loadValue: 50,
          loadUnit: 'kg',
          targetReps: [10, 10, 9],
          reason: 'Add one rep while keeping load stable.',
        }],
      },
    },
  };
}

test('accepts the exact versioned wellness request without changing deterministic values', () => {
  const result = parseWellnessChatRequest(request());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.planBrief.exercises[0]?.action, 'add_reps');
  assert.equal(result.data.planBrief.exercises[0]?.loadValue, 50);
  assert.deepEqual(result.data.planBrief.exercises[0]?.targetReps, [10, 10, 9]);
});

test('rejects invalid envelopes, identifiers, modes, and sequences with stable codes', () => {
  assert.deepEqual(parseWellnessChatRequest({ version: 2, data: {} }), { ok: false, code: 'INVALID_ENVELOPE' });

  const invalidId = request();
  invalidId.data.assistantMessageId = 'not-a-uuid';
  assert.deepEqual(parseWellnessChatRequest(invalidId), { ok: false, code: 'INVALID_REQUEST' });

  const invalidMode = request();
  invalidMode.data.mode = 'diagnosis';
  assert.deepEqual(parseWellnessChatRequest(invalidMode), { ok: false, code: 'INVALID_MODE' });

  const invalidSequence = request();
  invalidSequence.data.assistantSequence = 0;
  assert.deepEqual(parseWellnessChatRequest(invalidSequence), { ok: false, code: 'INVALID_SEQUENCE' });
});

test('rejects coercible or out-of-contract deterministic plans', () => {
  const invalidAction = request();
  invalidAction.data.planBrief.exercises[0]!.action = 'increase_everything';
  assert.deepEqual(parseWellnessChatRequest(invalidAction), { ok: false, code: 'INVALID_PLAN' });

  const numericString = request();
  numericString.data.planBrief.exercises[0]!.loadValue = '50' as unknown as number;
  assert.deepEqual(parseWellnessChatRequest(numericString), { ok: false, code: 'INVALID_PLAN' });

  const unsafeReps = request();
  unsafeReps.data.planBrief.exercises[0]!.targetReps = [10, 0];
  assert.deepEqual(parseWellnessChatRequest(unsafeReps), { ok: false, code: 'INVALID_PLAN' });

  const nonCanonicalDate = request();
  nonCanonicalDate.data.planBrief.generatedAt = 'not-a-date';
  assert.deepEqual(parseWellnessChatRequest(nonCanonicalDate), { ok: false, code: 'INVALID_PLAN' });
});

test('required live-context query failures are detected before provider use', () => {
  assert.equal(contextQueriesSucceeded({ data: [], error: null }, { data: [], error: null }), true);
  assert.equal(contextQueriesSucceeded({ data: [], error: { code: 'timeout' } }), false);
  assert.equal(contextQueriesSucceeded(undefined), false);
});

test('idempotent retries accept only the reserved assistant row', () => {
  const parsed = parseWellnessChatRequest(request());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const row = {
    id: ids.assistantMessageId,
    user_id: '10000000-0000-4000-8000-000000000010',
    conversation_id: ids.conversationId,
    sequence: 3,
    role: 'assistant',
    deleted_at: null,
  };
  assert.equal(storedReplyMatchesRequest(row, parsed.data), true);
  assert.equal(storedReplyMatchesRequest({ ...row, sequence: 5 }, parsed.data), false);
  assert.equal(storedReplyMatchesRequest({ ...row, conversation_id: ids.userMessageId }, parsed.data), false);
});
