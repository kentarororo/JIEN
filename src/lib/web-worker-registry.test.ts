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
