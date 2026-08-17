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

export type AiConnectionIssue = {
  code: string;
  title: string;
  message: string;
  requestId: string | null;
  retryable: boolean;
};

export function describeAiConnectionIssue(cause: unknown): AiConnectionIssue {
  const edge = asRecord(cause);
  const code = typeof edge?.code === 'string' ? edge.code : null;
  if (!code) {
    return {
      code: 'AI_CONNECTION_FAILED',
      title: 'Gemini was not connected',
      message: cause instanceof Error && cause.message
        ? cause.message
        : 'The Gemini key could not be connected. Try again.',
      requestId: null,
      retryable: false,
    };
  }

  const issue = {
    code,
    requestId: typeof edge?.requestId === 'string' ? edge.requestId : null,
    retryable: edge?.retryable === true,
  };
  switch (code) {
    case 'AI_KEY_INVALID':
      return { ...issue, title: 'Google rejected this key', message: 'Copy an active Gemini API key from Google AI Studio, then paste it again.' };
    case 'AI_KEY_VERIFICATION_TIMEOUT':
    case 'REQUEST_TIMEOUT':
      return { ...issue, title: 'Gemini took too long to respond', message: 'Your key is still in the field. Check your connection and try again.' };
    case 'NETWORK_REQUIRED':
      return { ...issue, title: 'A connection is required', message: 'Your key is still in the field. Reconnect to the internet and try again.' };
    case 'AUTH_REQUIRED':
      return { ...issue, title: 'Sign in again first', message: 'Your JIEN session expired. Sign in with Google again, then reconnect the key.' };
    case 'HTTP_404':
      return { ...issue, title: 'JIEN’s AI connector is not deployed', message: 'This build is missing the ai-settings Edge Function. Deploy the current Supabase functions, then try again.' };
    case 'AI_KEY_SAVE_FAILED':
    case 'AI_KEY_STATUS_FAILED':
      return { ...issue, title: 'JIEN’s secure key store is not ready', message: 'The current Supabase AI-credentials migration has not been applied successfully. Apply it, then try again.' };
    case 'SERVICE_NOT_CONFIGURED':
      return { ...issue, title: 'JIEN’s secure AI service is not ready', message: 'The Edge Function cannot reach its protected Supabase server credentials. This is a deployment issue, not a problem with your key.' };
    case 'AI_KEY_VERIFICATION_FAILED':
      return { ...issue, title: 'Gemini could not verify the key', message: 'Google’s key check is temporarily unavailable. Your key was not stored; try again shortly.' };
    default:
      return {
        ...issue,
        title: 'Gemini was not connected',
        message: typeof edge?.message === 'string' && edge.message
          ? edge.message
          : 'The Gemini key could not be connected. Try again.',
      };
  }
}

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
