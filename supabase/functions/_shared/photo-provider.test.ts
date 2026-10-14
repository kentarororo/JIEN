import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveAiCredentials } from './user-ai.ts';

import { parseProviderPhotoItems } from './photo-contract.ts';
import {
  PhotoProviderError,
  buildPhotoEstimatePrompt,
  requestPhotoEstimate,
  resolvePhotoProvider,
  type PhotoProviderConfiguration,
} from './photo-provider.ts';

const input = {
  imageBase64: 'a'.repeat(120),
  mediaType: 'image/jpeg',
  description: 'chicken rice with sauce',
};
const providerJson = JSON.stringify({ items: [{
  name: 'Chicken rice', quantity: 1, unit: 'plate', caloriesKcal: 610,
  proteinG: 38, carbohydrateG: 74, fatG: 18, fibreG: 4, confidence: 0.78,
}] });

test('app photo credentials preserve workspace routing from environment to Anthropic headers', async () => {
  for (const workspaceId of [undefined, 'wrkspc_test123']) {
    const resolved = await resolveAiCredentials({
      mode: 'app',
      app: resolvePhotoProvider({ PHOTO_AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'server-key',
        ANTHROPIC_MODEL: 'claude-haiku-5-5', ANTHROPIC_WORKSPACE_ID: workspaceId && ` ${workspaceId} ` }),
      loadPersonal: async () => { throw new Error('Must not read personal keys'); },
    });
    assert.ok(resolved.ok);
    await requestPhotoEstimate(resolved.configuration, input, { fetchImpl: async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('anthropic-workspace-id'), workspaceId ?? null);
      assert.equal(JSON.parse(String(init?.body)).workspaceId, undefined);
      return new Response(JSON.stringify({ content: [{ type: 'text', text: providerJson }] }));
    } });
  }
  assert.equal(resolvePhotoProvider({ PHOTO_AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'key',
    ANTHROPIC_MODEL: 'model', ANTHROPIC_WORKSPACE_ID: 'invalid\r\nheader' }).ok, false);
  for (const path of ['../analyze-food-photo/index.ts', '../ai-settings/index.ts']) {
    assert.match(readFileSync(new URL(path, import.meta.url), 'utf8'), /ANTHROPIC_WORKSPACE_ID: Deno.env.get\('ANTHROPIC_WORKSPACE_ID'\)/);
  }
});

test('photo guidance treats a nutrition label as transcription, not a meal estimate', () => {
  const prompt = buildPhotoEstimatePrompt('Protein cereal');
  assert.match(prompt, /nutrition label/i);
  assert.match(prompt, /exactly the label serving/i);
  assert.match(prompt, /instead of estimating/i);
  assert.match(prompt, /Protein cereal/);
  for (const rule of [/TOTALS FOR THE RETURNED quantity/, /Never return both a whole-dish total/, /raw\/dry rice/,
    /Hainanese chicken rice/, /plausible cooking fat/, /uncalibrated model score/, /untrusted data/,
    /visible half, not a reconstructed whole sandwich/, /do not halve it again/]) {
    assert.match(prompt, rule);
  }
});

test('provider selection is explicit and auto mode deterministically prefers Gemini', () => {
  const both = {
    GEMINI_API_KEY: 'gemini-key', GEMINI_MODEL: 'gemini-3.5-flash-lite',
    ANTHROPIC_API_KEY: 'anthropic-key', ANTHROPIC_MODEL: 'claude-vision',
  };
  const automatic = resolvePhotoProvider(both);
  assert.equal(automatic.ok && automatic.configuration.provider, 'gemini');

  const explicitAnthropic = resolvePhotoProvider({ ...both, PHOTO_AI_PROVIDER: 'anthropic' });
  assert.equal(explicitAnthropic.ok && explicitAnthropic.configuration.provider, 'anthropic');

  assert.deepEqual(
    resolvePhotoProvider({ ...both, PHOTO_AI_PROVIDER: 'gemini', GEMINI_MODEL: '' }),
    { ok: false, code: 'PHOTO_AI_NOT_CONFIGURED' },
    'explicit provider selection must not silently fall through',
  );
  assert.equal(
    resolvePhotoProvider({ ANTHROPIC_API_KEY: 'key', ANTHROPIC_MODEL: 'model' }).ok,
    true,
    'auto mode retains the existing Anthropic deployment path',
  );
});

test('Gemini generateContent sends inline image data and a structured JSON schema with only the JIEN key', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const configuration: PhotoProviderConfiguration = {
    provider: 'gemini', apiKey: 'server-gemini-key', model: 'gemini-3.5-flash-lite',
  };
  const text = await requestPhotoEstimate(configuration, input, {
    fetchImpl: async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: providerJson }] } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  assert.equal(text, providerJson);
  assert.equal(requestUrl, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
  const headers = requestInit?.headers as Record<string, string>;
  assert.equal(headers['x-goog-api-key'], 'server-gemini-key');
  assert.equal(Object.hasOwn(headers, 'Authorization'), false, 'a Google OAuth access token must never be passed');
  const body = JSON.parse(String(requestInit?.body));
  assert.deepEqual(body.contents[0].parts[0].inline_data, {
    mime_type: 'image/jpeg', data: input.imageBase64,
  });
  assert.match(body.contents[0].parts[1].text, /chicken rice with sauce/);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.responseJsonSchema.properties.items.maxItems, 12);
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(body.generationConfig.maxOutputTokens, 4096);
  assert.equal(Object.hasOwn(body.generationConfig, 'temperature'), false, 'Gemini 3.5 avoids unnecessary sampling parameters');
  assert.equal(parseProviderPhotoItems(text)[0]?.name, 'Chicken rice');
});

test('photo responses reject truncated JSON and exclude thought parts', async () => {
  const configuration: PhotoProviderConfiguration = { provider: 'gemini', apiKey: 'secret', model: 'gemini-3.5-flash-lite' };
  for (const finishReason of ['MAX_TOKENS', 'SAFETY', 'RECITATION']) {
    await assert.rejects(requestPhotoEstimate(configuration, input, {
      fetchImpl: async () => new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text: providerJson }] } }] })),
    }), (error: unknown) => error instanceof PhotoProviderError && error.code === 'PROVIDER_OUTPUT_INVALID');
  }
  assert.equal(await requestPhotoEstimate(configuration, input, {
    fetchImpl: async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [
      { thought: true, text: 'Private intermediate reasoning' }, { text: providerJson },
    ] } }] })),
  }), providerJson);
});

test('unexpected provider rejection retains only its HTTP status for diagnosis and is not retried', async () => {
  await assert.rejects(requestPhotoEstimate({ provider: 'gemini', apiKey: 'secret', model: 'gemini-3.5-flash-lite' }, input, {
    fetchImpl: async () => new Response(JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: 'sensitive provider response' } }), { status: 413 }),
  }), (error: unknown) => {
    assert.ok(error instanceof PhotoProviderError);
    assert.equal(error.upstreamStatus, 413);
    assert.equal(error.upstreamCode, 'FAILED_PRECONDITION');
    assert.equal(error.retryable, false);
    assert.match(error.message, /HTTP 413/);
    assert.doesNotMatch(error.message, /sensitive|secret/);
    return true;
  });
  await assert.rejects(requestPhotoEstimate({ provider: 'gemini', apiKey: 'secret', model: 'gemini-3.5-flash-lite' }, input, {
    fetchImpl: async () => new Response(JSON.stringify({ error: { status: 'secret provider detail' } }), { status: 413 }),
  }), (error: unknown) => error instanceof PhotoProviderError && error.upstreamCode === undefined);
});

test('Anthropic remains available behind the same normalized adapter contract', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const text = await requestPhotoEstimate({
    provider: 'anthropic', apiKey: 'server-anthropic-key', model: 'claude-haiku-5-5',
  }, input, {
    fetchImpl: async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return new Response(JSON.stringify({ content: [{ type: 'text', text: providerJson }] }), { status: 200 });
    },
  });
  assert.equal(requestUrl, 'https://api.anthropic.com/v1/messages');
  const body = JSON.parse(String(requestInit?.body));
  assert.equal(body.messages[0].content[0].source.data, input.imageBase64);
  assert.equal(body.temperature, undefined);
  assert.equal(body.output_config.effort, 'low');
  assert.equal(body.max_tokens, 4096);
  assert.match(body.messages[0].content[1].text, /caloriesKcal/);
  assert.match(body.messages[0].content[1].text, /carbohydrateG/);
  assert.match(body.messages[0].content[1].text, /JSON Schema/);
  assert.match(body.messages[0].content[1].text, /nutritionBasis/);
  assert.match(body.messages[0].content[1].text, /databaseQuery/);
  assert.equal(parseProviderPhotoItems(text).length, 1);
});

test('Anthropic rejection diagnostics use fixed categories and never retain provider messages', async () => {
  for (const [message, reason] of [
    ['Your credit balance is too low: private-detail', 'billing'],
    ['model: unavailable private-detail', 'model'],
    ['output_config.effort unsupported private-detail', 'output_config'],
    ['Invalid image private-detail', 'image'],
    ['unrecognized private-detail', 'unknown'],
  ]) {
    await assert.rejects(requestPhotoEstimate({ provider: 'anthropic', apiKey: 'secret', model: 'claude-haiku-5-5' }, input, {
      fetchImpl: async () => new Response(JSON.stringify({ error: { type: 'invalid_request_error', message } }), { status: 400 }),
    }), (error: unknown) => {
      assert.ok(error instanceof PhotoProviderError);
      assert.equal(error.upstreamCode, 'invalid_request_error');
      assert.equal(error.upstreamReason, reason);
      assert.doesNotMatch(JSON.stringify(error), /private-detail|secret/);
      assert.doesNotMatch(error.message, /private-detail|secret/);
      return true;
    });
  }
});

test('Anthropic truncation and refusals cannot become complete nutrition estimates', async () => {
  for (const stop_reason of ['max_tokens', 'refusal', 'tool_use']) {
    await assert.rejects(requestPhotoEstimate({ provider: 'anthropic', apiKey: 'test-key', model: 'claude-haiku-4-5' }, input, {
      fetchImpl: async () => new Response(JSON.stringify({ stop_reason, content: [{ type: 'text', text: providerJson }] })),
    }), (cause: unknown) => cause instanceof PhotoProviderError && cause.code === 'PROVIDER_OUTPUT_INVALID');
  }
});

test('provider failures are finite, safely classified, and never expose raw output', async () => {
  const configuration: PhotoProviderConfiguration = {
    provider: 'gemini', apiKey: 'secret', model: 'gemini-3.5-flash-lite',
  };
  await assert.rejects(
    requestPhotoEstimate(configuration, input, {
      fetchImpl: async () => new Response('raw invalid-key details', { status: 401 }),
    }),
    (cause: unknown) => {
      assert.ok(cause instanceof PhotoProviderError);
      assert.equal(cause.code, 'PROVIDER_AUTH_INVALID');
      assert.equal(cause.retryable, false);
      assert.doesNotMatch(cause.message, /invalid-key|secret/i);
      return true;
    },
  );
  await assert.rejects(
    requestPhotoEstimate(configuration, input, {
      fetchImpl: async () => { throw Object.assign(new Error('provider internals'), { name: 'AbortError' }); },
    }),
    (cause: unknown) => {
      assert.ok(cause instanceof PhotoProviderError);
      assert.equal(cause.code, 'PROVIDER_TIMEOUT');
      assert.equal(cause.retryable, true);
      return true;
    },
  );
  await assert.rejects(
    requestPhotoEstimate(configuration, input, {
      fetchImpl: async () => new Response('{"error":{"status":"INVALID_ARGUMENT"}}', { status: 400 }),
    }),
    (cause: unknown) => cause instanceof PhotoProviderError && cause.code === 'PROVIDER_REQUEST_INVALID',
  );
  await assert.rejects(
    requestPhotoEstimate(configuration, input, {
      fetchImpl: async () => new Response('{"candidates":[]}', { status: 200 }),
    }),
    (cause: unknown) => cause instanceof PhotoProviderError && cause.code === 'PROVIDER_OUTPUT_INVALID',
  );
});
