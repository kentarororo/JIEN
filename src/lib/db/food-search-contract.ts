import type { FoodCatalogItem } from './types.ts';

export type FoodSearchData = {
  items: FoodCatalogItem[];
  sources: Array<'fatsecret' | 'usda_fdc' | 'open_food_facts'>;
};

export function parseFoodSearchData(value: unknown): FoodSearchData {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.items) || !Array.isArray(record.sources)) {
    throw new Error('The food service returned an invalid response.');
  }
  const sources = record.sources.filter(isFoodSearchSource);
  if (sources.length !== record.sources.length) {
    throw new Error('The food service returned an invalid source.');
  }
  return {
    items: record.items.map(parseFoodSearchItem),
    sources,
  };
}

export function foodItemsEligibleForDiscoveryCache(items: FoodCatalogItem[]): FoodCatalogItem[] {
  return items.filter((item) => item.source !== 'fatsecret');
}

function parseFoodSearchItem(value: unknown): FoodCatalogItem {
  const item = asRecord(value);
  const source = item?.source;
  const id = cleanText(item?.id, 240);
  const name = cleanText(item?.name, 160);
  const servingUnit = cleanText(item?.servingUnit, 48);
  const servingQuantity = nonNegativeNumber(item?.servingQuantity);
  const caloriesKcal = nonNegativeNumber(item?.caloriesKcal);
  const proteinG = nonNegativeNumber(item?.proteinG);
  const carbohydrateG = nonNegativeNumber(item?.carbohydrateG);
  const fatG = nonNegativeNumber(item?.fatG);
  if (!id || !name || !servingUnit || servingQuantity == null || servingQuantity <= 0
    || caloriesKcal == null || proteinG == null || carbohydrateG == null || fatG == null
    || !isFoodSearchSource(source)) {
    throw new Error('The food service returned an invalid food item.');
  }
  return {
    id,
    name,
    brand: nullableText(item?.brand, 120),
    servingQuantity,
    servingUnit,
    caloriesKcal,
    proteinG,
    carbohydrateG,
    fatG,
    fibreG: nullableNonNegativeNumber(item?.fibreG),
    source,
    sourceRef: nullableText(item?.sourceRef, 160),
    barcode: nullableText(item?.barcode, 32),
    confidence: null,
  };
}

function isFoodSearchSource(value: unknown): value is 'fatsecret' | 'usda_fdc' | 'open_food_facts' {
  return value === 'fatsecret' || value === 'usda_fdc' || value === 'open_food_facts';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean ? clean.slice(0, maxLength) : null;
}

function nullableText(value: unknown, maxLength: number): string | null {
  return value == null ? null : cleanText(value, maxLength);
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function nullableNonNegativeNumber(value: unknown): number | null {
  return value == null ? null : nonNegativeNumber(value);
}
