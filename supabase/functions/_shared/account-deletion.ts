export function isConfirmedAccountDeletionEnvelope(value: unknown): boolean {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.data)) return false;
  const keys = Object.keys(value.data);
  return keys.length === 1 && keys[0] === 'confirmation' && value.data.confirmation === 'DELETE';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
