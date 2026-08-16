import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  parseWellnessChatResponse,
  withoutWellnessFailureMetadata,
  withWellnessFailureMetadata,
} from './wellness-chat-contract.ts';

const expected = {
  conversationId: '10000000-0000-4000-8000-000000000001',
  assistantMessageId: '10000000-0000-4000-8000-000000000003',
  assistantSequence: 3,
};

function response() {
  return {
    message: {
      id: expected.assistantMessageId,
      conversationId: expected.conversationId,
      sequence: expected.assistantSequence,
      content: 'Keep the deterministic targets unchanged. Not medical advice.',
      createdAt: '2026-08-16T01:02:03.000Z',
      model: 'gemini-2.5-flash',
    },
  };
}

test('accepts only the assistant reply reserved by the local retry request', () => {
  assert.deepEqual(parseWellnessChatResponse(response(), expected), response());
});

test('rejects mismatched ids, sequences, and malformed content', () => {
  const wrongId = response();
  wrongId.message.id = '10000000-0000-4000-8000-000000000009';
  assert.throws(() => parseWellnessChatResponse(wrongId, expected), /WELLNESS_RESPONSE_INVALID/);

  const wrongSequence = response();
  wrongSequence.message.sequence += 1;
  assert.throws(() => parseWellnessChatResponse(wrongSequence, expected), /WELLNESS_RESPONSE_INVALID/);

  const empty = response();
  empty.message.content = '   ';
  assert.throws(() => parseWellnessChatResponse(empty, expected), /WELLNESS_RESPONSE_INVALID/);

  const badDate = response();
  badDate.message.createdAt = 'yesterday';
  assert.throws(() => parseWellnessChatResponse(badDate, expected), /WELLNESS_RESPONSE_INVALID/);
});

test('failure metadata retains immutable retry data while bounding diagnostics', () => {
  const retry = {
    assistant_message_id: expected.assistantMessageId,
    mode: 'chat',
    plan_brief: { version: 1 },
  };
  const failed = withWellnessFailureMetadata(retry, Object.assign(new Error('Safe retry message.'), {
    code: 'AI_PROVIDER_TIMEOUT',
    retryable: true,
    requestId: 'request_1234',
  }));
  assert.equal(failed.assistant_message_id, expected.assistantMessageId);
  assert.deepEqual(failed.last_error, {
    code: 'AI_PROVIDER_TIMEOUT',
    message: 'Safe retry message.',
    retryable: true,
    request_id: 'request_1234',
  });
  assert.deepEqual(withoutWellnessFailureMetadata(failed), retry);
});

test('invalid response failures are classified without storing raw payloads', () => {
  const failed = withWellnessFailureMetadata({}, new Error('WELLNESS_RESPONSE_INVALID'));
  assert.deepEqual(failed.last_error, {
    code: 'INVALID_RESPONSE',
    message: 'The AI service returned an invalid response. You can retry it.',
    retryable: true,
    request_id: null,
  });
});

test('wellness repository validates envelopes and retains the reserved retry id', () => {
  const source = readFileSync(new URL('./wellness-chat.ts', import.meta.url), 'utf8');
  assert.match(source, /invokeEdgeFunctionEnvelope<unknown>/);
  assert.match(source, /parseWellnessChatResponse\(envelope\.data/);
  assert.match(source, /assistantMessageId: request\.assistantMessageId/);
  assert.match(source, /withWellnessFailureMetadata/);
  assert.match(source, /ON CONFLICT\(id\) DO UPDATE/);
});
