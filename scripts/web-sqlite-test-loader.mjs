import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = path.resolve(import.meta.dirname, '..');
const aliases = new Map([
  ['@jien/wa-sqlite', 'node_modules/wa-sqlite/dist/wa-sqlite-async.mjs'],
  ['@jien/wa-sqlite-api', 'node_modules/wa-sqlite/src/sqlite-api.js'],
  ['@jien/wa-sqlite-constants', 'node_modules/wa-sqlite/src/sqlite-constants.js'],
  ['@jien/wa-sqlite-memory-vfs', 'node_modules/wa-sqlite/src/examples/MemoryVFS.js'],
  ['@jien/wa-sqlite-wasm', 'node_modules/wa-sqlite/dist/wa-sqlite-async.wasm'],
]);

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'expo-crypto') {
    return {
      shortCircuit: true,
      url: `data:text/javascript,${encodeURIComponent('export const randomUUID = () => globalThis.crypto.randomUUID();')}`,
    };
  }
  const target = aliases.get(specifier);
  if (target) {
    return { shortCircuit: true, url: pathToFileURL(path.join(projectRoot, target)).href };
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (url.endsWith('.wasm')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(url)};`,
    };
  }
  return nextLoad(url, context);
}
