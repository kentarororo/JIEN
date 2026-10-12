import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AI_USAGE_POLICY,
  LEGACY_UNCAPPED_DAILY_LIMIT,
  loadPersonalAiConfiguration,
  resolveAiCredentials,
  PERSONAL_GEMINI_MODEL,
  resolveSupabaseServerKey,
  verifyGeminiApiKey,
} from './user-ai.ts';

test('shared Anthropic bypasses personal credentials for both accounts and fails closed', async () => {
  const configuration = { provider: 'anthropic' as const, apiKey: 'server-only-test-key', model: 'claude-haiku-4-5' };
  let personalReads = 0;
  const loadPersonal = async () => { personalReads += 1; return { provider: 'gemini' as const, apiKey: 'old-key', model: PERSONAL_GEMINI_MODEL }; };
  for (const _user of ['owner', 'wife']) {
    assert.deepEqual(await resolveAiCredentials({ mode: 'app', app: { ok: true, configuration }, loadPersonal }),
      { ok: true, configuration, credentialSource: 'app' });
  }
  assert.deepEqual(await resolveAiCredentials({ mode: 'app', app: { ok: false }, loadPersonal }), { ok: false });
  assert.deepEqual(await resolveAiCredentials({ mode: 'typo', app: { ok: true, configuration }, loadPersonal }), { ok: false });
  assert.equal(personalReads, 0);
  const legacy = await resolveAiCredentials({ app: { ok: true, configuration }, loadPersonal });
  assert.equal(legacy.ok && legacy.credentialSource, 'personal');
  const fallback = await resolveAiCredentials({ app: { ok: true, configuration }, loadPersonal: async () => { throw new Error('Vault unavailable'); } });
  assert.equal(fallback.ok && fallback.credentialSource, 'app');
  await assert.rejects(resolveAiCredentials({ requirePersonalLookup: true, app: { ok: false },
    loadPersonal: async () => { throw new Error('Vault unavailable'); } }), /AI_CREDENTIAL_LOOKUP_FAILED/);
  assert.equal((await resolveAiCredentials({ mode: 'app', requirePersonalLookup: true, app: { ok: true, configuration },
    loadPersonal: async () => { throw new Error('Must not read Vault'); } })).ok, true);
});

test('all AI entry points share credential routing; cached clients cannot save a personal key in app mode', () => {
  for (const name of ['ai-settings', 'analyze-food-photo', 'wellness-chat']) {
    const source = readFileSync(new URL(`../${name}/index.ts`, import.meta.url), 'utf8');
    assert.match(source, /await resolveAiCredentials\(/);
    assert.match(source, /AI_CREDENTIAL_MODE/);
    assert.match(source, /KEN_ANTHROPIC_API_KEY/);
  }
  const settings = readFileSync(new URL('../ai-settings/index.ts', import.meta.url), 'utf8');
  assert.ok(settings.indexOf("'AI_MANAGED_BY_APP'") < settings.indexOf('await verifyGeminiApiKey'));
});

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
  assert.equal(AI_USAGE_POLICY, 'provider_managed');
  assert.equal(LEGACY_UNCAPPED_DAILY_LIMIT, 1000);
});

test('Gemini keys are verified with a minimal real generateContent request', async () => {
  let seenUrl = '';
  let seenHeaders: HeadersInit | undefined;
  let seenBody = '';
  await verifyGeminiApiKey('user-gemini-key-value-123456', {
    fetchImpl: async (input, init) => {
      seenUrl = String(input);
      seenHeaders = init?.headers;
      seenBody = String(init?.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }), { status: 200 });
    },
  });
  assert.equal(seenUrl, `https://generativelanguage.googleapis.com/v1beta/models/${PERSONAL_GEMINI_MODEL}:generateContent`);
  assert.equal((seenHeaders as Record<string, string>)['x-goog-api-key'], 'user-gemini-key-value-123456');
  assert.equal(JSON.parse(seenBody).generationConfig.thinkingConfig.thinkingLevel, 'minimal');
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

test('both AI runtimes resolve personal Vault credentials without a JIEN request cap', () => {
  const photo = readFileSync(new URL('../analyze-food-photo/index.ts', import.meta.url), 'utf8');
  const wellness = readFileSync(new URL('../wellness-chat/index.ts', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../ai-settings/index.ts', import.meta.url), 'utf8');
  const settingsScreen = readFileSync(new URL('../../../src/app/settings/ai.tsx', import.meta.url), 'utf8');
  assert.match(photo, /loadPersonalAiConfiguration\(admin, userData\.user\.id\)/);
  assert.match(photo, /usagePolicy: AI_USAGE_POLICY/);
  assert.doesNotMatch(photo, /claimAiUsage|AI_DAILY_LIMIT_REACHED|AI_USAGE_UNAVAILABLE/);
  assert.match(wellness, /loadPersonalAiConfiguration\(admin, userId\)/);
  assert.doesNotMatch(wellness, /claimAiUsage|AI_DAILY_LIMIT_REACHED|AI_USAGE_UNAVAILABLE/);
  assert.match(settings, /usagePolicy: AI_USAGE_POLICY/);
  assert.match(settings, /verifyGeminiApiKey\(apiKey\)/);
  assert.match(settings, /admin\.rpc\('set_user_ai_credential'/);
  assert.doesNotMatch(settings, /console\.(log|info|debug)\(/, 'key-bearing requests must never be logged');
  assert.match(settingsScreen, /No JIEN daily cap/);
  assert.match(settingsScreen, /set it to \$0 or the lowest value Google accepts/);
  assert.doesNotMatch(settingsScreen, /JIEN stops at/);
});
