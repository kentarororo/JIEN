import assert from 'node:assert/strict';
import test from 'node:test';

import {
  restoreOrCreateDatabaseEngine,
  WebDatabaseReloadRequiredError,
} from './web-database-recovery.ts';

test('discards a trapped WASM engine and requires a clean page before rebuilding', async () => {
  const created: number[] = [];
  const disposed: number[] = [];
  const events: string[] = [];
  await assert.rejects(
    restoreOrCreateDatabaseEngine({
      savedImage: new Uint8Array([1, 2, 3]),
      createEngine: async () => {
        const id = created.length + 1;
        created.push(id);
        events.push(`create:${id}`);
        return {
          value: id,
          dispose: async () => {
            disposed.push(id);
            events.push(`dispose:${id}`);
          },
        };
      },
      validate: async () => { throw new WebAssembly.RuntimeError('out of bounds memory access'); },
      quarantine: async () => { events.push('quarantine'); },
    }),
    (cause: unknown) => cause instanceof WebDatabaseReloadRequiredError,
  );

  assert.deepEqual(created, [1]);
  assert.deepEqual(disposed, [1]);
  assert.deepEqual(events, ['create:1', 'dispose:1', 'quarantine']);
});

test('keeps a restored engine only after validation succeeds', async () => {
  let createCount = 0;
  let quarantineCount = 0;
  const engine = await restoreOrCreateDatabaseEngine({
    savedImage: new Uint8Array([1]),
    createEngine: async () => ({ value: ++createCount, dispose: async () => undefined }),
    validate: async () => true,
    quarantine: async () => { quarantineCount += 1; },
  });

  assert.equal(engine.value, 1);
  assert.equal(createCount, 1);
  assert.equal(quarantineCount, 0);
});

test('opens one fresh engine when no saved image exists', async () => {
  let validateCount = 0;
  let quarantineCount = 0;
  const engine = await restoreOrCreateDatabaseEngine({
    savedImage: null,
    createEngine: async () => ({ value: 'fresh', dispose: async () => undefined }),
    validate: async () => { validateCount += 1; return true; },
    quarantine: async () => { quarantineCount += 1; },
  });

  assert.equal(engine.value, 'fresh');
  assert.equal(validateCount, 0);
  assert.equal(quarantineCount, 0);
});
