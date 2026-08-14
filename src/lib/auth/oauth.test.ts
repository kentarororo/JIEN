import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCleanWebAppUrl,
  buildWebOAuthRedirectUrl,
  isGoogleExternalAuthorizationCode,
  isNativeOAuthCallbackPath,
  normalizeBasePath,
  parseWebOAuthCallbackUrl,
  planOAuthCallback,
} from './oauth.ts';

test('normalizes Expo Router base paths', () => {
  assert.equal(normalizeBasePath(undefined), '');
  assert.equal(normalizeBasePath('/'), '');
  assert.equal(normalizeBasePath('JIEN/'), '/JIEN');
});

test('builds a GitHub Pages-safe OAuth callback at the exported root', () => {
  assert.equal(
    buildWebOAuthRedirectUrl('https://kentarororo.github.io/', '/JIEN'),
    'https://kentarororo.github.io/JIEN/?auth_callback=1',
  );
});

test('detects and parses the root-query OAuth callback', () => {
  assert.deepEqual(
    parseWebOAuthCallbackUrl(
      'https://kentarororo.github.io/JIEN/?auth_callback=1&code=abc123',
    ),
    { code: 'abc123', errorCode: null, errorDescription: null },
  );
  assert.deepEqual(
    parseWebOAuthCallbackUrl(
      'https://kentarororo.github.io/JIEN/?auth_callback=1&error_description=Access%20denied',
    ),
    { code: null, errorCode: null, errorDescription: 'Access denied' },
  );
  assert.equal(parseWebOAuthCallbackUrl('https://kentarororo.github.io/JIEN/'), null);
});

test('redacts a provider exchange failure instead of exposing the Google code', () => {
  const externalCode = '4/0AbCdEf_sensitive-one-time-code';
  const plan = planOAuthCallback({
    code: null,
    errorCode: 'server_error',
    errorDescription: `Unable to exchange external code: ${externalCode}`,
  });

  assert.equal(plan.kind, 'error');
  if (plan.kind === 'error') {
    assert.match(plan.message, /Google sign-in reached Supabase/);
    assert.doesNotMatch(plan.message, /4\/0AbCdEf/);
  }
});

test('never sends a direct Google provider code to the Supabase PKCE exchange', () => {
  const externalCode = '4/0AbCdEf_sensitive-one-time-code';
  assert.equal(isGoogleExternalAuthorizationCode(externalCode), true);
  assert.deepEqual(
    planOAuthCallback({ code: externalCode, errorCode: null, errorDescription: null }),
    {
      kind: 'error',
      message: 'Google returned to JIEN directly instead of through Supabase. No code was exchanged. The Google OAuth redirect URI must use this Supabase project\'s /auth/v1/callback URL.',
    },
  );
});

test('allows only a successful Supabase callback to reach PKCE exchange', () => {
  assert.deepEqual(
    planOAuthCallback({
      code: '34e770dd-9ff9-416c-87fa-43b31d7ef225',
      errorCode: null,
      errorDescription: null,
    }),
    { kind: 'exchange', code: '34e770dd-9ff9-416c-87fa-43b31d7ef225' },
  );
});

test('recognizes the native callback route and rejects ordinary app routes', () => {
  assert.equal(isNativeOAuthCallbackPath('/auth/callback'), true);
  assert.equal(isNativeOAuthCallbackPath('/auth/callback/'), true);
  assert.equal(isNativeOAuthCallbackPath('/settings/account'), false);
});

test('builds the clean Pages URL used after the session is persisted', () => {
  assert.equal(
    buildCleanWebAppUrl('https://kentarororo.github.io/', '/JIEN/'),
    'https://kentarororo.github.io/JIEN/',
  );
});
