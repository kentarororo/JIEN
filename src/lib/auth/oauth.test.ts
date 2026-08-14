import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCleanWebAppUrl,
  buildWebOAuthRedirectUrl,
  isNativeOAuthCallbackPath,
  normalizeBasePath,
  parseWebOAuthCallbackUrl,
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
    { code: 'abc123', errorDescription: null },
  );
  assert.deepEqual(
    parseWebOAuthCallbackUrl(
      'https://kentarororo.github.io/JIEN/?auth_callback=1&error_description=Access%20denied',
    ),
    { code: null, errorDescription: 'Access denied' },
  );
  assert.equal(parseWebOAuthCallbackUrl('https://kentarororo.github.io/JIEN/'), null);
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
