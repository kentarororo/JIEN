export type WellnessChatResponse = {
  message: {
    id: string;
    conversationId: string;
    sequence: number;
    content: string;
    createdAt: string;
    model: string | null;
  };
};

export type ExpectedWellnessReply = {
  assistantMessageId: string;
  conversationId: string;
  assistantSequence: number;
};

type ErrorDetails = {
  code?: unknown;
  retryable?: unknown;
  requestId?: unknown;
  message?: unknown;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const ERROR_CODE_PATTERN = /^[A-Z0-9_]{2,64}$/;

/** Reject a successful envelope whose message does not match the reserved reply. */
export function parseWellnessChatResponse(
  value: unknown,
  expected: ExpectedWellnessReply,
): WellnessChatResponse {
  const response = asRecord(value);
  const message = asRecord(response?.message);
  if (!message
    || message.id !== expected.assistantMessageId
    || message.conversationId !== expected.conversationId
    || message.sequence !== expected.assistantSequence
    || !UUID_PATTERN.test(String(message.id))
    || !UUID_PATTERN.test(String(message.conversationId))) {
    throw new Error('WELLNESS_RESPONSE_INVALID');
  }
  if (typeof message.content !== 'string'
    || !message.content.trim()
    || message.content.length > 12_000
    || !validIsoTimestamp(message.createdAt)) {
    throw new Error('WELLNESS_RESPONSE_INVALID');
  }
  const model = message.model;
  if (model != null && (typeof model !== 'string' || !model.trim() || model.length > 128)) {
    throw new Error('WELLNESS_RESPONSE_INVALID');
  }
  return {
    message: {
      id: message.id,
      conversationId: message.conversationId,
      sequence: message.sequence,
      content: message.content,
      createdAt: message.createdAt,
      model: model == null ? null : model,
    },
  };
}

/** Keep only safe, bounded diagnostics alongside the immutable retry metadata. */
export function withWellnessFailureMetadata(
  current: Record<string, unknown>,
  cause: unknown,
): Record<string, unknown> {
  const details = cause != null && typeof cause === 'object' ? cause as ErrorDetails : null;
  const hasSafeCode = typeof details?.code === 'string' && ERROR_CODE_PATTERN.test(details.code);
  const invalidResponse = cause instanceof Error && cause.message === 'WELLNESS_RESPONSE_INVALID';
  const code = hasSafeCode
    ? details.code as string
    : invalidResponse
      ? 'INVALID_RESPONSE'
      : 'WELLNESS_REQUEST_FAILED';
  const requestId = typeof details?.requestId === 'string' && REQUEST_ID_PATTERN.test(details.requestId)
    ? details.requestId
    : null;
  const message = hasSafeCode && typeof details?.message === 'string' && details.message.trim()
    ? details.message.trim().slice(0, 240)
    : invalidResponse
      ? 'The AI service returned an invalid response. You can retry it.'
      : 'AI guidance is unavailable right now.';
  return {
    ...current,
    last_error: {
      code,
      message,
      retryable: typeof details?.retryable === 'boolean' ? details.retryable : true,
      request_id: requestId,
    },
  };
}

export function withoutWellnessFailureMetadata(
  current: Record<string, unknown>,
): Record<string, unknown> {
  const { last_error: _lastError, ...rest } = current;
  return rest;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 40) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
