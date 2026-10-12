export type PhotoAiProvider = 'gemini' | 'anthropic';

export type PhotoProviderEnvironment = {
  PHOTO_AI_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_WORKSPACE_ID?: string;
};

export type PhotoProviderConfiguration = {
  provider: PhotoAiProvider;
  apiKey: string;
  model: string;
  workspaceId?: string;
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
  code: 'PROVIDER_TIMEOUT' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_AUTH_INVALID'
    | 'PROVIDER_REQUEST_INVALID' | 'PROVIDER_MODEL_UNAVAILABLE'
    | 'PROVIDER_QUOTA_EXCEEDED' | 'PROVIDER_OUTPUT_INVALID';
  retryable: boolean;
  httpStatus: number;
  upstreamStatus?: number;
  upstreamCode?: string;
  upstreamReason?: string;

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
  workspaceId?: string,
): PhotoProviderConfiguration | null {
  const cleanKey = apiKey?.trim();
  const cleanModel = model?.trim();
  const cleanWorkspace = workspaceId?.trim();
  if (cleanWorkspace && !/^wrkspc_[A-Za-z0-9]{1,128}$/.test(cleanWorkspace)) return null;
  return cleanKey && cleanModel && validModel.test(cleanModel)
    ? { provider, apiKey: cleanKey, model: cleanModel, ...(cleanWorkspace ? { workspaceId: cleanWorkspace } : {}) }
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
  const anthropic = configuredProvider('anthropic', environment.ANTHROPIC_API_KEY, environment.ANTHROPIC_MODEL, environment.ANTHROPIC_WORKSPACE_ID);

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
    'Convert the image into editable food line items.',
    `User description: ${description.trim() || 'none provided'}`,
    'If the image is a nutrition label, transcribe values for exactly the label serving instead of estimating them. Use the visible product name or user description, and lower confidence when text is unclear.',
    'Otherwise, use realistic portions and nutrition estimates. Confidence must be from 0 to 1.',
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
    if (!response.ok) {
      const failure = await providerHttpError(response, configuration.provider);
      failure.upstreamStatus = response.status;
      const body = await response.json().catch(() => null);
      const providerError = asRecord(asRecord(body)?.error);
      const upstreamCode = configuration.provider === 'anthropic' ? providerError?.type : providerError?.status;
      // Only canonical status names, never a provider message or arbitrary body field.
      if (typeof upstreamCode === 'string' && [
        'INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'OUT_OF_RANGE', 'UNAUTHENTICATED',
        'PERMISSION_DENIED', 'NOT_FOUND', 'RESOURCE_EXHAUSTED', 'UNAVAILABLE',
        'DEADLINE_EXCEEDED', 'INTERNAL', 'UNKNOWN', 'CANCELLED', 'ABORTED',
        'invalid_request_error', 'authentication_error', 'permission_error', 'not_found_error',
        'rate_limit_error', 'api_error', 'overloaded_error', 'request_too_large',
      ].includes(upstreamCode)) failure.upstreamCode = upstreamCode;
      if (configuration.provider === 'anthropic') {
        failure.upstreamReason = classifyAnthropicRejection(providerError?.message);
      }
      throw failure;
    }
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
          maxOutputTokens: 4096,
          thinkingConfig: { thinkingLevel: 'minimal' },
          responseMimeType: 'application/json',
          responseJsonSchema: photoItemsSchema,
        },
      }),
    },
  );
}

// Return only fixed categories: never log provider text, which may echo user input.
function classifyAnthropicRejection(message: unknown): string {
  if (typeof message !== 'string') return 'unknown';
  const text = message.toLowerCase();
  if (/credit balance|billing|purchase credits/.test(text)) return 'billing';
  if (/organization|workspace|account/.test(text)) return 'account';
  if (/output_config|effort/.test(text)) return 'output_config';
  if (/max_tokens|budget_tokens|thinking/.test(text)) return 'token_or_thinking_config';
  if (/temperature|top_p|top_k/.test(text)) return 'sampling_config';
  if (/image|base64|media_type/.test(text)) return 'image';
  if (/anthropic-version/.test(text)) return 'api_version';
  if (/model/.test(text)) return 'model';
  return 'unknown';
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
      ...(configuration.workspaceId ? { 'anthropic-workspace-id': configuration.workspaceId } : {}),
    },
    body: JSON.stringify({
      model: configuration.model,
      max_tokens: 4096,
      ...(configuration.model === 'claude-haiku-5-5' ? { output_config: { effort: 'low' } } : {}),
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.imageBase64 } },
          { type: 'text', text: `${buildPhotoEstimatePrompt(input.description)}\nReturn JSON only matching this JSON Schema (no markdown):\n${JSON.stringify(photoItemsSchema)}` },
        ],
      }],
    }),
  });
}

async function providerHttpError(response: Response, provider: PhotoAiProvider): Promise<PhotoProviderError> {
  const status = response.status;
  const retryable = status === 408 || status === 429 || status >= 500;
  if (status === 401 || status === 403) {
    return new PhotoProviderError(
      'PROVIDER_AUTH_INVALID',
      `${provider === 'gemini' ? 'Gemini' : 'The AI provider'} did not permit this key to generate content.`,
      false,
      403,
    );
  }
  if (status === 404) {
    return new PhotoProviderError(
      'PROVIDER_MODEL_UNAVAILABLE',
      'The configured AI model is not available to this project.',
      false,
      503,
    );
  }
  if (status === 400 || status === 422) {
    return new PhotoProviderError(
      'PROVIDER_REQUEST_INVALID',
      'JIEN sent a request this AI model could not accept.',
      false,
      502,
    );
  }
  if (status === 429) {
    return new PhotoProviderError(
      'PROVIDER_QUOTA_EXCEEDED',
      'The AI connection has reached a provider quota or rate limit. Try again after it resets.',
      true,
      429,
    );
  }
  return new PhotoProviderError(
    'PROVIDER_UNAVAILABLE',
    retryable
      ? 'The photo service could not analyze this image. Try again.'
      : `The photo provider rejected this request (HTTP ${status}). Keep the support reference and enter the food manually.`,
    retryable,
    retryable ? 502 : 503,
  );
}

function extractGeminiText(value: unknown): string | null {
  const record = asRecord(value);
  const candidates = record?.candidates;
  if (!Array.isArray(candidates)) return null;
  const candidate = asRecord(candidates[0]);
  // Partial JSON must never become an apparently complete nutrition estimate.
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') return null;
  const content = asRecord(candidate?.content);
  if (!Array.isArray(content?.parts)) return null;
  const text = content.parts
    .map((part) => { const value = asRecord(part); return value?.thought === true ? null : value?.text; })
    .filter((part): part is string => typeof part === 'string')
    .join('')
    .trim();
  return text && text.length <= 100_000 ? text : null;
}

function extractAnthropicText(value: unknown): string | null {
  const record = asRecord(value);
  if (record?.stop_reason && record.stop_reason !== 'end_turn') return null;
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
