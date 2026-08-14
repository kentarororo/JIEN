import assert from 'node:assert/strict';
import test from 'node:test';

import { getAuthStorage } from './storage.web.ts';

test('web auth uses the browser storage object directly', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  const browserStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: browserStorage,
  });
  try {
    assert.equal(getAuthStorage(), browserStorage);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('web auth reports when browser storage is unavailable', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Reflect.deleteProperty(globalThis, 'localStorage');
  try {
    assert.throws(() => getAuthStorage(), /Browser storage is unavailable/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
  }
});
