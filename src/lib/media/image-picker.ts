import type {
  ImagePickerAsset,
  ImagePickerErrorResult,
  ImagePickerResult,
} from 'expo-image-picker';

export const MAX_MEAL_PHOTO_BYTES = 25 * 1024 * 1024;

export type MealPhotoPickerResolution =
  | { kind: 'selected'; asset: ImagePickerAsset }
  | { kind: 'canceled' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

export function resolveMealPhotoPickerResult(
  result: ImagePickerResult | ImagePickerErrorResult | null,
): MealPhotoPickerResolution {
  if (result == null) return { kind: 'empty' };
  if ('code' in result) {
    return { kind: 'error', message: result.message || 'The photo picker could not reopen the selected image.' };
  }
  if (result.canceled) return { kind: 'canceled' };
  const asset = result.assets[0];
  if (!asset) return { kind: 'error', message: 'The photo picker did not return an image.' };
  if (asset.type && asset.type !== 'image' && asset.type !== 'livePhoto') {
    return { kind: 'error', message: 'Choose a still meal photo rather than a video.' };
  }
  if (asset.fileSize != null && asset.fileSize > MAX_MEAL_PHOTO_BYTES) {
    return { kind: 'error', message: 'That photo is larger than 25 MB. Choose a smaller image.' };
  }
  return { kind: 'selected', asset };
}
