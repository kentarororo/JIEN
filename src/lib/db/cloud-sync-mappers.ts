export function serializeCloudValue(value: unknown): unknown {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (Array.isArray(value) || (value != null && typeof value === 'object')) {
    return JSON.stringify(value);
  }
  return value;
}

export function preserveLocalAiMetadata(localStatus: string | null | undefined): boolean {
  return localStatus === 'pending' || localStatus === 'failed';
}

export function hasAccountConflict(ownerId: string | null | undefined, activeUserId: string): boolean {
  return Boolean(ownerId && ownerId !== activeUserId);
}

export function needsFullReconciliation(
  lastCompletedAt: string | null,
  nowMs: number,
  intervalMs: number,
): boolean {
  if (!lastCompletedAt) return true;
  const timestamp = Date.parse(lastCompletedAt);
  return !Number.isFinite(timestamp) || nowMs - timestamp >= intervalMs;
}
