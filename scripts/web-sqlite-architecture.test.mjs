import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
const gate = readFileSync(new URL('../src/components/web-sqlite-gate.tsx', import.meta.url), 'utf8');
const lifecycle = readFileSync(new URL('../src/lib/web-sqlite-lifecycle.ts', import.meta.url), 'utf8');
const workerRegistry = readFileSync(new URL('../src/lib/web-worker-registry.ts', import.meta.url), 'utf8');
const webProvider = readFileSync(new URL('../src/lib/db/database-context.web.tsx', import.meta.url), 'utf8');
const nativeProvider = readFileSync(new URL('../src/lib/db/database-context.tsx', import.meta.url), 'utf8');
const webDatabase = readFileSync(new URL('../src/lib/db/web-indexeddb-database.ts', import.meta.url), 'utf8');
const metro = readFileSync(new URL('../metro.config.js', import.meta.url), 'utf8');
const webFinalizer = readFileSync(new URL('./finalize-web-build.mjs', import.meta.url), 'utf8');
const pagesHostFinalizer = readFileSync(
  new URL('./finalize-pages-host-build.mjs', import.meta.url),
  'utf8',
);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const webBuilder = readFileSync(new URL('./build-web.mjs', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const photoPayloadStore = readFileSync(new URL('../src/lib/db/meal-photo-payload.web.ts', import.meta.url), 'utf8');
const photoQueue = readFileSync(new URL('../src/lib/db/meal-photo-queue.ts', import.meta.url), 'utf8');
const workoutLogger = readFileSync(new URL('../src/app/workouts/new.tsx', import.meta.url), 'utf8');

test('native keeps Expo SQLite while web uses one account-scoped IndexedDB owner', () => {
  assert.equal(layout.match(/<SQLiteProvider\b/g)?.length, 1);
  assert.match(layout, /databaseName="jien\.db"/);
  assert.match(nativeProvider, /from 'expo-sqlite'/);
  assert.match(webProvider, /openWebIndexedDbDatabase/);
  assert.match(webDatabase, /IDBBatchAtomicVFS/);
  assert.match(webDatabase, /jien-web-sqlite-v2:/);
  assert.match(webDatabase, /durability: 'strict'/);
  assert.match(webDatabase, /purge: 'manual'/);
  assert.doesNotMatch(webDatabase, /AccessHandlePoolVFS|createSyncAccessHandle|new Worker/);
  assert.doesNotMatch(workoutLogger, /main-thread-memory-database|WebDatabaseDurabilityError/);
});

test('the provider installs the page lifecycle before app database consumers', () => {
  const lifecycleIndex = layout.indexOf('<WebSQLiteDatabaseLifecycle />');
  const runtimeIndex = layout.indexOf('<AppRuntime />');
  assert.notEqual(lifecycleIndex, -1);
  assert.ok(lifecycleIndex < runtimeIndex);
});

test('web refuses to mount SQLite without the host isolation contract', () => {
  assert.match(gate, /crossOriginIsolated === true/);
  assert.match(gate, /SharedArrayBuffer/);
  assert.match(gate, /CROSS_ORIGIN_ISOLATION_REQUIRED/);
  assert.match(gate, /listenPageHide/);
  assert.match(gate, /listenPageShow/);
  assert.match(gate, /event\.persisted/);
});

test('the web gate integrates coordinated ownership before mounting web SQLite', () => {
  assert.match(gate, /createWebSQLiteOwnershipCoordinator/);
  assert.match(gate, /navigator\.locks\.request/);
  assert.match(gate, /createOwnershipChannel/);
  assert.match(gate, /webSQLiteWorkerRegistry\.install\(window\)/);
  assert.match(gate, /webSQLiteWorkerRegistry\.shutdown\(\)/);
  assert.match(gate, /ownershipReadiness\.state === 'ready'[\s\S]*WebSQLiteOwnershipContext\.Provider[\s\S]*\{children\}/);
  assert.match(lifecycle, /closeDatabaseSync\?\.\(\)[\s\S]*options\.terminateWorkers\(\)[\s\S]*options\.releaseLease\(\)/);
  assert.match(workerRegistry, /worker\.terminate\(\)/);
  assert.doesNotMatch(gate, /terminateWorkers: \(\) => undefined/);
  assert.doesNotMatch(gate, /releaseLease: \(\) => undefined/);
});

test('startup failure and retry relinquish SQLite before reloading', () => {
  assert.match(webProvider, /\.catch\(\(cause\) => \{[\s\S]*opened\?\.closeSync\(\)/);
  assert.match(gate, /componentDidCatch[\s\S]*this\.context as WebSQLiteOwnershipContextValue \| null\)\?\.closeBeforeReload\(\)/);
  assert.match(gate, /const retry = \(\) => \{[\s\S]*closeBeforeReload\(\)[\s\S]*window\.location\.reload\(\)/);
});

test('Vercel publishes the main-thread SQLite WASM at a stable public path', () => {
  const headers = Object.fromEntries(vercel.headers[0].headers.map(({ key, value }) => [key, value]));
  assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(headers['Cross-Origin-Embedder-Policy'], 'credentialless');
  assert.equal(vercel.outputDirectory, 'dist');
  assert.equal(vercel.buildCommand, 'pnpm run web:build');
  assert.match(metro, /wa-sqlite-async\.mjs/);
  assert.match(metro, /@jien\/wa-sqlite/);
  assert.match(metro, /resolveRequest/);
  assert.match(metro, /assetExts\.push\('wasm'\)/);
  assert.match(webFinalizer, /assets', 'jien-sqlite/);
  assert.match(webFinalizer, /WebAssembly\.compile/);
  assert.doesNotMatch(webFinalizer, /workerPath|publicWorker/);
  assert.equal(packageJson.scripts['web:build'], 'node scripts/build-web.mjs');
  assert.match(webBuilder, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(webBuilder, /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(webBuilder, /'--clear'/);
});

test('GitHub Pages publishes a safe host-requirements screen instead of SQLite', () => {
  assert.match(packageJson.scripts['pages:build'], /finalize-pages-host-build\.mjs/);
  assert.match(pagesHostFinalizer, /CROSS_ORIGIN_ISOLATION_REQUIRED/);
  assert.match(pagesHostFinalizer, /\.nojekyll/);
  assert.doesNotMatch(packageJson.scripts['pages:build'], /finalize-pages-build\.mjs/);
});

test('web authenticates and hydrates before database consumers render', () => {
  assert.match(layout, /<WebSQLiteGate><WebAuthGate><DatabaseApp \/><\/WebAuthGate><\/WebSQLiteGate>/);
  assert.ok(layout.indexOf('<WebCloudHydrationGate>') < layout.indexOf('<AppRuntime />'));
  assert.ok(layout.indexOf('callbackRequest') < layout.indexOf('<WebAuthGate>'));
});

test('large retryable meal photos remain outside SQLite on web', () => {
  assert.match(photoPayloadStore, /jien-web-photo-payload-v1:/);
  assert.match(photoPayloadStore, /ownerUserId/);
  assert.match(photoQueue, /storeMealPhotoPayload/);
  assert.match(photoQueue, /externalizeLegacyMealPhotoPayloads/);
  assert.match(photoQueue, /resolveMealPhotoPayload/);
});

test('legacy local bytes are imported non-destructively into the IndexedDB VFS', () => {
  assert.match(webDatabase, /WebDatabaseSnapshotStore\.open\(ownerUserId\)/);
  assert.match(webDatabase, /databaseImageBelongsToOwner/);
  assert.match(webDatabase, /seedIndexedDbIfEmpty/);
  assert.doesNotMatch(webDatabase, /deleteDatabase|deleteFileSystem|removeEntry/);
});
