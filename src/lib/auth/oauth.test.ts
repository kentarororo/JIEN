import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWebOAuthRedirectUrl, normalizeBasePath } from './oauth.ts';

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
