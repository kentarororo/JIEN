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
  rankOpenFoodFactsProductsForSingapore,
  type OpenFoodFactsProductResponse,
  type OpenFoodFactsSearchResponse,
} from './open-food-facts';
import { foodItemsEligibleForDiscoveryCache, parseFoodSearchData } from './food-search-contract';
import { parseCommunityFoods } from './community-food-contract';
import type { FoodCatalogItem } from './types';
import { normalizeFoodSearch, rankFoodCandidates } from '../nutrition/food-ranking';
import { withExclusiveTransaction } from './exclusive-transaction';
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
  is_shared?: number;
  last_used_at?: string | null;
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
    isShared: Boolean(row.is_shared),
    lastUsedAt: row.last_used_at ?? null,
  };
}

// Private foods are durable account records. Provider results remain a device cache.
const LOCAL_CATALOG = `(SELECT id, name, brand, serving_quantity, serving_unit, calories_kcal,
  protein_g, carbohydrate_g, fat_g, fibre_g, source, source_ref, barcode, last_used_at, 0 AS is_shared
  FROM food_catalog_cache WHERE source <> 'custom'
  UNION ALL SELECT catalog_id AS id, name, brand, serving_quantity, serving_unit, calories_kcal,
  protein_g, carbohydrate_g, fat_g, fibre_g, 'custom' AS source, NULL AS source_ref, barcode, last_used_at, is_shared
  FROM private_foods WHERE deleted_at IS NULL)`;

export async function searchLocalFoodCatalog(
  db: SQLiteDatabase,
  query: string,
  limit = 8,
  options: { at?: Date } = {},
): Promise<FoodCatalogItem[]> {
  const clean = query.trim();
  if (clean.length === 1) return [];
  const at = options.at ?? new Date();
  const [catalogRows, historyRows] = await Promise.all([
    db.getAllAsync<FoodCatalogRow>(
      `SELECT id, name, brand, serving_quantity, serving_unit, calories_kcal,
        protein_g, carbohydrate_g, fat_g, fibre_g, source, source_ref, barcode,
        is_shared, last_used_at
       FROM ${LOCAL_CATALOG}
       LIMIT 500`,
    ),
    db.getAllAsync<FoodCatalogRow & { eaten_at: string }>(
      `SELECT 'history:' || f.id AS id, f.name, NULL AS brand,
        f.quantity AS serving_quantity, f.unit AS serving_unit,
        f.calories_kcal, f.protein_g, f.carbohydrate_g, f.fat_g, f.fibre_g,
        'custom' AS source, NULL AS source_ref, NULL AS barcode, 0 AS is_shared,
        m.eaten_at AS last_used_at, m.eaten_at
       FROM food_items f
       JOIN meals m ON m.id = f.meal_id
       WHERE f.deleted_at IS NULL AND m.deleted_at IS NULL
       ORDER BY m.eaten_at DESC, f.id DESC
       LIMIT 1000`,
    ),
  ]);
  const candidates = mergeFoodUsage(catalogRows, historyRows, at);
  const barcode = clean.replace(/[\s-]/g, '');
  if (/^\d{8,14}$/.test(barcode)) {
    const exact = candidates.filter((item) => item.barcode === barcode);
    if (exact.length) return exact.slice(0, limit);
  }
  return rankFoodCandidates(candidates, clean, limit, at);
}

function mergeFoodUsage(
  catalogRows: FoodCatalogRow[],
  historyRows: Array<FoodCatalogRow & { eaten_at: string }>,
  at: Date,
): FoodCatalogItem[] {
  const candidates = new Map<string, FoodCatalogItem>();
  for (const row of catalogRows) {
    const item = mapFood(row);
    candidates.set(foodUsageKey(item.name, item.brand), item);
  }
  for (const row of historyRows) {
    const key = foodUsageKey(row.name, row.brand);
    const existing = candidates.get(key);
    const latest = existing?.isFromHistory ? existing : mapFood(row);
    const usedAt = new Date(row.eaten_at);
    const sameTimeOfDay = Number.isFinite(usedAt.getTime()) && foodTimeBand(usedAt.getHours()) === foodTimeBand(at.getHours());
    candidates.set(key, {
      ...latest,
      isFromHistory: true,
      usageCount: (existing?.usageCount ?? 0) + 1,
      timeOfDayUsageCount: (existing?.timeOfDayUsageCount ?? 0) + (sameTimeOfDay ? 1 : 0),
      lastUsedAt: existing?.lastUsedAt && existing.lastUsedAt > row.eaten_at ? existing.lastUsedAt : row.eaten_at,
    });
  }
  return [...candidates.values()];
}

function foodUsageKey(name: string, brand: string | null): string {
  return `${normalizeFoodSearch(name)}|${normalizeFoodSearch(brand ?? '')}`;
}

function foodTimeBand(hour: number): 'morning' | 'midday' | 'evening' | 'late' {
  if (hour < 10) return 'morning';
  if (hour < 15) return 'midday';
  if (hour < 21) return 'evening';
  return 'late';
}

export async function cacheFoodCatalogItems(db: SQLiteDatabase, items: FoodCatalogItem[]): Promise<void> {
  // FatSecret search payloads are not a general-purpose offline catalog. A selected
  // item is preserved by saveMeal as part of the user's meal history, but unselected
  // proprietary search results must not be bulk-cached here.
  const cacheableItems = foodItemsEligibleForDiscoveryCache(items).filter((item) => item.source !== 'custom');
  if (cacheableItems.length === 0) return;
  const now = new Date().toISOString();
  await withExclusiveTransaction(db, async (db) => {
    for (const item of cacheableItems) {
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
  if (id.startsWith('custom-')) {
    await db.runAsync('UPDATE private_foods SET last_used_at = ? WHERE catalog_id = ?', [new Date().toISOString(), id]);
    return;
  }
  await db.runAsync('UPDATE food_catalog_cache SET last_used_at = ? WHERE id = ?', [new Date().toISOString(), id]);
}

export async function lookupLocalFoodBarcode(db: SQLiteDatabase, barcode: string): Promise<FoodCatalogItem[]> {
  const clean = barcode.replace(/[\s-]/g, '');
  if (!/^\d{8,14}$/.test(clean)) throw new Error('Enter an 8–14 digit barcode.');
  const rows = await db.getAllAsync<FoodCatalogRow>(`SELECT * FROM ${LOCAL_CATALOG} WHERE barcode = ?
    ORDER BY CASE WHEN source = 'custom' THEN 0 ELSE 1 END, last_used_at DESC, name LIMIT 8`, [clean]);
  return rows.map(mapFood);
}

export async function searchFoodDatabase(query: string): Promise<FoodCatalogItem[]> {
  const clean = query.trim();
  if (clean.length < 2) return [];
  const params = new URLSearchParams({
    search_terms: clean,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '24',
    sort_by: 'unique_scans_n',
    fields: OPEN_FOOD_FACTS_FIELDS,
  });
  const [openFoodFacts, providerSearch, community] = await Promise.allSettled([
    fetchOpenFoodFacts<OpenFoodFactsSearchResponse>(
      `https://world.openfoodfacts.org/cgi/search.pl?${params.toString()}`,
    ).then((response) => rankOpenFoodFactsProductsForSingapore(response.products ?? [])
      .map(mapOpenFoodFactsProduct)
      .filter((item): item is FoodCatalogItem => item != null)),
    invokeOptionalFoodSearch(clean),
    searchCommunityFoods(clean),
  ]);
  const items = dedupeFoods([
    ...(community.status === 'fulfilled' ? community.value : []),
    ...(providerSearch.status === 'fulfilled' ? providerSearch.value : []),
    ...(openFoodFacts.status === 'fulfilled' ? openFoodFacts.value : []),
  ]).slice(0, 20);
  if (!items.length && openFoodFacts.status === 'rejected') {
    throw openFoodFacts.reason instanceof Error
      ? openFoodFacts.reason
      : new Error('The online food database is unavailable.');
  }
  return items;
}

async function invokeOptionalFoodSearch(query: string): Promise<FoodCatalogItem[]> {
  try {
    const response = await invokeEdgeFunctionEnvelope<unknown>(
      'food-search',
      { query, acceptedSources: ['open_food_facts'] },
      8_000,
    );
    return parseFoodSearchData(response.data).items;
  } catch {
    return [];
  }
}

export async function lookupFoodBarcode(barcode: string): Promise<FoodCatalogItem[]> {
  const clean = barcode.replace(/\D/g, '');
  if (clean.length < 8 || clean.length > 14) throw new Error('Scan or enter a valid 8-14 digit barcode.');
  const community = await searchCommunityFoods('', clean).catch(() => []);
  if (community.length) return community;
  const cloudItems = await invokeOptionalFoodFunction('food-barcode', { barcode: clean });
  if (cloudItems[0]) return cloudItems;
  const response = await fetchOpenFoodFacts<OpenFoodFactsProductResponse>(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(clean)}.json?fields=${encodeURIComponent(OPEN_FOOD_FACTS_FIELDS)}`,
  );
  const item = response.product ? mapOpenFoodFactsProduct({ ...response.product, code: response.product.code ?? clean }) : null;
  return item ? [item] : [];
}

/** Server returns only explicitly published nutrition fields, never contributor identity. */
export async function searchCommunityFoods(query: string, barcode: string | null = null): Promise<FoodCatalogItem[]> {
  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const { data, error } = await supabase.rpc('search_community_foods', {
      search_query: query.trim().slice(0, 160), product_barcode: barcode,
    }).abortSignal(controller.signal);
    if (error) throw error;
    return parseCommunityFoods(data);
  } finally {
    clearTimeout(timeout);
  }
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
    const capability = parseMealPhotoCapabilityData(response.data);
    const providerLabel = capability.provider === 'gemini' ? 'Gemini' : 'Anthropic';
    return {
      available: true,
      status: 'ready',
      message: `${providerLabel} is connected through the secure server. Nothing is sent until you choose Analyze photo; Google sign-in only identifies your account.`,
      retryable: false,
      requestId: response.requestId,
      provider: capability.provider,
      credentialSource: capability.credentialSource,
      usagePolicy: capability.usagePolicy,
      dailyLimit: capability.dailyLimit,
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
