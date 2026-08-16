export type PhotoAiProvider = 'gemini' | 'anthropic';

export type PhotoProviderEnvironment = {
  PHOTO_AI_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
};

export type PhotoProviderConfiguration = {
  provider: PhotoAiProvider;
  apiKey: string;
  model: string;
};

export type PhotoProviderResolution =
  | { ok: true; configuration: PhotoProviderConfiguration }
  | { ok: false; code: 'PHOTO_AI_NOT_CONFIGURED' };

export type PhotoProviderInput = {
  imageBase64: string;
  mediaType: string;
  description: string;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class PhotoProviderError extends Error {
  code: 'PROVIDER_TIMEOUT' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_CONFIGURATION_INVALID' | 'PROVIDER_OUTPUT_INVALID';
  retryable: boolean;
  httpStatus: number;

  constructor(
    code: PhotoProviderError['code'],
    message: string,
    retryable: boolean,
    httpStatus: number,
  ) {
    super(message);
    this.name = 'PhotoProviderError';
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
  }
}

const DEFAULT_PROVIDER_TIMEOUT_MS = 22_000;
const validModel = /^[A-Za-z0-9._-]{1,128}$/;

const photoItemsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      minItems: 0,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Short food name.' },
          quantity: { type: 'number', description: 'Positive serving quantity.' },
          unit: { type: 'string', description: 'Serving unit such as plate, bowl, g, or ml.' },
          caloriesKcal: { type: 'number', minimum: 0 },
          proteinG: { type: 'number', minimum: 0 },
          carbohydrateG: { type: 'number', minimum: 0 },
          fatG: { type: 'number', minimum: 0 },
          fibreG: { type: ['number', 'null'], minimum: 0 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: [
          'name', 'quantity', 'unit', 'caloriesKcal', 'proteinG',
          'carbohydrateG', 'fatG', 'fibreG', 'confidence',
        ],
      },
    },
  },
  required: ['items'],
} as const;

function configuredProvider(
  provider: PhotoAiProvider,
  apiKey: string | undefined,
  model: string | undefined,
): PhotoProviderConfiguration | null {
  const cleanKey = apiKey?.trim();
  const cleanModel = model?.trim();
  return cleanKey && cleanModel && validModel.test(cleanModel)
    ? { provider, apiKey: cleanKey, model: cleanModel }
    : null;
}

/**
 * Resolve the server-owned provider deterministically. Explicit selection never
 * falls through. `auto` prefers Gemini, then Anthropic, when a complete pair of
 * server secrets exists.
 */
export function resolvePhotoProvider(
  environment: PhotoProviderEnvironment,
): PhotoProviderResolution {
  const requested = environment.PHOTO_AI_PROVIDER?.trim().toLowerCase() || 'auto';
  const gemini = configuredProvider('gemini', environment.GEMINI_API_KEY, environment.GEMINI_MODEL);
  const anthropic = configuredProvider('anthropic', environment.ANTHROPIC_API_KEY, environment.ANTHROPIC_MODEL);

  if (requested === 'gemini') {
    return gemini ? { ok: true, configuration: gemini } : { ok: false, code: 'PHOTO_AI_NOT_CONFIGURED' };
  }
  if (requested === 'anthropic') {
    return anthropic ? { ok: true, configuration: anthropic } : { ok: false, code: 'PHOTO_AI_NOT_CONFIGURED' };
  }
  if (requested !== 'auto') return { ok: false, code: 'PHOTO_AI_NOT_CONFIGURED' };
  const configuration = gemini ?? anthropic;
  return configuration
    ? { ok: true, configuration }
    : { ok: false, code: 'PHOTO_AI_NOT_CONFIGURED' };
}

export function buildPhotoEstimatePrompt(description: string): string {
  return [
    'Estimate the visible meal as editable food line items.',
    `User description: ${description.trim() || 'none provided'}`,
    'Use realistic portions and nutrition estimates. Confidence must be from 0 to 1.',
    'If no food is visible, return an empty items array. Do not provide medical advice.',
  ].join('\n');
}

export async function requestPhotoEstimate(
  configuration: PhotoProviderConfiguration,
  input: PhotoProviderInput,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<string> {
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
    const text = configuration.provider === 'gemini'
      ? extractGeminiText(payload)
      : extractAnthropicText(payload);
    if (!text) {
      throw new PhotoProviderError(
        'PROVIDER_OUTPUT_INVALID',
        'The photo result could not be read. Try again.',
        true,
        502,
      );
    }
    return text;
  } catch (cause) {
    if (cause instanceof PhotoProviderError) throw cause;
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new PhotoProviderError(
        'PROVIDER_TIMEOUT',
        'Photo analysis took too long. Try again.',
        true,
        504,
      );
    }
    throw new PhotoProviderError(
      'PROVIDER_UNAVAILABLE',
      'The photo service could not be reached. Try again.',
      true,
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function requestGemini(
  configuration: PhotoProviderConfiguration,
  input: PhotoProviderInput,
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
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: input.mediaType, data: input.imageBase64 } },
            { text: buildPhotoEstimatePrompt(input.description) },
          ],
        }],
        generationConfig: {
          maxOutputTokens: 1200,
          thinkingConfig: { thinkingLevel: 'low' },
          responseFormat: {
            text: {
              mimeType: 'application/json',
              schema: photoItemsSchema,
            },
          },
        },
      }),
    },
  );
}

function requestAnthropic(
  configuration: PhotoProviderConfiguration,
  input: PhotoProviderInput,
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
      max_tokens: 1200,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.imageBase64 } },
          { type: 'text', text: `${buildPhotoEstimatePrompt(input.description)}\nReturn JSON only using the requested items shape.` },
        ],
      }],
    }),
  });
}

function providerHttpError(status: number): PhotoProviderError {
  const retryable = status === 408 || status === 429 || status >= 500;
  return retryable
    ? new PhotoProviderError(
      'PROVIDER_UNAVAILABLE',
      'The photo service could not analyze this image. Try again.',
      true,
      502,
    )
    : new PhotoProviderError(
      'PROVIDER_CONFIGURATION_INVALID',
      'JIEN photo analysis needs a server configuration update.',
      false,
      503,
    );
}

function extractGeminiText(value: unknown): string | null {
  const record = asRecord(value);
  const candidates = record?.candidates;
  if (!Array.isArray(candidates)) return null;
  const candidate = asRecord(candidates[0]);
  const content = asRecord(candidate?.content);
  if (!Array.isArray(content?.parts)) return null;
  const text = content.parts
    .map((part) => asRecord(part)?.text)
    .filter((part): part is string => typeof part === 'string')
    .join('')
    .trim();
  return text && text.length <= 100_000 ? text : null;
}

function extractAnthropicText(value: unknown): string | null {
  const record = asRecord(value);
  if (!Array.isArray(record?.content)) return null;
  const text = record.content
    .map((part) => asRecord(part))
    .find((part) => part?.type === 'text')?.text;
  return typeof text === 'string' && text.trim() && text.length <= 100_000
    ? text.trim()
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
