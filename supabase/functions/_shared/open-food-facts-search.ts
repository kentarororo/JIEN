export type NormalizedOpenFoodFactsFood = {
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
  source: 'open_food_facts';
  sourceRef: string;
  barcode: string;
  confidence: null;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const SEARCH_FIELDS = [
  'code',
  'product_name',
  'generic_name',
  'brands',
  'countries_tags',
  'serving_quantity',
  'serving_quantity_unit',
  'serving_size',
  'nutriments',
];

export class OpenFoodFactsProviderError extends Error {
  code: string;
  retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'OpenFoodFactsProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}

export async function searchOpenFoodFactsFoods(
  query: string,
  fetchImpl: FetchLike = fetch,
): Promise<NormalizedOpenFoodFactsFood[]> {
  const clean = query.trim();
  if (clean.length < 2 || clean.length > 120) {
    throw new OpenFoodFactsProviderError('INVALID_QUERY', 'Enter 2–120 characters.', false);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl('https://search.openfoodfacts.org/search', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'JIEN/0.1 (https://jien-coral.vercel.app)',
      },
      body: JSON.stringify({
        q: clean,
        page: 1,
        page_size: 24,
        langs: ['en'],
        boost_phrase: true,
        index_id: 'off',
        fields: SEARCH_FIELDS,
      }),
    });
    if (!response.ok) {
      throw new OpenFoodFactsProviderError(
        'OPEN_FOOD_FACTS_UNAVAILABLE',
        'Open Food Facts search did not respond.',
        response.status >= 500 || response.status === 429,
      );
    }
    return mapOpenFoodFactsSearchResponse(await response.json().catch(() => null)).slice(0, 20);
  } catch (cause) {
    if (cause instanceof OpenFoodFactsProviderError) throw cause;
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new OpenFoodFactsProviderError(
        'OPEN_FOOD_FACTS_TIMEOUT',
        'Open Food Facts search took too long to respond.',
        true,
      );
    }
    throw new OpenFoodFactsProviderError(
      'OPEN_FOOD_FACTS_UNAVAILABLE',
      'Open Food Facts search is unavailable.',
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function mapOpenFoodFactsSearchResponse(payload: unknown): NormalizedOpenFoodFactsFood[] {
  const hits = asArray(asRecord(payload)?.hits)
    .map(asRecord)
    .filter((hit): hit is Record<string, unknown> => hit != null);
  return rankForSingapore(hits)
    .map(mapFood)
    .filter((item): item is NormalizedOpenFoodFactsFood => item != null);
}

function rankForSingapore(hits: Record<string, unknown>[]): Record<string, unknown>[] {
  return hits
    .map((hit, index) => ({ hit, index, singapore: hasSingaporeTag(hit.countries_tags) }))
    .sort((left, right) => Number(right.singapore) - Number(left.singapore) || left.index - right.index)
    .map(({ hit }) => hit);
}

function hasSingaporeTag(value: unknown): boolean {
  return asArray(value).some((tag) => {
    const normalized = typeof tag === 'string'
      ? tag.trim().toLocaleLowerCase().replace(/^en:/, '')
      : '';
    return normalized === 'singapore';
  });
}

function mapFood(product: Record<string, unknown>): NormalizedOpenFoodFactsFood | null {
  const code = cleanString(product.code, 32);
  const name = cleanString(product.product_name, 160) ?? cleanString(product.generic_name, 160);
  const nutriments = asRecord(product.nutriments) ?? {};
  if (!code || !name) return null;

  const servingQuantity = positiveNumber(product.serving_quantity);
  const servingUnit = cleanString(product.serving_quantity_unit, 48)
    ?? parseServingUnit(cleanString(product.serving_size, 80));
  const hasServingNutrition = [
    'energy-kcal_serving',
    'energy-kj_serving',
    'proteins_serving',
    'carbohydrates_serving',
    'fat_serving',
  ].some((key) => finiteNumber(nutriments[key]) != null);
  const suffix = servingQuantity && hasServingNutrition ? '_serving' : '_100g';
  const calories = nutrientCalories(nutriments, suffix);
  const protein = finiteNumber(nutriments[`proteins${suffix}`]);
  const carbohydrate = finiteNumber(nutriments[`carbohydrates${suffix}`]);
  const fat = finiteNumber(nutriments[`fat${suffix}`]);
  const fibre = finiteNumber(nutriments[`fiber${suffix}`] ?? nutriments[`fibre${suffix}`]);
  if ([calories, protein, carbohydrate, fat, fibre].every((value) => value == null)) return null;

  const brands = asArray(product.brands)
    .map((brand) => cleanString(brand, 120))
    .filter((brand): brand is string => brand != null)
    .join(', ');
  return {
    id: `off-${code}`,
    name,
    brand: brands || cleanString(product.brands, 120),
    servingQuantity: suffix === '_serving' ? servingQuantity! : 100,
    servingUnit: suffix === '_serving' ? servingUnit ?? 'serving' : 'g',
    caloriesKcal: calories ?? 0,
    proteinG: protein ?? 0,
    carbohydrateG: carbohydrate ?? 0,
    fatG: fat ?? 0,
    fibreG: fibre,
    source: 'open_food_facts',
    sourceRef: code,
    barcode: code,
    confidence: null,
  };
}

function nutrientCalories(nutriments: Record<string, unknown>, suffix: string): number | null {
  const kcal = finiteNumber(nutriments[`energy-kcal${suffix}`]);
  if (kcal != null) return kcal;
  const kj = finiteNumber(nutriments[`energy-kj${suffix}`]);
  return kj == null ? null : kj / 4.184;
}

function parseServingUnit(value: string | null): string | null {
  const match = value?.match(/[a-zA-Z]+(?:\s+[a-zA-Z]+)?$/);
  return match?.[0]?.toLocaleLowerCase() ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const clean = String(value).trim();
  return clean ? clean.slice(0, maxLength) : null;
}
