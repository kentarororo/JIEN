import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  if (specifier === 'expo-network') {
    return {
      shortCircuit: true,
      url: `data:text/javascript,${encodeURIComponent('export const getNetworkStateAsync = async () => ({ isConnected: true, isInternetReachable: true });')}`,
    };
  }
  if (specifier === 'react-native-url-polyfill/auto') {
    return { shortCircuit: true, url: 'data:text/javascript,export default {};' };
  }
  if (specifier === '@/lib/auth/storage') {
    return {
      shortCircuit: true,
      url: `data:text/javascript,${encodeURIComponent('export const getAuthStorage = () => globalThis.localStorage;')}`,
    };
  }
  const target = aliases.get(specifier);
  if (target) {
    return { shortCircuit: true, url: pathToFileURL(path.join(projectRoot, target)).href };
  }
  if (specifier.startsWith('@/')) {
    const requested = path.join(projectRoot, 'src', specifier.slice(2));
    const resolved = [requested, `${requested}.ts`, `${requested}.tsx`, path.join(requested, 'index.ts')]
      .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
    if (resolved) return { shortCircuit: true, url: pathToFileURL(resolved).href };
  }
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const requested = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    const resolved = [requested, `${requested}.ts`, `${requested}.tsx`, path.join(requested, 'index.ts')]
      .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
    if (resolved) return { shortCircuit: true, url: pathToFileURL(resolved).href };
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
