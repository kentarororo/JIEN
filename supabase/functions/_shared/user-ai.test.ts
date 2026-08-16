import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AI_DAILY_LIMITS,
  loadPersonalAiConfiguration,
  PERSONAL_GEMINI_MODEL,
  resolveSupabaseServerKey,
  verifyGeminiApiKey,
} from './user-ai.ts';

test('server key resolution never depends on a browser-visible key', () => {
  assert.equal(resolveSupabaseServerKey({ SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role-key-value' }), 'legacy-service-role-key-value');
  assert.equal(resolveSupabaseServerKey({ SUPABASE_SECRET_KEYS: JSON.stringify({ primary: 'sb_secret_server_value_123456' }) }), 'sb_secret_server_value_123456');
  assert.equal(resolveSupabaseServerKey({ SUPABASE_SECRET_KEYS: 'not-json' }), null);
});

test('personal credential parsing accepts only a complete Gemini configuration', async () => {
  const configuration = await loadPersonalAiConfiguration({
    rpc: async () => ({ data: [{ provider: 'gemini', model: PERSONAL_GEMINI_MODEL, api_key: 'secret-user-key' }], error: null }),
  }, 'user-1');
  assert.deepEqual(configuration, {
    provider: 'gemini', model: PERSONAL_GEMINI_MODEL, apiKey: 'secret-user-key',
  });
  assert.equal(AI_DAILY_LIMITS.photo, 5);
  assert.equal(AI_DAILY_LIMITS.context, 10);
});

test('Gemini keys are verified against the low-cost multimodal model without sending content', async () => {
  let seenUrl = '';
  let seenHeaders: HeadersInit | undefined;
  await verifyGeminiApiKey('user-gemini-key-value-123456', {
    fetchImpl: async (input, init) => {
      seenUrl = String(input);
      seenHeaders = init?.headers;
      return new Response(JSON.stringify({ name: `models/${PERSONAL_GEMINI_MODEL}` }), { status: 200 });
    },
  });
  assert.equal(seenUrl, `https://generativelanguage.googleapis.com/v1beta/models/${PERSONAL_GEMINI_MODEL}`);
  assert.equal((seenHeaders as Record<string, string>)['x-goog-api-key'], 'user-gemini-key-value-123456');
});

test('invalid Gemini credentials return only a stable safe code', async () => {
  await assert.rejects(
    verifyGeminiApiKey('user-gemini-key-value-123456', {
      fetchImpl: async () => new Response('provider secret detail', { status: 403 }),
    }),
    (cause: unknown) => cause instanceof Error && cause.message === 'AI_KEY_INVALID',
  );
});

test('credential migration keeps plaintext out of public tables and revokes every client role', () => {
  const migration = readFileSync(
    new URL('../../migrations/20260816000200_user_ai_credentials.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /create extension if not exists supabase_vault with schema vault/i);
  assert.match(migration, /create table private\.user_ai_credentials/i);
  assert.match(migration, /vault_secret_id uuid not null unique references vault\.secrets/i);
  assert.doesNotMatch(migration, /create table public\.user_ai_credentials/i);
  assert.match(migration, /revoke all on function public\.get_user_ai_configuration\(uuid\)[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.get_user_ai_configuration\(uuid\)[\s\S]*to service_role/i);
  assert.match(migration, /for update;/i, 'daily allowance claims and key rotation must be serialized');
});

test('both AI runtimes resolve personal Vault credentials and claim bounded usage', () => {
  const photo = readFileSync(new URL('../analyze-food-photo/index.ts', import.meta.url), 'utf8');
  const wellness = readFileSync(new URL('../wellness-chat/index.ts', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../ai-settings/index.ts', import.meta.url), 'utf8');
  assert.match(photo, /loadPersonalAiConfiguration\(admin, userData\.user\.id\)/);
  assert.match(photo, /claimAiUsage\(admin, userData\.user\.id, 'photo'\)/);
  assert.match(wellness, /loadPersonalAiConfiguration\(admin, userId\)/);
  assert.match(wellness, /claimAiUsage\(admin, userId, 'context'\)/);
  assert.ok(
    wellness.indexOf('if (existingReply)') < wellness.indexOf("claimAiUsage(admin, userId, 'context')"),
    'an idempotent wellness retry must not consume another allowance',
  );
  assert.match(settings, /verifyGeminiApiKey\(apiKey\)/);
  assert.match(settings, /admin\.rpc\('set_user_ai_credential'/);
  assert.doesNotMatch(settings, /console\.(log|info|debug)\(/, 'key-bearing requests must never be logged');
});
