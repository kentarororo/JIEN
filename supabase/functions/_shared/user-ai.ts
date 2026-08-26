export const PERSONAL_GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const AI_USAGE_POLICY = 'provider_managed' as const;
// Kept only so an older cached client can parse capability/status responses
// during a coordinated rollout. It is not consulted or enforced by JIEN.
export const LEGACY_UNCAPPED_DAILY_LIMIT = 1000;

export type PersonalAiConfiguration = {
  provider: 'gemini';
  apiKey: string;
  model: string;
};

type AdminClient = {
  rpc: (name: string, parameters: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

export function resolveSupabaseServerKey(environment: {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_SECRET_KEYS?: string;
}): string | null {
  const legacy = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (legacy) return legacy;
  const encoded = environment.SUPABASE_SECRET_KEYS?.trim();
  if (!encoded) return null;
  try {
    const values = Object.values(JSON.parse(encoded) as Record<string, unknown>);
    return values.find((value): value is string => typeof value === 'string' && value.trim().length > 20)?.trim() ?? null;
  } catch {
    return null;
  }
}

export async function loadPersonalAiConfiguration(
  admin: AdminClient,
  userId: string,
): Promise<PersonalAiConfiguration | null> {
  const { data, error } = await admin.rpc('get_user_ai_configuration', { p_user_id: userId });
  if (error) throw new Error('AI_CREDENTIAL_LOOKUP_FAILED');
  const row = Array.isArray(data) ? data[0] : data;
  if (!isRecord(row)) return null;
  const apiKey = typeof row.api_key === 'string' ? row.api_key.trim() : '';
  const model = typeof row.model === 'string' ? row.model.trim() : '';
  if (row.provider !== 'gemini' || !apiKey || !validModel.test(model)) return null;
  return { provider: 'gemini', apiKey, model };
}

export async function verifyGeminiApiKey(
  apiKey: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<void> {
  const clean = apiKey.trim();
  if (clean.length < 20 || clean.length > 512 || /\s/.test(clean)) {
    throw new Error('AI_KEY_INVALID');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs ?? 8_000));
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `https://generativelanguage.googleapis.com/v1beta/models/${PERSONAL_GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clean },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with OK only.' }] }],
          generationConfig: {
            maxOutputTokens: 8,
            thinkingConfig: { thinkingLevel: 'minimal' },
          },
        }),
      },
    );
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('AI_KEY_INVALID');
      if (response.status === 404) throw new Error('AI_MODEL_UNAVAILABLE');
      if (response.status === 429) throw new Error('AI_KEY_QUOTA_EXCEEDED');
      throw new Error('AI_KEY_VERIFICATION_FAILED');
    }
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'AI_KEY_INVALID') throw cause;
    if (cause instanceof Error && cause.message === 'AI_MODEL_UNAVAILABLE') throw cause;
    if (cause instanceof Error && cause.message === 'AI_KEY_QUOTA_EXCEEDED') throw cause;
    if (cause instanceof Error && cause.name === 'AbortError') throw new Error('AI_KEY_VERIFICATION_TIMEOUT');
    if (cause instanceof Error && cause.message === 'AI_KEY_VERIFICATION_FAILED') throw cause;
    throw new Error('AI_KEY_VERIFICATION_FAILED');
  } finally {
    clearTimeout(timeout);
  }
}

const validModel = /^[A-Za-z0-9._-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
