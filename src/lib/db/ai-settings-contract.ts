export type AiConnectionStatus = {
  configured: boolean;
  credentialSource: 'personal' | 'app' | null;
  provider: 'gemini' | null;
  model: string;
  limits: {
    photoPerUtcDay: number;
    contextPerUtcDay: number;
  };
  requestId: string;
};

export function parseAiConnectionStatus(value: unknown): Omit<AiConnectionStatus, 'requestId'> {
  const row = asRecord(value);
  const limits = asRecord(row?.limits);
  const model = typeof row?.model === 'string' ? row.model.trim() : '';
  const photoPerUtcDay = positiveInteger(limits?.photoPerUtcDay);
  const contextPerUtcDay = positiveInteger(limits?.contextPerUtcDay);
  const source = row?.credentialSource;
  if (!row || typeof row.configured !== 'boolean'
    || (source !== 'personal' && source !== 'app' && source !== null)
    || (row.provider !== 'gemini' && row.provider !== null)
    || !model || photoPerUtcDay == null || contextPerUtcDay == null) {
    throw new Error('AI connection status could not be read.');
  }
  return {
    configured: row.configured,
    credentialSource: source,
    provider: row.provider,
    model,
    limits: { photoPerUtcDay, contextPerUtcDay },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 1000
    ? value
    : null;
}
