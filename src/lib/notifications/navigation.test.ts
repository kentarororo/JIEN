import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getNotificationHref } from './navigation.ts';

test('notification navigation accepts only exact in-app destinations', () => {
  assert.equal(getNotificationHref({ href: '/meals/new' }), '/meals/new');
  assert.equal(getNotificationHref({ href: '/settings' }), '/settings');
  assert.equal(getNotificationHref({ href: 'https://example.com' }), null);
  assert.equal(getNotificationHref({ href: '/settings/account' }), null);
  assert.equal(getNotificationHref(null), null);
});

test('the app runtime opens only validated notification destinations', () => {
  const runtime = readFileSync(new URL('../../components/app-runtime.tsx', import.meta.url), 'utf8');
  const notifications = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(runtime, /addNotificationResponseReceivedListener/);
  assert.match(runtime, /getNotificationHref/);
  assert.match(notifications, /href: '\/meals\/new'/);
  assert.match(notifications, /href: '\/settings'/);
});
