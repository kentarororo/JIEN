const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const config = getDefaultConfig(__dirname);

// Web uses Expo's bundled wa-sqlite engine on the main thread with an
// IndexedDB VFS. Keeping these internal files behind project aliases avoids
// importing Expo's OPFS worker, whose access handles cannot be recovered
// reliably after an abandoned page lifecycle.
const webSQLiteAliases = {
  '@jien/wa-sqlite': path.resolve(__dirname, 'node_modules/wa-sqlite/dist/wa-sqlite-async.mjs'),
  '@jien/wa-sqlite-api': path.resolve(__dirname, 'node_modules/wa-sqlite/src/sqlite-api.js'),
  '@jien/wa-sqlite-constants': path.resolve(__dirname, 'node_modules/wa-sqlite/src/sqlite-constants.js'),
  '@jien/wa-sqlite-memory-vfs': path.resolve(__dirname, 'node_modules/wa-sqlite/src/examples/MemoryVFS.js'),
  '@jien/wa-sqlite-wasm': path.resolve(__dirname, 'node_modules/wa-sqlite/dist/wa-sqlite-async.wasm'),
};

config.resolver.assetExts.push('wasm');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const target = platform === 'web' ? webSQLiteAliases[moduleName] : undefined;
  return context.resolveRequest(context, target ?? moduleName, platform);
};

module.exports = config;
