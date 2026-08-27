import type { FoodCatalogItem } from './types.ts';

export const OPEN_FOOD_FACTS_FIELDS = [
  'code',
  'product_name',
  'generic_name',
  'brands',
  'countries_tags',
  'serving_quantity',
  'serving_quantity_unit',
  'serving_size',
  'nutriments',
].join(',');

export type OpenFoodFactsProduct = {
  code?: string;
  product_name?: string;
  generic_name?: string;
  brands?: string | string[];
  countries_tags?: string[];
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
  serving_size?: string;
  nutriments?: Record<string, number | string | undefined>;
};

export type OpenFoodFactsSearchResponse = { products?: OpenFoodFactsProduct[] };
export type OpenFoodFactsProductResponse = { status?: number; product?: OpenFoodFactsProduct };

export function rankOpenFoodFactsProductsForSingapore(
  products: OpenFoodFactsProduct[],
): OpenFoodFactsProduct[] {
  return products
    .map((product, index) => ({ product, index, singapore: isSingaporeProduct(product) }))
    .sort((left, right) => Number(right.singapore) - Number(left.singapore) || left.index - right.index)
    .map(({ product }) => product);
}

function isSingaporeProduct(product: OpenFoodFactsProduct): boolean {
  return product.countries_tags?.some((tag) => {
    const normalized = tag.trim().toLocaleLowerCase().replace(/^en:/, '');
    return normalized === 'singapore';
  }) ?? false;
}

export function mapOpenFoodFactsProduct(product: OpenFoodFactsProduct): FoodCatalogItem | null {
  const name = (product.product_name || product.generic_name || '').trim();
  const code = product.code?.trim();
  const nutriments = product.nutriments ?? {};
  if (!name || !code) return null;

  const servingQuantity = positiveNumber(product.serving_quantity);
  const servingUnit = product.serving_quantity_unit?.trim() || parseServingUnit(product.serving_size);
  const hasServingNutrition = [
    'energy-kcal_serving',
    'energy-kj_serving',
    'proteins_serving',
    'carbohydrates_serving',
    'fat_serving',
  ].some((key) => finiteNumber(nutriments[key]) != null);
  const suffix = servingQuantity && hasServingNutrition ? '_serving' : '_100g';
  const quantity = suffix === '_serving' ? servingQuantity! : 100;
  const unit = suffix === '_serving' ? servingUnit || 'serving' : 'g';
  const calories = nutrientCalories(nutriments, suffix);
  const protein = finiteNumber(nutriments[`proteins${suffix}`]);
  const carbs = finiteNumber(nutriments[`carbohydrates${suffix}`]);
  const fat = finiteNumber(nutriments[`fat${suffix}`]);
  const fibre = finiteNumber(nutriments[`fiber${suffix}`] ?? nutriments[`fibre${suffix}`]);

  if ([calories, protein, carbs, fat, fibre].every((value) => value == null)) return null;

  return {
    id: `off-${code}`,
    name,
    brand: Array.isArray(product.brands)
      ? product.brands.map((brand) => brand.trim()).filter(Boolean).join(', ') || null
      : product.brands?.trim() || null,
    servingQuantity: quantity,
    servingUnit: unit,
    caloriesKcal: calories ?? 0,
    proteinG: protein ?? 0,
    carbohydrateG: carbs ?? 0,
    fatG: fat ?? 0,
    fibreG: fibre,
    source: 'open_food_facts',
    sourceRef: code,
    barcode: code,
    confidence: null,
  };
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function nutrientCalories(nutriments: Record<string, number | string | undefined>, suffix: string): number | null {
  const kcal = finiteNumber(nutriments[`energy-kcal${suffix}`]);
  if (kcal != null) return kcal;
  const kj = finiteNumber(nutriments[`energy-kj${suffix}`]);
  return kj == null ? null : kj / 4.184;
}

function parseServingUnit(value: string | undefined): string {
  if (!value) return '';
  const match = value.trim().match(/[a-zA-Z]+(?:\s+[a-zA-Z]+)?$/);
  return match?.[0]?.toLocaleLowerCase() ?? '';
}
