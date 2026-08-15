export type WellnessAiProvider = 'gemini' | 'anthropic';

export type WellnessProviderEnvironment = {
  WELLNESS_AI_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
};

export type WellnessProviderConfiguration = {
  provider: WellnessAiProvider;
  apiKey: string;
  model: string;
};

export type WellnessProviderResolution =
  | { ok: true; configuration: WellnessProviderConfiguration }
  | { ok: false; code: 'AI_NOT_CONFIGURED' };

export type WellnessProviderInput = {
  system: string;
  prompt: string;
};

export type WellnessProviderResult = {
  text: string;
  providerMessageId: string | null;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class WellnessProviderError extends Error {
  code: 'AI_PROVIDER_TIMEOUT' | 'AI_PROVIDER_UNAVAILABLE' | 'AI_PROVIDER_CONFIGURATION_INVALID' | 'AI_EMPTY_RESPONSE';
  retryable: boolean;
  httpStatus: number;

  constructor(
    code: WellnessProviderError['code'],
    message: string,
    retryable: boolean,
    httpStatus: number,
  ) {
    super(message);
    this.name = 'WellnessProviderError';
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
  }
}

const DEFAULT_PROVIDER_TIMEOUT_MS = 22_000;
const validModel = /^[A-Za-z0-9._-]{1,128}$/;

function configuredProvider(
  provider: WellnessAiProvider,
  apiKey: string | undefined,
  model: string | undefined,
): WellnessProviderConfiguration | null {
  const cleanKey = apiKey?.trim();
  const cleanModel = model?.trim();
  return cleanKey && cleanModel && validModel.test(cleanModel)
    ? { provider, apiKey: cleanKey, model: cleanModel }
    : null;
}

/**
 * Resolve the JIEN-owned text provider. Explicit selection never silently
 * falls through; auto mode deterministically prefers Gemini, then Anthropic.
 */
export function resolveWellnessProvider(
  environment: WellnessProviderEnvironment,
): WellnessProviderResolution {
  const requested = environment.WELLNESS_AI_PROVIDER?.trim().toLowerCase() || 'auto';
  const gemini = configuredProvider('gemini', environment.GEMINI_API_KEY, environment.GEMINI_MODEL);
  const anthropic = configuredProvider('anthropic', environment.ANTHROPIC_API_KEY, environment.ANTHROPIC_MODEL);

  if (requested === 'gemini') {
    return gemini ? { ok: true, configuration: gemini } : { ok: false, code: 'AI_NOT_CONFIGURED' };
  }
  if (requested === 'anthropic') {
    return anthropic ? { ok: true, configuration: anthropic } : { ok: false, code: 'AI_NOT_CONFIGURED' };
  }
  if (requested !== 'auto') return { ok: false, code: 'AI_NOT_CONFIGURED' };
  const configuration = gemini ?? anthropic;
  return configuration
    ? { ok: true, configuration }
    : { ok: false, code: 'AI_NOT_CONFIGURED' };
}

export async function requestWellnessGuidance(
  configuration: WellnessProviderConfiguration,
  input: WellnessProviderInput,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<WellnessProviderResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS),
  );

  try {
    const response = configuration.provider === 'gemini'
      ? await requestGemini(configuration, input, fetchImpl, controller.signal)
      : await requestAnthropic(configuration, input, fetchImpl, controller.signal);
    if (!response.ok) throw providerHttpError(response.status);
    const payload = await response.json().catch(() => null);
    const result = configuration.provider === 'gemini'
      ? extractGeminiResult(payload)
      : extractAnthropicResult(payload);
    if (!result) {
      throw new WellnessProviderError(
        'AI_EMPTY_RESPONSE',
        'The AI service returned an empty response. Try again.',
        true,
        502,
      );
    }
    return result;
  } catch (cause) {
    if (cause instanceof WellnessProviderError) throw cause;
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new WellnessProviderError(
        'AI_PROVIDER_TIMEOUT',
        'The AI response took too long. Try again.',
        true,
        504,
      );
    }
    throw new WellnessProviderError(
      'AI_PROVIDER_UNAVAILABLE',
      'The AI service could not respond. Try again shortly.',
      true,
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function requestGemini(
  configuration: WellnessProviderConfiguration,
  input: WellnessProviderInput,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<Response> {
  return fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(configuration.model)}:generateContent`,
    {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': configuration.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
        generationConfig: { maxOutputTokens: 900 },
      }),
    },
  );
}

function requestAnthropic(
  configuration: WellnessProviderConfiguration,
  input: WellnessProviderInput,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<Response> {
  return fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': configuration.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: configuration.model,
      max_tokens: 900,
      temperature: 0.2,
      system: input.system,
      messages: [{ role: 'user', content: input.prompt }],
    }),
  });
}

function providerHttpError(status: number): WellnessProviderError {
  const retryable = status === 408 || status === 429 || status >= 500;
  return retryable
    ? new WellnessProviderError(
      'AI_PROVIDER_UNAVAILABLE',
      'The AI service could not respond. Try again shortly.',
      true,
      502,
    )
    : new WellnessProviderError(
      'AI_PROVIDER_CONFIGURATION_INVALID',
      'JIEN wellness guidance needs a server configuration update.',
      false,
      503,
    );
}

function extractGeminiResult(value: unknown): WellnessProviderResult | null {
  const record = asRecord(value);
  const candidates = record?.candidates;
  if (!Array.isArray(candidates)) return null;
  const content = asRecord(asRecord(candidates[0])?.content);
  if (!Array.isArray(content?.parts)) return null;
  return normalizedResult(
    content.parts.map((part) => asRecord(part)?.text).filter((part): part is string => typeof part === 'string').join(''),
    typeof record?.responseId === 'string' ? record.responseId : null,
  );
}

function extractAnthropicResult(value: unknown): WellnessProviderResult | null {
  const record = asRecord(value);
  if (!Array.isArray(record?.content)) return null;
  const text = record.content
    .map((part) => asRecord(part))
    .find((part) => part?.type === 'text')?.text;
  return normalizedResult(
    typeof text === 'string' ? text : '',
    typeof record.id === 'string' ? record.id : null,
  );
}

function normalizedResult(text: string, providerMessageId: string | null): WellnessProviderResult | null {
  const clean = text.trim();
  return clean && clean.length <= 50_000
    ? { text: clean, providerMessageId }
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
