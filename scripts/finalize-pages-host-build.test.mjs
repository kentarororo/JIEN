import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { finalizePagesHostBuild } from './finalize-pages-host-build.mjs';

function createPagesArtifact(index) {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'jien-pages-host-'));
  const distRoot = path.join(projectRoot, 'dist');
  mkdirSync(path.join(distRoot, '_expo', 'static', 'js', 'web'), { recursive: true });
  mkdirSync(path.join(distRoot, 'meals'), { recursive: true });
  writeFileSync(path.join(distRoot, 'index.html'), index);
  writeFileSync(path.join(distRoot, 'meals', 'new.html'), '<html><script src="app.js"></script></html>');
  writeFileSync(path.join(distRoot, '_expo', 'static', 'js', 'web', 'entry.js'), 'application bundle');
  return { distRoot, projectRoot };
}

test('replaces every Pages HTML route with a static Vercel handoff', () => {
  const artifact = createPagesArtifact('<html><script src="/JIEN/_expo/static/js/web/entry.js"></script></html>');
  const result = finalizePagesHostBuild(artifact.projectRoot, { EXPO_PUBLIC_BASE_URL: '/JIEN' });

  assert.equal(result.gatedHtmlFiles.length, 2);
  for (const relativePath of ['index.html', path.join('meals', 'new.html')]) {
    const html = readFileSync(path.join(artifact.distRoot, relativePath), 'utf8');
    assert.match(html, /PAGES_HOST_UNSUPPORTED/);
    assert.match(html, /https:\/\/jien-coral\.vercel\.app\//);
    assert.doesNotMatch(html, /<script/i, 'a Pages deep link must not mount the JIEN application');
  }
  assert.equal(readFileSync(path.join(artifact.distRoot, '.nojekyll'), 'utf8'), '');
});

test('rejects an export that did not apply the configured Pages base path', () => {
  const artifact = createPagesArtifact('<html><script src="/_expo/static/js/web/entry.js"></script></html>');
  assert.throws(
    () => finalizePagesHostBuild(artifact.projectRoot, { EXPO_PUBLIC_BASE_URL: '/JIEN' }),
    /does not use its configured base path/,
  );
});
