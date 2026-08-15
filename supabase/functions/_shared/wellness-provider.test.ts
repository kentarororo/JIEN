import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  requestWellnessGuidance,
  resolveWellnessProvider,
  WellnessProviderError,
  type WellnessProviderConfiguration,
} from './wellness-provider.ts';

const input = {
  system: 'Use only the supplied context. Do not change deterministic progression.',
  prompt: 'Question: How should I pace today? Context: one completed session.',
};

test('wellness provider selection is explicit and auto prefers Gemini', () => {
  const both = {
    GEMINI_API_KEY: 'gemini-key', GEMINI_MODEL: 'gemini-2.5-flash',
    ANTHROPIC_API_KEY: 'anthropic-key', ANTHROPIC_MODEL: 'claude-model',
  };
  const automatic = resolveWellnessProvider(both);
  assert.equal(automatic.ok && automatic.configuration.provider, 'gemini');

  const anthropic = resolveWellnessProvider({ ...both, WELLNESS_AI_PROVIDER: 'anthropic' });
  assert.equal(anthropic.ok && anthropic.configuration.provider, 'anthropic');

  assert.deepEqual(
    resolveWellnessProvider({ ...both, WELLNESS_AI_PROVIDER: 'gemini', GEMINI_MODEL: '' }),
    { ok: false, code: 'AI_NOT_CONFIGURED' },
    'an explicit provider must not silently fall through',
  );
});

test('Gemini wellness guidance sends system and context with only the JIEN server key', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const configuration: WellnessProviderConfiguration = {
    provider: 'gemini', apiKey: 'server-gemini-key', model: 'gemini-2.5-flash',
  };
  const result = await requestWellnessGuidance(configuration, input, {
    fetchImpl: async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return new Response(JSON.stringify({
        responseId: 'gemini-response',
        candidates: [{ content: { parts: [{ text: 'Hold the planned loads today. Not medical advice.' }] } }],
      }), { status: 200 });
    },
  });

  assert.equal(result.text, 'Hold the planned loads today. Not medical advice.');
  assert.equal(result.providerMessageId, 'gemini-response');
  assert.equal(requestUrl, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  const headers = requestInit?.headers as Record<string, string>;
  assert.equal(headers['x-goog-api-key'], 'server-gemini-key');
  assert.equal(Object.hasOwn(headers, 'Authorization'), false, 'the user Google token must never be forwarded');
  const body = JSON.parse(String(requestInit?.body));
  assert.equal(body.systemInstruction.parts[0].text, input.system);
  assert.equal(body.contents[0].parts[0].text, input.prompt);
  assert.equal(body.generationConfig.maxOutputTokens, 900);
});

test('Anthropic wellness guidance remains behind the same normalized contract', async () => {
  let requestInit: RequestInit | undefined;
  const result = await requestWellnessGuidance({
    provider: 'anthropic', apiKey: 'server-anthropic-key', model: 'claude-model',
  }, input, {
    fetchImpl: async (_url, init) => {
      requestInit = init;
      return new Response(JSON.stringify({
        id: 'anthropic-response',
        content: [{ type: 'text', text: 'Keep the deterministic target unchanged.' }],
      }), { status: 200 });
    },
  });

  assert.equal(result.providerMessageId, 'anthropic-response');
  const body = JSON.parse(String(requestInit?.body));
  assert.equal(body.system, input.system);
  assert.equal(body.messages[0].content, input.prompt);
});

test('wellness provider failures are bounded and safely classified', async () => {
  const configuration: WellnessProviderConfiguration = {
    provider: 'gemini', apiKey: 'secret', model: 'gemini-2.5-flash',
  };
  await assert.rejects(
    requestWellnessGuidance(configuration, input, {
      fetchImpl: async () => new Response('raw invalid-key details', { status: 401 }),
    }),
    (cause: unknown) => {
      assert.ok(cause instanceof WellnessProviderError);
      assert.equal(cause.code, 'AI_PROVIDER_CONFIGURATION_INVALID');
      assert.equal(cause.retryable, false);
      assert.doesNotMatch(cause.message, /invalid-key|secret/i);
      return true;
    },
  );
  await assert.rejects(
    requestWellnessGuidance(configuration, input, {
      fetchImpl: async () => { throw Object.assign(new Error('provider internals'), { name: 'AbortError' }); },
    }),
    (cause: unknown) => cause instanceof WellnessProviderError
      && cause.code === 'AI_PROVIDER_TIMEOUT'
      && cause.retryable,
  );
});

test('wellness Edge Function delegates provider traffic through the shared adapter', () => {
  const source = readFileSync(new URL('../wellness-chat/index.ts', import.meta.url), 'utf8');
  assert.match(source, /resolveWellnessProvider/);
  assert.match(source, /requestWellnessGuidance/);
  assert.doesNotMatch(source, /api\.anthropic\.com|generativelanguage\.googleapis\.com/);
  assert.match(source, /safeRequestId/);
});
