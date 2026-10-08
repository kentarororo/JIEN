import type { FoodCatalogItem } from './types.ts';

/** Treat community entries as unverified data; reject malformed server results. */
export function parseCommunityFoods(value: unknown): FoodCatalogItem[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('Community food results are invalid.');
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('Community food results are invalid.');
    const row = raw as Record<string, unknown>;
    const text = (key: string, max: number): string => {
      const result = row[key];
      if (typeof result !== 'string' || !result.trim() || result.length > max) throw new Error('Community food details are invalid.');
      return result.trim();
    };
    const number = (key: string): number => {
      const result = row[key];
      if (typeof result !== 'number' || !Number.isFinite(result) || result < 0 || result > 1_000_000) throw new Error('Community nutrition values are invalid.');
      return result;
    };
    const id = text('id', 36);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Community food identity is invalid.');
    const barcode = row.barcode == null ? null : text('barcode', 14);
    if (barcode && !/^\d{8,14}$/.test(barcode)) throw new Error('Community barcode is invalid.');
    const servingQuantity = number('serving_quantity');
    if (servingQuantity <= 0) throw new Error('Community serving size is invalid.');
    return {
      id: `community-${id}`, source: 'community', sourceRef: id,
      name: text('name', 160), brand: row.brand == null ? null : text('brand', 160), barcode,
      servingQuantity, servingUnit: text('serving_unit', 48),
      caloriesKcal: number('calories_kcal'), proteinG: number('protein_g'),
      carbohydrateG: number('carbohydrate_g'), fatG: number('fat_g'),
      fibreG: row.fibre_g == null ? null : number('fibre_g'), confidence: null,
    };
  });
}
