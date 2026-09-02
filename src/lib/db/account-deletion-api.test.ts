import assert from 'node:assert/strict';
import test from 'node:test';

import { EdgeFunctionError } from './supabase.ts';
import { parseAccountDeletionResponse } from './account-deletion-api.ts';

test('accepts only an explicit successful account-deletion result', () => {
  assert.deepEqual(parseAccountDeletionResponse({ deleted: true }), { deleted: true });
  for (const value of [null, {}, { deleted: false }, { deleted: 'true' }, []]) {
    assert.throws(
      () => parseAccountDeletionResponse(value),
      (cause: unknown) => cause instanceof EdgeFunctionError
        && cause.code === 'INVALID_RESPONSE'
        && cause.retryable === false,
    );
  }
});
