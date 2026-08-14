import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
const gate = readFileSync(
  new URL('../src/components/web-sqlite-gate.tsx', import.meta.url),
  'utf8',
);
const patch = readFileSync(new URL('../patches/expo-sqlite@57.0.1.patch', import.meta.url), 'utf8');

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

test('web memory startup does not request OPFS or cross-tab ownership', () => {
  assert.doesNotMatch(gate, /BroadcastChannel/);
  assert.doesNotMatch(gate, /navigator\.locks/);
  assert.match(layout, /Platform\.OS === 'web' \? ':memory:' : 'jien\.db'/);
  assert.match(gate, /evaluateWebSQLiteReadiness\([\s\S]*'memory'\)/);
  assert.match(gate, /webSQLiteWorkerRegistry\.shutdown\(\)/);
});

test('web authenticates and hydrates before database consumers render', () => {
  assert.match(layout, /<WebAuthGate><DatabaseApp \/><\/WebAuthGate>/);
  assert.ok(layout.indexOf('<WebCloudHydrationGate>') < layout.indexOf('<AppRuntime />'));
  assert.ok(layout.indexOf('callbackRequest') < layout.indexOf('<WebAuthGate>'));
});

test('the Expo worker patch keeps memory startup away from AccessHandlePoolVFS', () => {
  assert.match(patch, /databasePath === ':memory:'/);
  assert.match(patch, /maybeInitPersistentAsync/);
  assert.match(patch, /AccessHandlePoolVFS\.create/);
  const memoryInitializer = patch.slice(patch.indexOf('async function maybeInitAsync'), patch.indexOf('async function maybeInitPersistentAsync'));
  const addedMemoryInitializer = memoryInitializer.split('\n').filter((line) => line.startsWith('+')).join('\n');
  assert.doesNotMatch(addedMemoryInitializer, /AccessHandlePoolVFS\.create/);
});
