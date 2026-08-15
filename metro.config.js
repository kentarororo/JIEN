const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);

// The GitHub Pages tester uses Expo's bundled wa-sqlite build directly on the
// main thread. These internal aliases avoid expo-sqlite's SharedArrayBuffer
// worker, which requires response headers that GitHub Pages cannot provide.
const webSQLiteAliases = {
  '@jien/wa-sqlite': path.resolve(__dirname, 'node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.js'),
  '@jien/wa-sqlite-api': path.resolve(__dirname, 'node_modules/expo-sqlite/web/wa-sqlite/sqlite-api.js'),
  '@jien/wa-sqlite-constants': path.resolve(__dirname, 'node_modules/expo-sqlite/web/wa-sqlite/sqlite-constants.js'),
  '@jien/wa-sqlite-memory-vfs': path.resolve(__dirname, 'node_modules/expo-sqlite/web/wa-sqlite/MemoryVFS.js'),
  '@jien/wa-sqlite-wasm': path.resolve(__dirname, 'node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.wasm'),
};

config.resolver.assetExts.push('wasm');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const target = platform === 'web' ? webSQLiteAliases[moduleName] : undefined;
  return context.resolveRequest(context, target ?? moduleName, platform);
};

module.exports = config;
