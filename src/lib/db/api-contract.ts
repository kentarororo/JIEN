export type ApiErrorPayload = {
  code: string;
  message: string;
  retryable: boolean;
};

export type ParsedApiEnvelope<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: ApiErrorPayload; requestId: string };

export function parseApiEnvelope<T>(
  payload: unknown,
  status: number,
  fallbackRequestId: string,
): ParsedApiEnvelope<T> {
  const record = asRecord(payload);
  const requestId = typeof record?.requestId === 'string' && record.requestId.trim()
    ? record.requestId.trim().slice(0, 128)
    : fallbackRequestId;
  const errorRecord = asRecord(record?.error);

  if (errorRecord) {
    return {
      ok: false,
      error: {
        code: cleanCode(errorRecord.code) ?? `HTTP_${status}`,
        message: cleanMessage(errorRecord.message) ?? 'The service is unavailable right now.',
        retryable: typeof errorRecord.retryable === 'boolean'
          ? errorRecord.retryable
          : status >= 500,
      },
      requestId,
    };
  }

  if (status >= 200 && status < 300 && record && Object.hasOwn(record, 'data')) {
    return { ok: true, data: record.data as T, requestId };
  }

  return {
    ok: false,
    error: {
      code: `HTTP_${status}`,
      message: 'The service returned an invalid response. Try again.',
      retryable: status >= 500,
    },
    requestId,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toUpperCase();
  return /^[A-Z0-9_]{2,64}$/.test(clean) ? clean : null;
}

function cleanMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean ? clean.slice(0, 240) : null;
}
