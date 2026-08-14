import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  type MealPhotoCapability,
  classifyMealPhotoAnalysisError,
  parseMealPhotoAnalysisData,
  parseMealPhotoCapabilityData,
} from './meal-photo-api';
import {
  mapOpenFoodFactsProduct,
  OPEN_FOOD_FACTS_FIELDS,
  type OpenFoodFactsProductResponse,
  type OpenFoodFactsSearchResponse,
} from './open-food-facts';
import type { FoodCatalogItem } from './types';
import {
  getSupabaseClient,
  invokeEdgeFunctionEnvelope,
} from './supabase';

type FoodCatalogRow = {
  id: string;
  name: string;
  brand: string | null;
  serving_quantity: number;
  serving_unit: string;
  calories_kcal: number;
  protein_g: number;
  carbohydrate_g: number;
  fat_g: number;
  fibre_g: number | null;
  source: FoodCatalogItem['source'];
  source_ref: string | null;
  barcode: string | null;
};

function mapFood(row: FoodCatalogRow): FoodCatalogItem {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    servingQuantity: row.serving_quantity,
    servingUnit: row.serving_unit,
    caloriesKcal: row.calories_kcal,
    proteinG: row.protein_g,
    carbohydrateG: row.carbohydrate_g,
    fatG: row.fat_g,
    fibreG: row.fibre_g,
    source: row.source,
    sourceRef: row.source_ref,
    barcode: row.barcode,
    confidence: null,
  };
}

export async function searchLocalFoodCatalog(
  db: SQLiteDatabase,
  query: string,
  limit = 8,
): Promise<FoodCatalogItem[]> {
  const clean = query.trim();
  if (clean.length === 0) {
    const commonRows = await db.getAllAsync<FoodCatalogRow>(
      `SELECT id, name, brand, serving_quantity, serving_unit, calories_kcal,
        protein_g, carbohydrate_g, fat_g, fibre_g, source, source_ref, barcode
       FROM food_catalog_cache
       ORDER BY CASE WHEN last_used_at IS NULL THEN 1 ELSE 0 END, last_used_at DESC, name
       LIMIT ?`,
      [limit],
    );
    return commonRows.map(mapFood);
  }
  if (clean.length < 2) return [];
  const rows = await db.getAllAsync<FoodCatalogRow>(
    `SELECT id, name, brand, serving_quantity, serving_unit, calories_kcal,
      protein_g, carbohydrate_g, fat_g, fibre_g, source, source_ref, barcode
     FROM food_catalog_cache
     WHERE name LIKE ? COLLATE NOCASE OR brand LIKE ? COLLATE NOCASE
     ORDER BY CASE WHEN name LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END,
       CASE WHEN last_used_at IS NULL THEN 1 ELSE 0 END, last_used_at DESC, name
     LIMIT ?`,
    [`%${clean}%`, `%${clean}%`, `${clean}%`, limit],
  );
  return rows.map(mapFood);
}

export async function cacheFoodCatalogItems(db: SQLiteDatabase, items: FoodCatalogItem[]): Promise<void> {
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const item of items) {
      await db.runAsync(
        `INSERT INTO food_catalog_cache (
          id, name, brand, serving_quantity, serving_unit, calories_kcal,
          protein_g, carbohydrate_g, fat_g, fibre_g, source, source_ref,
          barcode, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          brand = excluded.brand,
          serving_quantity = excluded.serving_quantity,
          serving_unit = excluded.serving_unit,
          calories_kcal = excluded.calories_kcal,
          protein_g = excluded.protein_g,
          carbohydrate_g = excluded.carbohydrate_g,
          fat_g = excluded.fat_g,
          fibre_g = excluded.fibre_g,
          source = excluded.source,
          source_ref = excluded.source_ref,
          barcode = excluded.barcode,
          updated_at = excluded.updated_at`,
        [
          item.id || Crypto.randomUUID(), item.name, item.brand, item.servingQuantity,
          item.servingUnit, item.caloriesKcal, item.proteinG, item.carbohydrateG,
          item.fatG, item.fibreG, item.source, item.sourceRef, item.barcode, now,
        ],
      );
    }
  });
}

export async function markFoodCatalogItemUsed(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('UPDATE food_catalog_cache SET last_used_at = ? WHERE id = ?', [new Date().toISOString(), id]);
}

export async function searchFoodDatabase(query: string): Promise<FoodCatalogItem[]> {
  const clean = query.trim();
  if (clean.length < 2) return [];
  const params = new URLSearchParams({
    search_terms: clean,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '12',
    sort_by: 'unique_scans_n',
    fields: OPEN_FOOD_FACTS_FIELDS,
  });
  const [openFoodFacts, usda] = await Promise.allSettled([
    fetchOpenFoodFacts<OpenFoodFactsSearchResponse>(
      `https://world.openfoodfacts.org/cgi/search.pl?${params.toString()}`,
    ).then((response) => (response.products ?? [])
      .map(mapOpenFoodFactsProduct)
      .filter((item): item is FoodCatalogItem => item != null)),
    invokeOptionalFoodFunction('food-search', { query: clean }),
  ]);
  const items = dedupeFoods([
    ...(usda.status === 'fulfilled' ? usda.value : []),
    ...(openFoodFacts.status === 'fulfilled' ? openFoodFacts.value : []),
  ]).slice(0, 20);
  if (!items.length && openFoodFacts.status === 'rejected') {
    throw openFoodFacts.reason instanceof Error
      ? openFoodFacts.reason
      : new Error('The online food database is unavailable.');
  }
  return items;
}

export async function lookupFoodBarcode(barcode: string): Promise<FoodCatalogItem[]> {
  const clean = barcode.replace(/\D/g, '');
  if (clean.length < 8 || clean.length > 14) throw new Error('Scan or enter a valid 8-14 digit barcode.');
  const cloudItems = await invokeOptionalFoodFunction('food-barcode', { barcode: clean });
  if (cloudItems[0]) return cloudItems;
  const response = await fetchOpenFoodFacts<OpenFoodFactsProductResponse>(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(clean)}.json?fields=${encodeURIComponent(OPEN_FOOD_FACTS_FIELDS)}`,
  );
  const item = response.product ? mapOpenFoodFactsProduct({ ...response.product, code: response.product.code ?? clean }) : null;
  return item ? [item] : [];
}

export async function analyzeMealPhoto(
  base64: string,
  description: string,
  mediaType = 'image/jpeg',
): Promise<{ items: FoodCatalogItem[]; disclaimer: string; requestId: string }> {
  const response = await invokeEdgeFunctionEnvelope<unknown>('analyze-food-photo', {
    action: 'analyze',
    imageBase64: base64,
    mediaType,
    description: description.trim().slice(0, 500),
  }, 30_000);
  const parsed = parseMealPhotoAnalysisData(response.data);
  return { ...parsed, requestId: response.requestId };
}

export async function getMealPhotoAnalysisCapability(): Promise<MealPhotoCapability> {
  try {
    const response = await invokeEdgeFunctionEnvelope<unknown>(
      'analyze-food-photo',
      { action: 'capability' },
      8_000,
    );
    parseMealPhotoCapabilityData(response.data);
    return {
      available: true,
      status: 'ready',
      message: 'Ready. The photo is sent for analysis only after you choose Analyze photo.',
      retryable: false,
    };
  } catch (cause) {
    const failure = classifyMealPhotoAnalysisError(cause);
    return { ...failure, available: false };
  }
}

async function fetchOpenFoodFacts<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Food database request failed (${response.status}).`);
    return await response.json() as T;
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new Error('The food database took too long to respond. Try again.');
    }
    throw cause instanceof Error ? cause : new Error('The online food database is unavailable.');
  } finally {
    clearTimeout(timeout);
  }
}

async function invokeFoodFunction(name: string, body: Record<string, unknown>): Promise<FoodCatalogItem[]> {
  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch {
    throw new Error('AI photo analysis is not configured yet. Food search and barcode lookup still work online.');
  }
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw new Error('Sign in to use AI meal-photo analysis. Food search and barcode lookup do not require sign-in.');
  const { data, error } = await withTimeout(
    supabase.functions.invoke(name, { body }),
    30_000,
    'The food service took too long to respond. Try again.',
  );
  if (error) throw new Error(await foodFunctionErrorMessage(error));
  const items = (data as { items?: FoodCatalogItem[] } | null)?.items;
  if (!Array.isArray(items)) throw new Error('The food service returned an invalid response.');
  return items;
}

async function invokeOptionalFoodFunction(name: string, body: Record<string, unknown>): Promise<FoodCatalogItem[]> {
  try {
    return await withTimeout(
      invokeFoodFunction(name, body),
      2_500,
      'Optional food database enrichment timed out.',
    );
  } catch {
    return [];
  }
}

function dedupeFoods(items: FoodCatalogItem[]): FoodCatalogItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.barcode ? `barcode:${item.barcode}` : `${item.source}:${item.sourceRef ?? item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function foodFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback = error instanceof Error && error.message
    ? error.message
    : 'The online food service is unavailable.';
  const context = (error as { context?: unknown } | null)?.context;
  if (!context || typeof (context as { json?: unknown }).json !== 'function') return fallback;
  try {
    const payload = await (context as { json(): Promise<unknown> }).json();
    const message = (payload as { error?: unknown } | null)?.error;
    return typeof message === 'string' && message.trim() ? message : fallback;
  } catch {
    return fallback;
  }
}

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
