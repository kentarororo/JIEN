import assert from 'node:assert/strict';
import test from 'node:test';

import { parseProviderPhotoItems } from './photo-contract.ts';
import {
  PhotoProviderError,
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
  assert.equal(body.generationConfig.responseFormat.text.mimeType, 'application/json');
  assert.equal(body.generationConfig.responseFormat.text.schema.properties.items.maxItems, 12);
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'low');
  assert.equal(Object.hasOwn(body.generationConfig, 'temperature'), false, 'Gemini 3.5 avoids unnecessary sampling parameters');
  assert.equal(parseProviderPhotoItems(text)[0]?.name, 'Chicken rice');
});

test('Anthropic remains available behind the same normalized adapter contract', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const text = await requestPhotoEstimate({
    provider: 'anthropic', apiKey: 'server-anthropic-key', model: 'claude-vision',
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
  assert.equal(parseProviderPhotoItems(text).length, 1);
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
      assert.equal(cause.code, 'PROVIDER_CONFIGURATION_INVALID');
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
      fetchImpl: async () => new Response('{"candidates":[]}', { status: 200 }),
    }),
    (cause: unknown) => cause instanceof PhotoProviderError && cause.code === 'PROVIDER_OUTPUT_INVALID',
  );
});
