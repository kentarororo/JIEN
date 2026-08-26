export type NormalizedFatSecretFood = {
  id: string;
  name: string;
  brand: string | null;
  servingQuantity: number;
  servingUnit: string;
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fibreG: number | null;
  source: 'fatsecret';
  sourceRef: string;
  barcode: null;
  confidence: null;
};

export type FatSecretConfiguration = {
  clientId: string;
  clientSecret: string;
  region: string | null;
  language: string | null;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type TokenCache = {
  key: string;
  accessToken: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

export class FatSecretProviderError extends Error {
  code: string;
  retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'FatSecretProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function resolveFatSecretConfiguration(
  env: Record<string, string | undefined>,
): FatSecretConfiguration | null {
  // JIEN permanently stores editable meal nutrition snapshots. Standard FatSecret
  // access does not grant that right, so credentials alone must never enable it.
  if (env.FATSECRET_OFFLINE_SNAPSHOT_LICENSED?.trim().toLowerCase() !== 'true') return null;

  const clientId = env.FATSECRET_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.FATSECRET_CLIENT_SECRET?.trim() ?? '';
  if (!clientId || !clientSecret) {
    throw new FatSecretProviderError(
      'FATSECRET_NOT_CONFIGURED',
      'Licensed FatSecret food search is not fully configured.',
      false,
    );
  }
  const region = cleanLocalePart(env.FATSECRET_REGION, /^[A-Za-z]{2}$/);
  const language = cleanLocalePart(env.FATSECRET_LANGUAGE, /^[A-Za-z]{2}$/);
  return { clientId, clientSecret, region, language };
}

export async function searchFatSecretFoods(
  query: string,
  configuration: FatSecretConfiguration,
  fetchImpl: FetchLike = fetch,
): Promise<NormalizedFatSecretFood[]> {
  const clean = query.trim();
  if (clean.length < 2 || clean.length > 120) {
    throw new FatSecretProviderError('INVALID_QUERY', 'Enter 2–120 characters.', false);
  }

  const token = await getAccessToken(configuration, fetchImpl);
  const url = new URL('https://platform.fatsecret.com/rest/foods/search/v5');
  url.searchParams.set('search_expression', clean);
  url.searchParams.set('page_number', '0');
  url.searchParams.set('max_results', '12');
  url.searchParams.set('flag_default_serving', 'true');
  url.searchParams.set('format', 'json');
  if (configuration.region) url.searchParams.set('region', configuration.region);
  if (configuration.region && configuration.language) {
    url.searchParams.set('language', configuration.language);
  }

  const response = await fetchWithTimeout(fetchImpl, url, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  }, 8_000, 'FATSECRET_TIMEOUT');
  if (!response.ok) {
    throw new FatSecretProviderError(
      'FATSECRET_UNAVAILABLE',
      'FatSecret food search did not respond.',
      response.status >= 500 || response.status === 429,
    );
  }
  const payload = await response.json().catch(() => null);
  return mapFatSecretSearchResponse(payload).slice(0, 12);
}

export function mapFatSecretSearchResponse(payload: unknown): NormalizedFatSecretFood[] {
  const root = asRecord(payload);
  const search = asRecord(root?.foods_search);
  const results = asRecord(search?.results);
  return asArray(results?.food)
    .map(mapFatSecretFood)
    .filter((item): item is NormalizedFatSecretFood => item != null);
}

export function resetFatSecretTokenCacheForTests(): void {
  tokenCache = null;
}

async function getAccessToken(
  configuration: FatSecretConfiguration,
  fetchImpl: FetchLike,
): Promise<string> {
  const key = `${configuration.clientId}:${configuration.clientSecret}`;
  if (tokenCache?.key === key && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const body = new URLSearchParams({ grant_type: 'client_credentials', scope: 'premier' });
  const response = await fetchWithTimeout(fetchImpl, 'https://oauth.fatsecret.com/connect/token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${btoa(key)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  }, 6_000, 'FATSECRET_AUTH_TIMEOUT');
  if (!response.ok) {
    throw new FatSecretProviderError(
      'FATSECRET_AUTH_FAILED',
      'FatSecret authentication failed.',
      response.status >= 500 || response.status === 429,
    );
  }
  const payload = asRecord(await response.json().catch(() => null));
  const accessToken = cleanString(payload?.access_token, 4096);
  const expiresIn = finiteNumber(payload?.expires_in);
  if (!accessToken || expiresIn == null || expiresIn <= 0) {
    throw new FatSecretProviderError('FATSECRET_AUTH_FAILED', 'FatSecret authentication failed.', true);
  }
  tokenCache = {
    key,
    accessToken,
    expiresAt: Date.now() + Math.min(expiresIn, 86_400) * 1_000,
  };
  return accessToken;
}

function mapFatSecretFood(value: unknown): NormalizedFatSecretFood | null {
  const food = asRecord(value);
  const foodId = cleanIdentifier(food?.food_id);
  const name = cleanString(food?.food_name, 160);
  const servingValues = asArray(asRecord(food?.servings)?.serving);
  const servings = servingValues.map(asRecord).filter((serving): serving is Record<string, unknown> => serving != null);
  const serving = servings.find((entry) => finiteNumber(entry.is_default) === 1)
    ?? servings.find(isHundredGramServing)
    ?? servings[0];
  if (!foodId || !name || !serving) return null;

  const servingId = cleanIdentifier(serving.serving_id);
  const quantity = finiteNumber(serving.metric_serving_amount) ?? finiteNumber(serving.number_of_units);
  const unit = cleanString(serving.metric_serving_unit, 24)
    ?? cleanString(serving.measurement_description, 48);
  const calories = nonNegativeNumber(serving.calories);
  const protein = nonNegativeNumber(serving.protein);
  const carbohydrate = nonNegativeNumber(serving.carbohydrate);
  const fat = nonNegativeNumber(serving.fat);
  if (!servingId || quantity == null || quantity <= 0 || !unit
    || calories == null || protein == null || carbohydrate == null || fat == null) return null;

  return {
    id: `fatsecret-${foodId}-${servingId}`,
    name,
    brand: cleanString(food?.brand_name, 120),
    servingQuantity: quantity,
    servingUnit: unit,
    caloriesKcal: calories,
    proteinG: protein,
    carbohydrateG: carbohydrate,
    fatG: fat,
    fibreG: nonNegativeNumber(serving.fiber),
    source: 'fatsecret',
    sourceRef: `${foodId}:${servingId}`,
    barcode: null,
    confidence: null,
  };
}

function isHundredGramServing(serving: Record<string, unknown>): boolean {
  return finiteNumber(serving.metric_serving_amount) === 100
    && cleanString(serving.metric_serving_unit, 24)?.toLowerCase() === 'g';
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutCode: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new FatSecretProviderError(timeoutCode, 'FatSecret took too long to respond.', true);
    }
    throw new FatSecretProviderError('FATSECRET_UNAVAILABLE', 'FatSecret food search is unavailable.', true);
  } finally {
    clearTimeout(timeout);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number != null && number >= 0 ? number : null;
}

function cleanIdentifier(value: unknown): string | null {
  const clean = cleanString(value, 64);
  return clean && /^[0-9]+$/.test(clean) ? clean : null;
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const clean = String(value).trim();
  return clean ? clean.slice(0, maxLength) : null;
}

function cleanLocalePart(value: string | undefined, pattern: RegExp): string | null {
  const clean = value?.trim() ?? '';
  return pattern.test(clean) ? clean : null;
}
