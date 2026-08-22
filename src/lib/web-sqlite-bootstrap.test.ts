import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeWebSQLiteStartupFailure,
  WebSQLiteStartupTimeoutError,
} from './web-sqlite-bootstrap.ts';
import { WebDatabaseReloadRequiredError } from './db/web-database-recovery.ts';

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

test('requests one clean page lifecycle after isolating an unsafe snapshot', () => {
  const result = describeWebSQLiteStartupFailure(new WebDatabaseReloadRequiredError());

  assert.equal(result.code, 'LOCAL_DATABASE_RECOVERY_REQUIRED');
  assert.equal(result.retryWithReload, true);
  assert.match(result.message, /rebuild it from your account/i);
});
