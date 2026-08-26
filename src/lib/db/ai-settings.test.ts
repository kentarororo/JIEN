import assert from 'node:assert/strict';
import test from 'node:test';

import { describeAiConnectionIssue, parseAiConnectionStatus } from './ai-settings-contract.ts';

test('AI connection status parses only the safe non-secret response', () => {
  assert.deepEqual(parseAiConnectionStatus({
    configured: true,
    credentialSource: 'personal',
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    usagePolicy: 'provider_managed',
    limits: { photoPerUtcDay: 1000, contextPerUtcDay: 1000 },
  }), {
    configured: true,
    credentialSource: 'personal',
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    usagePolicy: 'provider_managed',
    limits: null,
  });
});

test('AI connection status remains compatible with a legacy capped deployment', () => {
  assert.deepEqual(parseAiConnectionStatus({
    configured: true,
    credentialSource: 'app',
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    limits: { photoPerUtcDay: 5, contextPerUtcDay: 10 },
  }), {
    configured: true,
    credentialSource: 'app',
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    usagePolicy: 'legacy_daily_cap',
    limits: { photoPerUtcDay: 5, contextPerUtcDay: 10 },
  });
});

test('AI connection status rejects any incomplete response', () => {
  assert.throws(() => parseAiConnectionStatus({
    configured: true, credentialSource: 'personal', provider: 'gemini', model: '', limits: {},
  }));
});

test('AI connection errors distinguish a missing function from a rejected key', () => {
  assert.deepEqual(describeAiConnectionIssue({
    message: 'The service returned an invalid response. Try again.',
    code: 'HTTP_404',
    retryable: false,
    requestId: 'request-404',
  }), {
    code: 'HTTP_404',
    title: 'JIEN’s AI connector is not deployed',
    message: 'This build is missing the ai-settings Edge Function. Deploy the current Supabase functions, then try again.',
    requestId: 'request-404',
    retryable: false,
  });

  assert.equal(
    describeAiConnectionIssue({ message: 'Rejected', code: 'AI_KEY_INVALID' }).title,
    'Google rejected this key',
  );
});

test('AI connection errors identify a missing secure-store migration', () => {
  const issue = describeAiConnectionIssue({
    message: 'Save failed',
    code: 'AI_KEY_SAVE_FAILED',
    retryable: true,
    requestId: 'request-db',
  });
  assert.equal(issue.title, 'JIEN’s secure key store is not ready');
  assert.match(issue.message, /migration/i);
  assert.equal(issue.requestId, 'request-db');
});
