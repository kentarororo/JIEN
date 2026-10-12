import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveAiCredentials } from './user-ai.ts';

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

test('app wellness credentials preserve optional workspace routing to Anthropic', async () => {
  for (const workspaceId of [undefined, 'wrkspc_test123']) {
    const resolved = await resolveAiCredentials({
      mode: 'app',
      app: resolveWellnessProvider({ WELLNESS_AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'server-key',
        ANTHROPIC_MODEL: 'claude-haiku-5-5', ANTHROPIC_WORKSPACE_ID: workspaceId && ` ${workspaceId} ` }),
      loadPersonal: async () => { throw new Error('Must not read personal keys'); },
    });
    assert.ok(resolved.ok);
    await requestWellnessGuidance(resolved.configuration, input, { fetchImpl: async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('anthropic-workspace-id'), workspaceId ?? null);
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Test response' }] }));
    } });
  }
  assert.equal(resolveWellnessProvider({ WELLNESS_AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'key',
    ANTHROPIC_MODEL: 'model', ANTHROPIC_WORKSPACE_ID: 'invalid\r\nheader' }).ok, false);
  assert.match(readFileSync(new URL('../wellness-chat/index.ts', import.meta.url), 'utf8'),
    /ANTHROPIC_WORKSPACE_ID: Deno.env.get\('ANTHROPIC_WORKSPACE_ID'\)/);
});

test('wellness provider selection is explicit and auto prefers Gemini', () => {
  const both = {
    GEMINI_API_KEY: 'gemini-key', GEMINI_MODEL: 'gemini-3.5-flash-lite',
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
    provider: 'gemini', apiKey: 'server-gemini-key', model: 'gemini-3.5-flash-lite',
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
  assert.equal(requestUrl, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
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
    provider: 'anthropic', apiKey: 'server-anthropic-key', model: 'claude-haiku-5-5',
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
  assert.equal(body.temperature, undefined);
  assert.equal(body.output_config.effort, 'low');
  assert.equal(body.max_tokens, 2048);
  assert.equal(body.messages[0].content, input.prompt);
});

test('Anthropic incomplete guidance is rejected', async () => {
  for (const stop_reason of ['max_tokens', 'refusal']) {
    await assert.rejects(requestWellnessGuidance({ provider: 'anthropic', apiKey: 'test-key', model: 'claude-haiku-5-5' }, input, {
      fetchImpl: async () => new Response(JSON.stringify({ stop_reason, content: [{ type: 'text', text: 'Partial reply' }] })),
    }), (cause: unknown) => cause instanceof WellnessProviderError && cause.code === 'AI_EMPTY_RESPONSE');
  }
});

test('wellness provider failures are bounded and safely classified', async () => {
  const configuration: WellnessProviderConfiguration = {
    provider: 'gemini', apiKey: 'secret', model: 'gemini-3.5-flash-lite',
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
  assert.match(source, /parseWellnessChatRequest/);
  assert.match(source, /CONTEXT_UNAVAILABLE/);
  assert.match(source, /IDEMPOTENCY_CONFLICT/);
  assert.doesNotMatch(source, /api\.anthropic\.com|generativelanguage\.googleapis\.com/);
  assert.match(source, /safeRequestId/);
  assert.match(source, /summarizeTrainingMuscleContext/);
  assert.match(source, /bodyPartWorkload/);
  assert.match(source, /summarizeLoggedNutrition/);
  assert.match(source, /nutrition_targets/);
  assert.ok(
    source.indexOf('if (existingReply)') < source.indexOf('requestWellnessGuidance(provider.configuration'),
    'a retry must return the reserved assistant row before making another provider call',
  );
});
