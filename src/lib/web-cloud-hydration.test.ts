import assert from 'node:assert/strict';
import test from 'node:test';

import { hydrationCopy } from './web-cloud-hydration.ts';

test('cloud hydration reports an online requirement without exposing app screens', () => {
  assert.match(hydrationCopy({ state: 'offline', pushed: 0, pulled: 0, profileRestored: false }).body, /internet connection/i);
});

test('cloud hydration makes account conflicts actionable and non-merging', () => {
  const copy = hydrationCopy({ state: 'account_conflict', pushed: 0, pulled: 0, profileRestored: false });
  assert.match(copy.title, /does not match/i);
  assert.match(copy.body, /No local records were changed/i);
});
