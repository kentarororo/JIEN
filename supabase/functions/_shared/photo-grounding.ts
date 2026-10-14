import type { NormalizedPhotoItem } from './photo-contract.ts';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type PhotoReview = {
  basis: 'estimated' | 'label' | 'usda';
  notes: string[];
  referenceId: string | null;
  referenceDescription: string | null;
};
export type ReviewedPhotoItem = NormalizedPhotoItem & { photoReview: PhotoReview };

// Deliberately abstain on near matches: wrong preparation can be worse than an estimate.
// Bounded lookups; no additional LLM calls, retries, photos or user descriptions sent to USDA.
export async function groundPhotoItems(
  items: NormalizedPhotoItem[],
  options: { apiKey?: string; fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<ReviewedPhotoItem[]> {
  const apiKey = options.apiKey?.trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  const requests = new Map<string, Promise<Reference | null>>();
  return Promise.all(items.map(async (item) => {
    const query = item.databaseQuery;
    let reference: Reference | null = null;
    if (apiKey && item.nutritionBasis === 'estimate' && item.unit === 'g'
      && query && /^[a-zA-Z ,()'/-]{3,160}$/.test(query)) {
      const key = normalizeDescription(query);
      if (!requests.has(key) && requests.size < 6) {
        requests.set(key, lookup(query, apiKey, fetchImpl, options.timeoutMs ?? 4_000));
      }
      reference = await (requests.get(key) ?? Promise.resolve(null));
    }
    const result = reference ? {
      ...item,
      caloriesKcal: scaled(reference.caloriesKcal, item.quantity),
      proteinG: scaled(reference.proteinG, item.quantity),
      carbohydrateG: scaled(reference.carbohydrateG, item.quantity),
      fatG: scaled(reference.fatG, item.quantity),
      fibreG: reference.fibreG == null ? null : scaled(reference.fibreG, item.quantity),
    } : item;
    const notes = [item.nutritionBasis === 'label'
      ? 'Check the label serving and the amount you ate.'
      : reference
        ? 'USDA nutrition matched by description. Food identity and portion still need review.'
        : 'Nutrition and portion are estimates. Check ingredients, serving size and added fats.'];
    if (item.assumptions) notes.push(item.assumptions);
    const macroEnergy = result.proteinG * 4 + result.carbohydrateG * 4 + result.fatG * 9;
    if (Math.abs(result.caloriesKcal - macroEnergy) > Math.max(80, macroEnergy * 0.4)) {
      notes.push('Calories and macros differ substantially. Check the values; fibre, alcohol and label rounding can affect the comparison.');
    }
    if (result.unit === 'g' && result.proteinG + result.carbohydrateG + result.fatG > result.quantity * 1.1 + 2) {
      notes.push('Macro grams exceed the serving weight. Check the serving and nutrition before saving.');
    }
    return { ...result, photoReview: {
      basis: item.nutritionBasis === 'label' ? 'label' : reference ? 'usda' : 'estimated',
      notes,
      referenceId: reference?.id ?? null,
      referenceDescription: reference?.description ?? null,
    } };
  }));
}

type Reference = {
  id: string; description: string; caloriesKcal: number; proteinG: number;
  carbohydrateG: number; fatG: number; fibreG: number | null;
};

async function lookup(query: string, apiKey: string, fetchImpl: FetchLike, timeoutMs: number): Promise<Reference | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(timeoutMs, 4_000)));
  try {
    const response = await fetchImpl(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, pageSize: 12, dataType: ['Foundation', 'SR Legacy'] }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data?.foods)) return null;
    const matches = data.foods.filter((food: Record<string, unknown>) =>
      food && typeof food.description === 'string'
      && normalizeDescription(food.description) === normalizeDescription(query)
      && ['Foundation', 'SR Legacy'].includes(String(food.dataType)));
    // No guessing from search rank, brands, partial matches, or ambiguous duplicates.
    if (matches.length !== 1) return null;
    const food = matches[0];
    if (!Number.isSafeInteger(food.fdcId) || food.fdcId <= 0 || food.description.length > 200) return null;
    const caloriesKcal = nutrient(food, 1008, 'KCAL') ?? nutrient(food, 2048, 'KCAL') ?? nutrient(food, 2047, 'KCAL');
    const proteinG = nutrient(food, 1003, 'G');
    const carbohydrateG = nutrient(food, 1005, 'G');
    const fatG = nutrient(food, 1004, 'G');
    const fibreG = nutrient(food, 1079, 'G');
    if (caloriesKcal == null || proteinG == null || carbohydrateG == null || fatG == null
      || caloriesKcal > 1_000 || proteinG + carbohydrateG + fatG > 110) return null;
    return { id: String(food.fdcId), description: food.description, caloriesKcal, proteinG, carbohydrateG, fatG, fibreG };
  } catch {
    return null; // Do not discard the photo result or leak the USDA key on failure.
  } finally {
    clearTimeout(timer);
  }
}

function nutrient(food: { foodNutrients?: unknown }, id: number, unit: string): number | null {
  if (!Array.isArray(food.foodNutrients)) return null;
  const entry = food.foodNutrients.find((value) => value?.nutrientId === id && String(value.unitName).toUpperCase() === unit);
  return typeof entry?.value === 'number' && Number.isFinite(entry.value) && entry.value >= 0 ? entry.value : null;
}
function normalizeDescription(value: string): string {
  return value.toLowerCase().replace(/[,()/-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function scaled(per100g: number, grams: number): number {
  return Math.round(per100g * grams / 100 * 10) / 10;
}
