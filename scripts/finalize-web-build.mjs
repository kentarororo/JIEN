import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

function contentHashedName(prefix, source) {
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 32);
  return `${prefix}-${hash}.js`;
}

export async function finalizeWebBuild(projectRoot = process.cwd()) {
  const distRoot = path.resolve(projectRoot, 'dist');
  const bundleRoot = path.join(distRoot, '_expo', 'static', 'js', 'web');
  const bundles = readdirSync(bundleRoot)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(bundleRoot, name));
  const matches = bundles.flatMap((bundlePath) => {
    const source = readFileSync(bundlePath, 'utf8');
    const match = source.match(/["'](\/assets\/[^"']*wa-sqlite-async[^"']*\.wasm)["']/);
    return match ? [{ bundlePath, source, assetPath: match[1] }] : [];
  });

  if (matches.length !== 1) {
    throw new Error(`Expected one web SQLite WASM reference, found ${matches.length}.`);
  }
  const [{ bundlePath, source, assetPath }] = matches;
  const sourceWasm = path.resolve(distRoot, assetPath.slice(1));
  const relativeSource = path.relative(distRoot, sourceWasm);
  if (relativeSource.startsWith('..') || path.isAbsolute(relativeSource) || !existsSync(sourceWasm)) {
    throw new Error('Web SQLite WASM is outside or missing from the web artifact.');
  }

  const bytes = readFileSync(sourceWasm);
  await WebAssembly.compile(bytes);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  const publicDirectory = path.join(distRoot, 'assets', 'jien-sqlite');
  const publicPath = path.join(publicDirectory, `wa-sqlite-${hash}.wasm`);
  const publicUrl = `/assets/jien-sqlite/${path.basename(publicPath)}`;
  mkdirSync(publicDirectory, { recursive: true });
  writeFileSync(publicPath, bytes);

  const patchedEntry = source.replace(assetPath, publicUrl);
  if (patchedEntry === source || patchedEntry.includes(`"${assetPath}"`)) {
    throw new Error('Web SQLite bundle still references its hidden package-manager asset path.');
  }
  const originalEntryName = path.basename(bundlePath);
  if (!/^entry-.*\.js$/.test(originalEntryName)) {
    throw new Error('The web SQLite WASM reference is not in the Expo entry bundle.');
  }
  const publicEntryName = contentHashedName('entry', patchedEntry);
  const publicEntryPath = path.join(bundleRoot, publicEntryName);
  writeFileSync(bundlePath, patchedEntry);
  writeFileSync(publicEntryPath, patchedEntry);

  let htmlReferenceCount = 0;
  for (const htmlPath of listFiles(distRoot).filter((filePath) => filePath.endsWith('.html'))) {
    const html = readFileSync(htmlPath, 'utf8');
    const count = html.split(originalEntryName).length - 1;
    if (count === 0) continue;
    writeFileSync(htmlPath, html.replaceAll(originalEntryName, publicEntryName));
    htmlReferenceCount += count;
  }
  if (htmlReferenceCount === 0) throw new Error('No exported HTML referenced the Expo entry bundle.');

  if (statSync(publicPath).size !== bytes.length) throw new Error('Web SQLite WASM copy is incomplete.');
  await WebAssembly.compile(readFileSync(publicPath));
  return { entryPath: publicEntryPath, publicUrl };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await finalizeWebBuild();
  console.log(`Web entry bundle: ${path.relative(process.cwd(), result.entryPath)}`);
  console.log(`Web SQLite WASM: ${result.publicUrl}`);
}
