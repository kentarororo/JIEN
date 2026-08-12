import assert from 'node:assert/strict';
import test from 'node:test';

import {
  absolutizeSQLiteWasmUrls,
  createHashedBundleName,
  normalizeBasePath,
  normalizeSiteOrigin,
  validatePublicWasmUrl,
} from './finalize-pages-build.mjs';

test('absolutizes the Expo SQLite WASM URL for a GitHub Pages worker', () => {
  const source =
    '__d(function(e,s,a,b,o){o.exports="/JIEN/assets/expo-sqlite/web/wa-sqlite.abc123.wasm"},1,[]);';
  const result = absolutizeSQLiteWasmUrls(source, {
    basePath: '/JIEN/',
    siteOrigin: 'https://kentarororo.github.io',
  });

  assert.equal(result.replacementCount, 1);
  assert.deepEqual(result.assetPaths, [
    '/JIEN/assets/expo-sqlite/web/wa-sqlite.abc123.wasm',
  ]);
  assert.match(
    result.patchedSource,
    /"https:\/\/kentarororo\.github\.io\/JIEN\/assets\/expo-sqlite\/web\/wa-sqlite\.abc123\.wasm"/,
  );
});

test('does not rewrite unrelated WASM assets or an already absolute URL', () => {
  const source = [
    '"/JIEN/assets/another-module.wasm"',
    '"https://kentarororo.github.io/JIEN/assets/wa-sqlite.already-fixed.wasm"',
  ].join(';');
  const result = absolutizeSQLiteWasmUrls(source, {
    basePath: '/JIEN',
    siteOrigin: 'https://kentarororo.github.io',
  });

  assert.equal(result.replacementCount, 0);
  assert.equal(result.patchedSource, source);
});

test('gives post-processed bundles deterministic cache-busting names', () => {
  const patchedWorker = 'o.exports="https://kentarororo.github.io/JIEN/assets/wa-sqlite.wasm"';
  const firstName = createHashedBundleName('worker', patchedWorker);

  assert.match(firstName, /^worker-[0-9a-f]{32}\.js$/);
  assert.equal(createHashedBundleName('worker', patchedWorker), firstName);
  assert.notEqual(createHashedBundleName('worker', `${patchedWorker};`), firstName);
});

test('rejects hidden package-manager directories in the public WASM URL', () => {
  assert.throws(
    () =>
      validatePublicWasmUrl(
        'https://kentarororo.github.io/JIEN/assets/node_modules/.pnpm/expo-sqlite/wa-sqlite.wasm',
      ),
    /cannot contain hidden directories/,
  );
  assert.equal(
    validatePublicWasmUrl(
      'https://kentarororo.github.io/JIEN/assets/jien-sqlite/wa-sqlite-abc123.wasm',
    ),
    'https://kentarororo.github.io/JIEN/assets/jien-sqlite/wa-sqlite-abc123.wasm',
  );
});

test('normalizes the Pages path and rejects an origin with a path', () => {
  assert.equal(normalizeBasePath('JIEN/'), '/JIEN');
  assert.equal(normalizeBasePath('/'), '');
  assert.equal(normalizeSiteOrigin('https://kentarororo.github.io/'), 'https://kentarororo.github.io');
  assert.throws(
    () => normalizeSiteOrigin('https://kentarororo.github.io/JIEN'),
    /cannot include a path/,
  );
});
