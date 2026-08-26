// @ts-nocheck
import {
  FatSecretProviderError,
  resolveFatSecretConfiguration,
  searchFatSecretFoods,
} from '../_shared/fatsecret-food.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  const requestId = safeRequestId(request.headers.get('x-request-id'));
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') {
    return failure(requestId, 'METHOD_NOT_ALLOWED', 'Use POST for food search.', false, 405);
  }

  const envelope = await request.json().catch(() => null);
  if (!isRecord(envelope) || envelope.version !== 1 || !isRecord(envelope.data)) {
    return failure(requestId, 'INVALID_REQUEST', 'This food search request is not supported.', false, 400);
  }
  const clean = typeof envelope.data.query === 'string' ? envelope.data.query.trim() : '';
  if (clean.length < 2 || clean.length > 120) {
    return failure(requestId, 'INVALID_QUERY', 'Enter 2–120 characters.', false, 400);
  }

  const searches = [];
  try {
    const fatSecret = resolveFatSecretConfiguration({
      FATSECRET_CLIENT_ID: Deno.env.get('FATSECRET_CLIENT_ID'),
      FATSECRET_CLIENT_SECRET: Deno.env.get('FATSECRET_CLIENT_SECRET'),
      FATSECRET_OFFLINE_SNAPSHOT_LICENSED: Deno.env.get('FATSECRET_OFFLINE_SNAPSHOT_LICENSED'),
      FATSECRET_REGION: Deno.env.get('FATSECRET_REGION'),
      FATSECRET_LANGUAGE: Deno.env.get('FATSECRET_LANGUAGE'),
    });
    if (fatSecret) {
      searches.push({ source: 'fatsecret', promise: searchFatSecretFoods(clean, fatSecret) });
    }
  } catch (cause) {
    const error = providerError(cause);
    console.warn(JSON.stringify({ requestId, provider: 'fatsecret', code: error.code }));
    searches.push({ source: 'fatsecret', promise: Promise.reject(error) });
  }

  const usdaKey = Deno.env.get('USDA_FDC_API_KEY')?.trim();
  if (usdaKey) searches.push({ source: 'usda_fdc', promise: searchUsdaFoods(clean, usdaKey) });
  if (searches.length === 0) return success(requestId, { items: [], sources: [] });

  const settled = await Promise.allSettled(searches.map((entry) => entry.promise));
  const items = [];
  const sources = [];
  settled.forEach((result, index) => {
    const source = searches[index]?.source;
    if (result.status === 'fulfilled') {
      items.push(...result.value);
      if (source) sources.push(source);
      return;
    }
    const error = providerError(result.reason);
    console.warn(JSON.stringify({ requestId, provider: source ?? 'unknown', code: error.code }));
  });

  if (!sources.length) {
    const retryable = settled.some((result) => result.status === 'rejected' && providerError(result.reason).retryable);
    return failure(
      requestId,
      'FOOD_PROVIDERS_UNAVAILABLE',
      'The online food providers are unavailable right now.',
      retryable,
      502,
    );
  }
  return success(requestId, { items: dedupe(items).slice(0, 20), sources });
});

async function searchUsdaFoods(query, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          query,
          pageSize: 12,
          dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'],
        }),
      },
    );
    if (!response.ok) throw providerFailure('USDA_UNAVAILABLE', response.status);
    const data = await response.json();
    return (Array.isArray(data.foods) ? data.foods : []).map((food) => ({
      id: `usda-${food.fdcId}`,
      name: typeof food.description === 'string' ? food.description.trim().slice(0, 160) : '',
      brand: cleanNullableText(food.brandOwner ?? food.brandName, 120),
      servingQuantity: 100,
      servingUnit: 'g',
      caloriesKcal: nutrient(food, 1008),
      proteinG: nutrient(food, 1003),
      carbohydrateG: nutrient(food, 1005),
      fatG: nutrient(food, 1004),
      fibreG: nullableNutrient(food, 1079),
      source: 'usda_fdc',
      sourceRef: String(food.fdcId),
      barcode: cleanNullableText(food.gtinUpc, 32),
      confidence: null,
    })).filter((item) => item.name && item.sourceRef !== 'undefined' && item.caloriesKcal >= 0);
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw { code: 'USDA_TIMEOUT', retryable: true };
    }
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}

function nutrient(food, id) {
  const value = Number(food.foodNutrients?.find((entry) => entry.nutrientId === id)?.value ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
function nullableNutrient(food, id) {
  const value = food.foodNutrients?.find((entry) => entry.nutrientId === id)?.value;
  const parsed = Number(value);
  return value == null || !Number.isFinite(parsed) || parsed < 0 ? null : parsed;
}
function cleanNullableText(value, maxLength) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return clean ? clean.slice(0, maxLength) : null;
}
function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.source}:${item.sourceRef}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function providerFailure(code, status) {
  return { code, retryable: status >= 500 || status === 429 };
}
function providerError(cause) {
  if (cause instanceof FatSecretProviderError) return cause;
  if (isRecord(cause) && typeof cause.code === 'string') {
    return { code: cause.code, retryable: cause.retryable === true };
  }
  return { code: 'PROVIDER_FAILED', retryable: true };
}
function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
function safeRequestId(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{8,128}$/.test(clean) ? clean : crypto.randomUUID();
}
function success(requestId, data, status = 200) {
  return new Response(JSON.stringify({ data, requestId }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function failure(requestId, code, message, retryable, status) {
  return new Response(JSON.stringify({ error: { code, message, retryable }, requestId }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
