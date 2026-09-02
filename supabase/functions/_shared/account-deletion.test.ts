import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isConfirmedAccountDeletionEnvelope } from './account-deletion.ts';

test('requires the versioned DELETE confirmation without accepting a caller user id', () => {
  assert.equal(isConfirmedAccountDeletionEnvelope({ version: 1, data: { confirmation: 'DELETE' } }), true);
  assert.equal(isConfirmedAccountDeletionEnvelope({ version: 1, data: { confirmation: 'delete' } }), false);
  assert.equal(isConfirmedAccountDeletionEnvelope({ version: 1, data: { confirmation: 'DELETE', userId: 'other-user' } }), false);
  assert.equal(isConfirmedAccountDeletionEnvelope({ version: 2, data: { confirmation: 'DELETE' } }), false);
});

test('deletes private Vault data before the authenticated user and never trusts a body user id', () => {
  const source = readFileSync(new URL('../delete-account/index.ts', import.meta.url), 'utf8');
  const credentialDeletion = source.indexOf("admin.rpc('delete_user_ai_credential'");
  const accountDeletion = source.indexOf('admin.auth.admin.deleteUser(userId, false)');
  assert.ok(credentialDeletion > -1);
  assert.ok(accountDeletion > credentialDeletion);
  assert.match(source, /const userId = userData\.user\.id/);
  assert.doesNotMatch(source, /envelope\.data\.userId/);
});
