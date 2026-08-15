export const MAX_MEAL_PHOTO_ATTEMPTS = 5;

export function canRetryMealPhoto(providerRetryable: boolean, attemptCount: number): boolean {
  return providerRetryable && attemptCount < MAX_MEAL_PHOTO_ATTEMPTS;
}

export function nextMealPhotoAttemptAt(
  attemptCount: number,
  nowMs = Date.now(),
): string {
  const boundedAttempt = Math.max(1, Math.min(MAX_MEAL_PHOTO_ATTEMPTS, Math.floor(attemptCount)));
  const delayMs = Math.min(60 * 60_000, 60_000 * (2 ** (boundedAttempt - 1)));
  return new Date(nowMs + delayMs).toISOString();
}
