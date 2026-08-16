import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
const gate = readFileSync(
  new URL('../src/components/web-sqlite-gate.tsx', import.meta.url),
  'utf8',
);
const webProvider = readFileSync(
  new URL('../src/lib/db/database-context.web.tsx', import.meta.url),
  'utf8',
);
const snapshotStore = readFileSync(
  new URL('../src/lib/db/web-database-snapshot.ts', import.meta.url),
  'utf8',
);
const html = readFileSync(new URL('../src/app/+html.tsx', import.meta.url), 'utf8');

test('web startup has one SQLite owner instead of a preflight connection', () => {
  assert.doesNotMatch(gate, /openDatabaseAsync/);
  assert.equal(layout.match(/<SQLiteProvider\b/g)?.length, 1);
  assert.doesNotMatch(layout, /useSuspense/);
});

test('the provider installs the page lifecycle before app database consumers', () => {
  const lifecycleIndex = layout.indexOf('<WebSQLiteDatabaseLifecycle />');
  const runtimeIndex = layout.indexOf('<AppRuntime />');

  assert.notEqual(lifecycleIndex, -1);
  assert.ok(lifecycleIndex < runtimeIndex);
});

test('web startup does not request OPFS, workers, or cross-origin isolation', () => {
  assert.doesNotMatch(gate, /BroadcastChannel/);
  assert.doesNotMatch(gate, /navigator\.locks/);
  assert.match(layout, /Platform\.OS === 'web' \? ':memory:' : 'jien\.db'/);
  assert.doesNotMatch(gate, /webSQLiteWorkerRegistry/);
  assert.doesNotMatch(gate, /ISOLATION_TIMEOUT|SharedArrayBuffer|crossOriginIsolated/);
  assert.match(gate, /addEventListener\('pagehide'/);
  assert.match(gate, /addEventListener\('pageshow'/);
  assert.match(gate, /event\.persisted/);
});

test('web authenticates and hydrates before database consumers render', () => {
  assert.match(layout, /<WebAuthGate><DatabaseApp \/><\/WebAuthGate>/);
  assert.ok(layout.indexOf('<WebCloudHydrationGate>') < layout.indexOf('<AppRuntime />'));
  assert.ok(layout.indexOf('callbackRequest') < layout.indexOf('<WebAuthGate>'));
});

test('web SQLite uses a main-thread working database with account-scoped snapshots', () => {
  assert.match(webProvider, /WaSQLiteFactory/);
  assert.match(webProvider, /MemoryVFS/);
  assert.match(webProvider, /WebDatabaseSnapshotStore\.open\(account\.user\.id\)/);
  assert.match(webProvider, /sqlite\.deserialize/);
  assert.match(snapshotStore, /indexedDB\.open/);
  assert.match(snapshotStore, /jien-web-sqlite-v1/);
  assert.doesNotMatch(webProvider, /AccessHandlePoolVFS|SharedArrayBuffer|new Worker/);
  assert.doesNotMatch(html, /coi-serviceworker/);
  assert.match(gate, /retireLegacyIsolationServiceWorker/);
  assert.match(gate, /registration\.unregister\(\)/);
});
