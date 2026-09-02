// Native SQLite may safely retain a prepared photo with its durable queue job.
// The web build overrides this module and keeps large bytes outside the serialized SQLite image.
export async function storeMealPhotoPayload(_jobId: string, base64: string): Promise<string> {
  return base64;
}

export async function resolveMealPhotoPayload(reference: string): Promise<string | null> {
  return reference.trim() || null;
}

export async function removeMealPhotoPayload(_reference: string): Promise<void> {}

// Native photo payloads live inside meal_photo_jobs and are removed by the
// account-data SQLite transaction.
export async function clearMealPhotoPayloadsForAccount(_ownerUserId: string): Promise<void> {}
