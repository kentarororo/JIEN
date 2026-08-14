import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_MEAL_PHOTO_BYTES, resolveMealPhotoPickerResult } from './image-picker.ts';

test('treats picker cancellation and an absent Android recovery result as quiet outcomes', () => {
  assert.deepEqual(resolveMealPhotoPickerResult(null), { kind: 'empty' });
  assert.deepEqual(resolveMealPhotoPickerResult({ canceled: true, assets: null }), { kind: 'canceled' });
});

test('accepts one still image and rejects videos or oversized photos', () => {
  const selected = resolveMealPhotoPickerResult({
    canceled: false,
    assets: [{ uri: 'file:///meal.jpg', width: 1200, height: 900, type: 'image', fileSize: 2_000_000 }],
  });
  assert.equal(selected.kind, 'selected');

  const video = resolveMealPhotoPickerResult({
    canceled: false,
    assets: [{ uri: 'file:///meal.mp4', width: 1200, height: 900, type: 'video' }],
  });
  assert.equal(video.kind, 'error');

  const oversized = resolveMealPhotoPickerResult({
    canceled: false,
    assets: [{ uri: 'file:///meal.jpg', width: 1200, height: 900, type: 'image', fileSize: MAX_MEAL_PHOTO_BYTES + 1 }],
  });
  assert.equal(oversized.kind, 'error');
});

test('surfaces an interrupted Android picker error', () => {
  assert.deepEqual(
    resolveMealPhotoPickerResult({ code: 'E_PICKER', message: 'Picker was interrupted.' }),
    { kind: 'error', message: 'Picker was interrupted.' },
  );
});
