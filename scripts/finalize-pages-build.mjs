import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_PATH = '/JIEN';
const DEFAULT_SITE_ORIGIN = 'https://kentarororo.github.io';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeBasePath(value = DEFAULT_BASE_PATH) {
  const trimmed = value.trim();

  if (!trimmed || trimmed === '/') {
    return '';
  }

  if (trimmed.includes('://') || trimmed.includes('?') || trimmed.includes('#')) {
    throw new Error(`EXPO_PUBLIC_BASE_URL must be a pathname, received: ${value}`);
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}

export function normalizeSiteOrigin(value = DEFAULT_SITE_ORIGIN) {
  const url = new URL(value);

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`EXPO_PUBLIC_SITE_ORIGIN must be an HTTP(S) origin, received: ${value}`);
  }

  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`EXPO_PUBLIC_SITE_ORIGIN cannot include a path, query, or hash: ${value}`);
  }

  return url.origin;
}

export function absolutizeSQLiteWasmUrls(source, options = {}) {
  const basePath = normalizeBasePath(options.basePath);
  const siteOrigin = normalizeSiteOrigin(options.siteOrigin);
  const assetPrefix = `${basePath}/assets/`;
  const pattern = new RegExp(
    `(["'])(${escapeRegExp(assetPrefix)}[^"'\\s]*wa-sqlite[^"'\\s]*\\.wasm)\\1`,
    'g',
  );
  const assetPaths = [];

  const patchedSource = source.replace(pattern, (_match, quote, assetPath) => {
    assetPaths.push(assetPath);
    return `${quote}${siteOrigin}${assetPath}${quote}`;
  });

  return {
    assetPaths,
    patchedSource,
    replacementCount: assetPaths.length,
  };
}

export function createHashedBundleName(prefix, source) {
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 32);
  return `${prefix}-${hash}.js`;
}

export function validatePublicWasmUrl(value) {
  const url = new URL(value);
  const hasHiddenDirectory = url.pathname
    .split('/')
    .filter(Boolean)
    .some((segment) => segment.startsWith('.'));

  if (hasHiddenDirectory) {
    throw new Error(`The public SQLite WASM URL cannot contain hidden directories: ${value}`);
  }

  if (!url.pathname.endsWith('.wasm')) {
    throw new Error(`The public SQLite asset must use a .wasm URL: ${value}`);
  }

  return url.href;
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

function resolveDistAsset(distRoot, basePath, assetPath) {
  if (!assetPath.startsWith(`${basePath}/assets/`)) {
    throw new Error(`SQLite WASM URL is outside the configured Pages base path: ${assetPath}`);
  }

  const relativeAssetPath = assetPath.slice(basePath.length + 1);
  const resolvedPath = path.resolve(distRoot, relativeAssetPath);
  const relativeToDist = path.relative(distRoot, resolvedPath);

  if (relativeToDist.startsWith('..') || path.isAbsolute(relativeToDist)) {
    throw new Error(`SQLite WASM asset escaped the Pages artifact: ${assetPath}`);
  }

  return resolvedPath;
}

export async function finalizePagesBuild(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const distRoot = path.resolve(projectRoot, options.distDirectory ?? 'dist');
  const basePath = normalizeBasePath(options.basePath ?? process.env.EXPO_PUBLIC_BASE_URL);
  const siteOrigin = normalizeSiteOrigin(
    options.siteOrigin ?? process.env.EXPO_PUBLIC_SITE_ORIGIN,
  );
  const workerDirectory = path.join(distRoot, '_expo', 'static', 'js', 'web');

  if (!existsSync(workerDirectory)) {
    throw new Error(`Expo web worker directory was not exported: ${workerDirectory}`);
  }

  const workerPaths = readdirSync(workerDirectory)
    .filter((name) => /^worker-.*\.js$/.test(name))
    .map((name) => path.join(workerDirectory, name));

  if (workerPaths.length === 0) {
    throw new Error('Expo did not emit a SQLite web worker.');
  }

  const patches = workerPaths.map((workerPath) => {
    const source = readFileSync(workerPath, 'utf8');
    return {
      workerPath,
      ...absolutizeSQLiteWasmUrls(source, { basePath, siteOrigin }),
    };
  });
  const replacementCount = patches.reduce((total, patch) => total + patch.replacementCount, 0);

  if (replacementCount !== 1) {
    throw new Error(
      `Expected exactly one root-relative Expo SQLite WASM URL, found ${replacementCount}.`,
    );
  }

  const patchedWorker = patches.find((patch) => patch.replacementCount === 1);
  const assetPath = patchedWorker.assetPaths[0];
  const exportedWasmPath = resolveDistAsset(distRoot, basePath, assetPath);

  if (!existsSync(exportedWasmPath) || statSync(exportedWasmPath).size === 0) {
    throw new Error(`Expo SQLite WASM asset is missing or empty: ${exportedWasmPath}`);
  }

  const wasmBytes = readFileSync(exportedWasmPath);
  await WebAssembly.compile(wasmBytes);

  // Expo exports this asset below node_modules/.pnpm. GitHub Pages answers
  // requests containing that hidden directory with its HTML 404 document,
  // which WebAssembly then reports as an invalid magic word. Publish an exact
  // copy at a clean URL that Pages serves as a binary asset.
  const wasmHash = createHash('sha256').update(wasmBytes).digest('hex').slice(0, 32);
  const publicWasmName = `wa-sqlite-${wasmHash}.wasm`;
  const publicWasmDirectory = path.join(distRoot, 'assets', 'jien-sqlite');
  const publicWasmPath = path.join(publicWasmDirectory, publicWasmName);
  const publicWasmAssetPath = `${basePath}/assets/jien-sqlite/${publicWasmName}`;
  const absoluteAssetUrl = validatePublicWasmUrl(`${siteOrigin}${publicWasmAssetPath}`);
  mkdirSync(publicWasmDirectory, { recursive: true });
  writeFileSync(publicWasmPath, wasmBytes);

  const originalAbsoluteAssetUrl = `${siteOrigin}${assetPath}`;
  const deployableWorkerSource = patchedWorker.patchedSource.replace(
    originalAbsoluteAssetUrl,
    absoluteAssetUrl,
  );

  if (
    deployableWorkerSource === patchedWorker.patchedSource ||
    deployableWorkerSource.includes(originalAbsoluteAssetUrl)
  ) {
    throw new Error('Failed to redirect the Expo SQLite worker to its Pages-safe WASM asset.');
  }

  writeFileSync(patchedWorker.workerPath, deployableWorkerSource);

  // The worker filename was hashed before this post-export fix. Give both the
  // worker and its referring entry bundle new content-derived URLs so browsers
  // cannot reuse the broken Pages artifacts from an earlier deployment.
  const originalWorkerName = path.basename(patchedWorker.workerPath);
  const cacheBustedWorkerName = createHashedBundleName('worker', deployableWorkerSource);
  const cacheBustedWorkerPath = path.join(workerDirectory, cacheBustedWorkerName);
  writeFileSync(cacheBustedWorkerPath, deployableWorkerSource);

  const bundleReferencePatches = listFiles(distRoot)
    .filter((filePath) => filePath.endsWith('.js') && filePath !== patchedWorker.workerPath)
    .map((filePath) => {
      const source = readFileSync(filePath, 'utf8');
      return {
        filePath,
        source,
        replacementCount: source.split(originalWorkerName).length - 1,
      };
    })
    .filter((patch) => patch.replacementCount > 0);

  if (bundleReferencePatches.length !== 1) {
    throw new Error(
      `Expected one Expo entry bundle to reference ${originalWorkerName}, found ${bundleReferencePatches.length}.`,
    );
  }

  const entryPatch = bundleReferencePatches[0];
  const originalEntryName = path.basename(entryPatch.filePath);

  if (!/^entry-.*\.js$/.test(originalEntryName)) {
    throw new Error(`Unexpected SQLite worker importer: ${entryPatch.filePath}`);
  }

  const patchedEntrySource = entryPatch.source.replaceAll(
    originalWorkerName,
    cacheBustedWorkerName,
  );
  const cacheBustedEntryName = createHashedBundleName('entry', patchedEntrySource);
  const cacheBustedEntryPath = path.join(path.dirname(entryPatch.filePath), cacheBustedEntryName);
  writeFileSync(entryPatch.filePath, patchedEntrySource);
  writeFileSync(cacheBustedEntryPath, patchedEntrySource);

  let htmlReferenceCount = 0;
  for (const htmlPath of listFiles(distRoot).filter((filePath) => filePath.endsWith('.html'))) {
    const html = readFileSync(htmlPath, 'utf8');
    const replacementCount = html.split(originalEntryName).length - 1;
    if (replacementCount === 0) continue;
    writeFileSync(htmlPath, html.replaceAll(originalEntryName, cacheBustedEntryName));
    htmlReferenceCount += replacementCount;
  }

  if (htmlReferenceCount === 0) {
    throw new Error(`No exported HTML referenced the Expo entry bundle ${originalEntryName}.`);
  }

  if (statSync(publicWasmPath).size !== wasmBytes.length) {
    throw new Error('The Pages-safe SQLite WASM copy is incomplete.');
  }

  await WebAssembly.compile(readFileSync(publicWasmPath));

  const indexPath = path.join(distRoot, 'index.html');
  const serviceWorkerSrc = `${basePath}/coi-serviceworker.js`;

  if (!readFileSync(indexPath, 'utf8').includes(`src="${serviceWorkerSrc}"`)) {
    throw new Error(`The Pages HTML does not load ${serviceWorkerSrc}.`);
  }

  const require = createRequire(import.meta.url);
  const serviceWorkerSource = require.resolve('coi-serviceworker/coi-serviceworker.js');
  copyFileSync(serviceWorkerSource, path.join(distRoot, 'coi-serviceworker.js'));
  writeFileSync(path.join(distRoot, '.nojekyll'), '');

  return {
    absoluteAssetUrl,
    entryPath: cacheBustedEntryPath,
    wasmBytes: statSync(publicWasmPath).size,
    workerPath: cacheBustedWorkerPath,
  };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const result = await finalizePagesBuild();
  console.log(`Pages entry bundle: ${path.relative(process.cwd(), result.entryPath)}`);
  console.log(`Pages SQLite worker: ${path.relative(process.cwd(), result.workerPath)}`);
  console.log(`Pages SQLite WASM: ${result.absoluteAssetUrl} (${result.wasmBytes} bytes, valid)`);
}
