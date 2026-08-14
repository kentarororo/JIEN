import assert from 'node:assert/strict';
import test from 'node:test';

import { WebWorkerRegistry } from './web-worker-registry.ts';

class FakeWorker {
  terminated = false;
  readonly scriptURL: string | URL;
  readonly options?: WorkerOptions;

  constructor(
    scriptURL: string | URL,
    options?: WorkerOptions,
  ) {
    this.scriptURL = scriptURL;
    this.options = options;
  }

  terminate() {
    this.terminated = true;
  }
}

test('tracks workers created after installation and terminates them once', () => {
  const scope = { Worker: FakeWorker };
  const registry = new WebWorkerRegistry<FakeWorker>();
  registry.install(scope);

  const sqliteWorker = new scope.Worker('/worker-sqlite.js', { name: 'sqlite' });
  const otherWorker = new scope.Worker('/worker-other.js');
  assert.equal(registry.size, 2);
  assert.equal(sqliteWorker.scriptURL, '/worker-sqlite.js');
  assert.equal(sqliteWorker.options?.name, 'sqlite');

  registry.terminateAll();
  registry.terminateAll();

  assert.equal(sqliteWorker.terminated, true);
  assert.equal(otherWorker.terminated, true);
  assert.equal(registry.size, 0);
});

test('shutdown also terminates workers created during a late provider mount', () => {
  const scope = { Worker: FakeWorker };
  const registry = new WebWorkerRegistry<FakeWorker>();
  registry.install(scope);

  const currentWorker = new scope.Worker('/worker-current.js');
  registry.shutdown();
  const lateWorker = new scope.Worker('/worker-late.js');

  assert.equal(currentWorker.terminated, true);
  assert.equal(lateWorker.terminated, true);
  assert.equal(registry.size, 0);
});

test('a deliberate gate remount starts a new ownership cycle', () => {
  const scope = { Worker: FakeWorker };
  const registry = new WebWorkerRegistry<FakeWorker>();
  registry.install(scope);
  registry.shutdown();

  registry.install(scope);
  const replacementWorker = new scope.Worker('/worker-replacement.js');

  assert.equal(replacementWorker.terminated, false);
  assert.equal(registry.size, 1);
});
