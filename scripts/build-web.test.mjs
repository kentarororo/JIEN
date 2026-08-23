import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePublicSupabaseEnvironment } from './build-web.mjs';

test('prefers explicit Expo public Supabase variables', () => {
  const result = resolvePublicSupabaseEnvironment({
    EXPO_PUBLIC_SUPABASE_URL: 'https://expo.supabase.co/',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'expo-key',
    SUPABASE_URL: 'https://integration.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'integration-key',
  });
  assert.equal(result.EXPO_PUBLIC_SUPABASE_URL, 'https://expo.supabase.co');
  assert.equal(result.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'expo-key');
  assert.deepEqual(result.sources, {
    key: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    url: 'EXPO_PUBLIC_SUPABASE_URL',
  });
});

test('maps the connected Vercel Supabase variables into Expo', () => {
  const result = resolvePublicSupabaseEnvironment({
    SUPABASE_URL: 'https://connected.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'connected-key',
  });
  assert.equal(result.EXPO_PUBLIC_SUPABASE_URL, 'https://connected.supabase.co');
  assert.equal(result.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'connected-key');
  assert.deepEqual(result.sources, {
    key: 'SUPABASE_PUBLISHABLE_KEY',
    url: 'SUPABASE_URL',
  });
});

test('ignores unexpanded Vercel aliases and uses connected values', () => {
  const result = resolvePublicSupabaseEnvironment({
    EXPO_PUBLIC_SUPABASE_URL: '$SUPABASE_URL',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '$SUPABASE_PUBLISHABLE_KEY',
    SUPABASE_URL: 'https://connected.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'connected-key',
  });
  assert.equal(result.EXPO_PUBLIC_SUPABASE_URL, 'https://connected.supabase.co');
  assert.equal(result.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'connected-key');
});

test('accepts the Next.js aliases installed by the Vercel integration', () => {
  const result = resolvePublicSupabaseEnvironment({
    NEXT_PUBLIC_SUPABASE_URL: 'https://next.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'next-key',
  });
  assert.equal(result.EXPO_PUBLIC_SUPABASE_URL, 'https://next.supabase.co');
  assert.equal(result.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'next-key');
});

test('fails the deployment instead of exporting a disconnected app', () => {
  assert.throws(
    () => resolvePublicSupabaseEnvironment({ SUPABASE_SECRET_KEY: 'never-use-this' }),
    /Supabase web configuration is missing/,
  );
});
