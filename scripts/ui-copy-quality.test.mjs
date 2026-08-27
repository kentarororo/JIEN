import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(projectRoot, 'src');

const bannedPatterns = [
  {
    label: 'personified product promise',
    pattern: /\bJIEN (?:will|can|may|needs?|keeps?|kept|carries|builds?|creates?|waits?|reports?|recommends?|retained|verifies?|checks?|understands?)\b/i,
  },
  {
    label: 'generic assistant phrasing',
    pattern: /\b(?:next small win|next step prepared|when you (?:are|'re|’re) ready|ready when you are|ready for the next session|starts here|at a glance|your own (?:exercise|food|workout)|one tap away)\b/i,
  },
  {
    label: 'vague safety reassurance',
    pattern: /\b(?:your (?:local )?data is safe|(?:data|records|changes|photos?) remain(?:s|ed)? safe|safely queued)\b/i,
  },
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name) || /\.test\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [absolute];
  });
}

test('product copy avoids personified and generic assistant language', () => {
  const failures = [];
  for (const file of sourceFiles(sourceRoot)) {
    const relative = path.relative(projectRoot, file).replaceAll('\\', '/');
    for (const [index, line] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
      for (const rule of bannedPatterns) {
        if (rule.pattern.test(line)) failures.push(`${relative}:${index + 1} ${rule.label}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('the design system requires the product voice standard', () => {
  const designSystem = readFileSync(path.join(projectRoot, '.codex/skills/design-system/SKILL.md'), 'utf8');
  const voice = readFileSync(path.join(projectRoot, 'docs/product-voice.md'), 'utf8');
  assert.match(designSystem, /state → consequence → action/);
  assert.match(designSystem, /Run the copy-quality harness/);
  assert.match(voice, /scripts\/ui-copy-quality\.test\.mjs/);
});
