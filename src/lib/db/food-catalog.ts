import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getSupabaseClient } from './supabase';
import type { FoodCatalogItem } from './types';

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
  return invokeFoodFunction('food-search', { query });
}

export async function lookupFoodBarcode(barcode: string): Promise<FoodCatalogItem[]> {
  return invokeFoodFunction('food-barcode', { barcode });
}

export async function analyzeMealPhoto(base64: string, description: string): Promise<FoodCatalogItem[]> {
  return invokeFoodFunction('analyze-food-photo', { imageBase64: base64, mediaType: 'image/jpeg', description });
}

async function invokeFoodFunction(name: string, body: Record<string, unknown>): Promise<FoodCatalogItem[]> {
  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch {
    throw new Error('Online food lookup needs Supabase configuration. Local food search still works offline.');
  }
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw new Error('Sign in to use online food search, barcode lookup, or AI photo analysis.');
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(error.message || 'The online food service is unavailable.');
  const items = (data as { items?: FoodCatalogItem[] } | null)?.items;
  if (!Array.isArray(items)) throw new Error('The food service returned an invalid response.');
  return items;
}
