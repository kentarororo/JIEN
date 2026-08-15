import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateWebSQLiteReadiness, type WebSQLiteEnvironment } from './web-sqlite-readiness.ts';

const ready: WebSQLiteEnvironment = {
  isSecureContext: true,
  isCrossOriginIsolated: true,
  hasSharedArrayBuffer: true,
  hasServiceWorker: true,
  hasStorageDirectory: true,
  hasWorker: true,
};

test('allows SQLite only after the page is cross-origin isolated', () => {
  assert.deepEqual(evaluateWebSQLiteReadiness(ready), { state: 'ready' });
  assert.equal(
    evaluateWebSQLiteReadiness({ ...ready, isCrossOriginIsolated: false }).state,
    'preparing',
  );
});

test('reports unsupported persistent storage after isolation', () => {
  assert.deepEqual(evaluateWebSQLiteReadiness({ ...ready, hasStorageDirectory: false }), {
    state: 'unsupported',
    code: 'OPFS_UNAVAILABLE',
    message: 'This browser does not provide persistent private file storage.',
  });
});

test('main-thread memory mode does not require browser isolation or storage workers', () => {
  assert.deepEqual(
    evaluateWebSQLiteReadiness({
      ...ready,
      isCrossOriginIsolated: false,
      hasSharedArrayBuffer: false,
      hasServiceWorker: false,
      hasStorageDirectory: false,
      hasWorker: false,
    }, 'memory'),
    { state: 'ready' },
  );
});
