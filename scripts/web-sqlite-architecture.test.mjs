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

test('web memory startup does not request browser storage or cross-tab ownership', () => {
  assert.doesNotMatch(gate, /BroadcastChannel/);
  assert.doesNotMatch(gate, /navigator\.locks/);
  assert.match(layout, /Platform\.OS === 'web' \? ':memory:' : 'jien\.db'/);
  assert.match(gate, /evaluateWebSQLiteReadiness\([\s\S]*'memory'\)/);
  assert.doesNotMatch(gate, /webSQLiteWorkerRegistry/);
});

test('web authenticates and hydrates before database consumers render', () => {
  assert.match(layout, /<WebAuthGate><DatabaseApp \/><\/WebAuthGate>/);
  assert.ok(layout.indexOf('<WebCloudHydrationGate>') < layout.indexOf('<AppRuntime />'));
  assert.ok(layout.indexOf('callbackRequest') < layout.indexOf('<WebAuthGate>'));
});

test('web SQLite runs in memory without a worker or isolation service worker', () => {
  assert.match(webProvider, /WaSQLiteFactory/);
  assert.match(webProvider, /MemoryVFS/);
  assert.doesNotMatch(webProvider, /AccessHandlePoolVFS|SharedArrayBuffer|new Worker/);
  assert.doesNotMatch(html, /coi-serviceworker/);
  assert.match(gate, /retireLegacyIsolationServiceWorker/);
  assert.match(gate, /registration\.unregister\(\)/);
});
