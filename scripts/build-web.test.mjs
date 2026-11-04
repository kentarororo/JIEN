import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolvePublicSupabaseEnvironment } from './build-web.mjs';
import { finalizeWebBuild } from './finalize-web-build.mjs';

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

// #18: the production build writes a content-versioned service worker precache.
const EMPTY_WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const SW_TEMPLATE = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function fakeExport({ entryCode = 'console.log(1);', withServiceWorker = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'jien-pwa-'));
  const dist = path.join(root, 'dist');
  const write = (relative, contents) => {
    mkdirSync(path.dirname(path.join(dist, relative)), { recursive: true });
    writeFileSync(path.join(dist, relative), contents);
  };
  const hiddenWasm = '/assets/node_modules/wa-sqlite/dist/wa-sqlite-async.abc.wasm';
  write('_expo/static/js/web/entry-original.js', `${entryCode}const wasm = "${hiddenWasm}";`);
  write(hiddenWasm.slice(1), EMPTY_WASM);
  write('index.html', '<script src="/_expo/static/js/web/entry-original.js"></script>');
  write('foods.html', '<script src="/_expo/static/js/web/entry-original.js"></script>');
  write('manifest.webmanifest', '{"name":"JIEN"}');
  write('icons/icon-192.png', 'png');
  write('favicon.ico', 'ico');
  if (withServiceWorker) write('sw.js', SW_TEMPLATE);
  return { root, dist, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('#18 finalize writes the service worker precache: shell assets only, no placeholders', async () => {
  const build = fakeExport();
  try {
    const result = await finalizeWebBuild(build.root);
    const worker = readFileSync(path.join(build.dist, 'sw.js'), 'utf8');
    assert.doesNotMatch(worker, /__JIEN_(CACHE_NAME|PRECACHE)__/);
    assert.match(result.serviceWorker.cacheName, /^jien-shell-[0-9a-f]{16}$/);
    assert.ok(worker.includes(`'${result.serviceWorker.cacheName}'`));
    const urls = result.serviceWorker.precacheUrls;
    assert.ok(worker.includes(JSON.stringify(urls)));
    assert.ok(urls.includes('/index.html'));
    assert.ok(urls.includes('/manifest.webmanifest'));
    assert.ok(urls.includes('/icons/icon-192.png'));
    assert.ok(urls.includes(path.posix.join('/_expo/static/js/web', path.basename(result.entryPath))));
    assert.ok(urls.includes(result.publicUrl));
    // The pre-patch entry and the hidden package-manager WASM are not precached; nor is the worker itself.
    assert.ok(!urls.includes('/_expo/static/js/web/entry-original.js'));
    assert.ok(!urls.some((url) => url.includes('node_modules')));
    assert.ok(!urls.includes('/sw.js'));
    assert.deepEqual([...urls].sort(), urls);
  } finally {
    build.cleanup();
  }
});

test('#18 cache name changes when shell content changes and is stable when it does not', async () => {
  const builds = [fakeExport(), fakeExport(), fakeExport({ entryCode: 'console.log(2);' })];
  try {
    const [first, same, changed] = await Promise.all(builds.map((build) => finalizeWebBuild(build.root)));
    assert.equal(first.serviceWorker.cacheName, same.serviceWorker.cacheName);
    assert.notEqual(first.serviceWorker.cacheName, changed.serviceWorker.cacheName);
  } finally {
    for (const build of builds) build.cleanup();
  }
});

test('#18 finalize fails the build when the service worker template is missing', async () => {
  const build = fakeExport({ withServiceWorker: false });
  try {
    await assert.rejects(finalizeWebBuild(build.root), /service worker source is missing/);
  } finally {
    build.cleanup();
  }
});
