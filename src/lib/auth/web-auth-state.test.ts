import assert from 'node:assert/strict';
import test from 'node:test';

import { authKindAfterGoingOffline } from './web-auth-state.ts';

test('an authenticated web session remains mounted when connectivity drops', () => {
  assert.equal(authKindAfterGoingOffline('ready'), 'ready');
});

test('an unresolved web session still asks for connectivity', () => {
  assert.equal(authKindAfterGoingOffline('loading'), 'offline');
  assert.equal(authKindAfterGoingOffline('signed_out'), 'offline');
  assert.equal(authKindAfterGoingOffline('error'), 'offline');
});
