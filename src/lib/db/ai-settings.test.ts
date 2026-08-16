import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAiConnectionStatus } from './ai-settings-contract.ts';

test('AI connection status parses only the safe non-secret response', () => {
  assert.deepEqual(parseAiConnectionStatus({
    configured: true,
    credentialSource: 'personal',
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    limits: { photoPerUtcDay: 5, contextPerUtcDay: 10 },
  }), {
    configured: true,
    credentialSource: 'personal',
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    limits: { photoPerUtcDay: 5, contextPerUtcDay: 10 },
  });
});

test('AI connection status rejects any incomplete response', () => {
  assert.throws(() => parseAiConnectionStatus({
    configured: true, credentialSource: 'personal', provider: 'gemini', model: '', limits: {},
  }));
});
