import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeWebSQLiteStartupFailure,
  WebSQLiteStartupTimeoutError,
} from './web-sqlite-bootstrap.ts';

test('classifies an OPFS access-handle collision as busy local storage', () => {
  const result = describeWebSQLiteStartupFailure(
    new DOMException('Access Handles cannot be created while another handle is open', 'NoModificationAllowedError'),
  );

  assert.equal(result.code, 'LOCAL_STORAGE_BUSY');
  assert.equal(result.retryWithReload, true);
});

test('classifies a missing WASM asset as an engine load failure', () => {
  const result = describeWebSQLiteStartupFailure(new Error('Failed to fetch wa-sqlite.wasm'));

  assert.equal(result.code, 'SQLITE_ENGINE_LOAD_FAILED');
});

test('classifies a startup timeout without discarding the underlying data', () => {
  const result = describeWebSQLiteStartupFailure(new WebSQLiteStartupTimeoutError());

  assert.equal(result.code, 'SQLITE_INITIALIZATION_TIMEOUT');
  assert.match(result.message, /without removing your data/i);
});
