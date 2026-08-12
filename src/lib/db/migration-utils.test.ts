import assert from 'node:assert/strict';
import test from 'node:test';

import { addColumnIfMissing } from './migration-utils.ts';

test('adds a missing migration column once', async () => {
  const statements: string[] = [];
  const db = {
    getAllAsync: async () => [{ name: 'id' }],
    execAsync: async (statement: string) => { statements.push(statement); },
  };
  assert.equal(await addColumnIfMissing(db, 'user_profile', 'medical_notice_at', 'TEXT'), true);
  assert.deepEqual(statements, ['ALTER TABLE user_profile ADD COLUMN medical_notice_at TEXT']);
});

test('leaves an already-added migration column untouched', async () => {
  const statements: string[] = [];
  const db = {
    getAllAsync: async () => [{ name: 'id' }, { name: 'medical_notice_at' }],
    execAsync: async (statement: string) => { statements.push(statement); },
  };
  assert.equal(await addColumnIfMissing(db, 'user_profile', 'medical_notice_at', 'TEXT'), false);
  assert.deepEqual(statements, []);
});
