import assert from 'node:assert/strict';
import test from 'node:test';

import { parseApiEnvelope } from './api-contract.ts';

test('parses the stable Edge Function success envelope', () => {
  assert.deepEqual(
    parseApiEnvelope({ data: { available: true }, requestId: 'server-request' }, 200, 'client-request'),
    { ok: true, data: { available: true }, requestId: 'server-request' },
  );
});

test('parses stable safe errors and preserves retryability', () => {
  assert.deepEqual(
    parseApiEnvelope({
      error: { code: 'PROVIDER_TIMEOUT', message: 'Photo analysis timed out.', retryable: true },
      requestId: 'server-request',
    }, 504, 'client-request'),
    {
      ok: false,
      error: { code: 'PROVIDER_TIMEOUT', message: 'Photo analysis timed out.', retryable: true },
      requestId: 'server-request',
    },
  );
});

test('rejects malformed success payloads without exposing raw response content', () => {
  assert.deepEqual(parseApiEnvelope({ items: [] }, 200, 'client-request'), {
    ok: false,
    error: {
      code: 'HTTP_200',
      message: 'The service returned an invalid response. Try again.',
      retryable: false,
    },
    requestId: 'client-request',
  });
});
