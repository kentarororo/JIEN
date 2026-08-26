import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { withExclusiveTransaction } from './exclusive-transaction.ts';
import type { FoodCatalogItem } from './types.ts';

export type SavePrivateFoodInput = {
  id?: string | null;
  name: string;
  servingQuantity: number;
  servingUnit: string;
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fibreG?: number | null;
};

export async function savePrivateFood(
  db: SQLiteDatabase,
  input: SavePrivateFoodInput,
): Promise<FoodCatalogItem> {
  const existingId = input.id?.startsWith('custom-') ? input.id : null;
  const item: FoodCatalogItem = {
    id: existingId ?? `custom-${Crypto.randomUUID()}`,
    name: requiredPrivateFoodText(input.name, 'food name', 160),
    brand: null,
    servingQuantity: privateFoodNumber(input.servingQuantity, 'serving quantity', true),
    servingUnit: requiredPrivateFoodText(input.servingUnit, 'serving unit', 48),
    caloriesKcal: privateFoodNumber(input.caloriesKcal, 'calories'),
    proteinG: privateFoodNumber(input.proteinG, 'protein'),
    carbohydrateG: privateFoodNumber(input.carbohydrateG, 'carbohydrate'),
    fatG: privateFoodNumber(input.fatG, 'fat'),
    fibreG: input.fibreG == null ? null : privateFoodNumber(input.fibreG, 'fibre'),
    source: 'custom',
    sourceRef: null,
    barcode: null,
    confidence: null,
  };
  const now = new Date().toISOString();
  await withExclusiveTransaction(db, async (transactionDb) => {
    await transactionDb.runAsync(
      `INSERT INTO food_catalog_cache (
        id, name, brand, serving_quantity, serving_unit, calories_kcal,
        protein_g, carbohydrate_g, fat_g, fibre_g, source, source_ref,
        barcode, updated_at, last_used_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'custom', NULL, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        brand = NULL,
        serving_quantity = excluded.serving_quantity,
        serving_unit = excluded.serving_unit,
        calories_kcal = excluded.calories_kcal,
        protein_g = excluded.protein_g,
        carbohydrate_g = excluded.carbohydrate_g,
        fat_g = excluded.fat_g,
        fibre_g = excluded.fibre_g,
        source = 'custom',
        source_ref = NULL,
        barcode = NULL,
        updated_at = excluded.updated_at,
        last_used_at = excluded.last_used_at`,
      [
        item.id, item.name, item.servingQuantity, item.servingUnit,
        item.caloriesKcal, item.proteinG, item.carbohydrateG, item.fatG,
        item.fibreG, now, now,
      ],
    );
  });
  return item;
}

function requiredPrivateFoodText(value: string, field: string, maximumLength: number): string {
  const clean = value.trim();
  if (!clean) throw new Error(`Enter a ${field} before saving this private food.`);
  if (clean.length > maximumLength) throw new Error(`The ${field} is too long.`);
  return clean;
}

function privateFoodNumber(value: number, field: string, positive = false): number {
  if (!Number.isFinite(value) || value < 0 || (positive && value <= 0) || value > 1_000_000) {
    throw new Error(`Enter a valid ${positive ? 'positive ' : ''}${field} before saving this private food.`);
  }
  return value;
}
