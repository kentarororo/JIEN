import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
const gate = readFileSync(
  new URL('../src/components/web-sqlite-gate.tsx', import.meta.url),
  'utf8',
);

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

test('web startup actively hands OPFS ownership to a refreshing page', () => {
  assert.match(gate, /BroadcastChannel/);
  assert.match(gate, /createWebSQLiteHandoffRequest/);
  assert.match(gate, /shouldYieldWebSQLiteOwnership/);
  assert.match(gate, /webSQLiteWorkerRegistry\.shutdown\(\)/);
  assert.ok(
    gate.indexOf("window.addEventListener('pagehide'") <
      gate.indexOf("setLeaseReadiness({ state: 'ready' })"),
  );
});
