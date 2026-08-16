import assert from 'node:assert/strict';
import test from 'node:test';

import { canOpenCachedWebDatabase, hydrationCopy } from './web-cloud-hydration.ts';

test('cloud hydration reports an online requirement without exposing app screens', () => {
  assert.match(hydrationCopy({ state: 'offline', pushed: 0, pulled: 0, profileRestored: false }).body, /internet connection/i);
});

test('cloud hydration makes account conflicts actionable and non-merging', () => {
  const copy = hydrationCopy({ state: 'account_conflict', pushed: 0, pulled: 0, profileRestored: false });
  assert.match(copy.title, /does not match/i);
  assert.match(copy.body, /No local records were changed/i);
});

test('a durable cached profile opens offline only for its authenticated owner', () => {
  const result = { state: 'offline', pushed: 0, pulled: 0, profileRestored: false } as const;
  assert.equal(canOpenCachedWebDatabase({
    result,
    authenticatedUserId: 'account-a',
    localOwnerUserId: 'account-a',
    hasCompletedProfile: true,
  }), true);
  assert.equal(canOpenCachedWebDatabase({
    result,
    authenticatedUserId: 'account-b',
    localOwnerUserId: 'account-a',
    hasCompletedProfile: true,
  }), false);
  assert.equal(canOpenCachedWebDatabase({
    result,
    authenticatedUserId: 'account-a',
    localOwnerUserId: 'account-a',
    hasCompletedProfile: false,
  }), false);
});

test('account conflicts and signed-out states never expose a cached database', () => {
  assert.equal(canOpenCachedWebDatabase({
    result: { state: 'account_conflict', pushed: 0, pulled: 0, profileRestored: false },
    authenticatedUserId: 'account-b',
    localOwnerUserId: 'account-a',
    hasCompletedProfile: true,
  }), false);
  assert.equal(canOpenCachedWebDatabase({
    result: { state: 'signed_out', pushed: 0, pulled: 0, profileRestored: false },
    authenticatedUserId: null,
    localOwnerUserId: 'account-a',
    hasCompletedProfile: true,
  }), false);
});

test('a quarantined cache must finish a cloud rebuild before opening', () => {
  assert.equal(canOpenCachedWebDatabase({
    result: { state: 'offline', pushed: 0, pulled: 0, profileRestored: false },
    authenticatedUserId: 'account-a',
    localOwnerUserId: 'account-a',
    hasCompletedProfile: true,
    requiresCloudRebuild: true,
  }), false);
});
