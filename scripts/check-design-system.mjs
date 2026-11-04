import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const roots = ['src/app', 'src/components'];
const ignored = new Set(['src/app/+html.tsx']);
const rules = [
  { name: 'raw colour', pattern: /#[0-9a-f]{3,8}\b|rgba?\s*\(/i },
  { name: 'raw font size', pattern: /\bfontSize\s*:\s*\d/ },
  { name: 'unsupported font weight', pattern: /\bfontWeight\s*:\s*['"](?:[89]00)['"]/ },
  { name: 'raw spacing or radius', pattern: /\b(?:padding(?:Horizontal|Vertical|Top|Right|Bottom|Left)?|margin(?:Horizontal|Vertical|Top|Right|Bottom|Left)?|gap|borderRadius)\s*:\s*[1-9]\d*(?:\.\d+)?/ },
  { name: 'raw shadow', pattern: /\b(?:shadowColor|shadowOpacity|shadowRadius|shadowOffset|elevation)\s*:/ },
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  }));
  return nested.flat();
}

const failures = [];
for (const root of roots) {
  for (const path of await sourceFiles(root)) {
    if (!['.ts', '.tsx'].includes(extname(path))) continue;
    const displayPath = relative('.', path).replaceAll('\\', '/');
    if (ignored.has(displayPath)) continue;
    const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const rule of rules) {
        if (rule.pattern.test(line)) failures.push(`${displayPath}:${index + 1} ${rule.name}`);
      }
    }
  }
}

if (failures.length) {
  console.error(`Design token check failed:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Design token check passed.');
}
