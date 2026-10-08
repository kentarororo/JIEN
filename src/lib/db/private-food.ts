import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { withExclusiveTransaction } from './exclusive-transaction.ts';
import type { FoodCatalogItem } from './types.ts';
import { enqueueUpsert } from './sync-queue.ts';

export type SavePrivateFoodInput = {
  id?: string | null;
  name: string;
  brand?: string | null;
  barcode?: string | null;
  /** Explicit publication choice. Omission preserves an existing food's visibility. */
  isShared?: boolean;
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
    brand: input.brand?.trim() ? requiredPrivateFoodText(input.brand, 'brand', 160) : null,
    servingQuantity: privateFoodNumber(input.servingQuantity, 'serving quantity', true),
    servingUnit: requiredPrivateFoodText(input.servingUnit, 'serving unit', 48),
    caloriesKcal: privateFoodNumber(input.caloriesKcal, 'calories'),
    proteinG: privateFoodNumber(input.proteinG, 'protein'),
    carbohydrateG: privateFoodNumber(input.carbohydrateG, 'carbohydrate'),
    fatG: privateFoodNumber(input.fatG, 'fat'),
    fibreG: input.fibreG == null ? null : privateFoodNumber(input.fibreG, 'fibre'),
    source: 'custom',
    sourceRef: null,
    barcode: normalizePrivateFoodBarcode(input.barcode),
    confidence: null,
  };
  await withExclusiveTransaction(db, async (transactionDb) => {
    const existing = await transactionDb.getFirstAsync<{ id: string; created_at: string; client_updated_at: string; deleted_at: string | null; is_shared: number }>(
      'SELECT id, created_at, client_updated_at, deleted_at, is_shared FROM private_foods WHERE catalog_id = ?', [item.id]);
    if (existing?.deleted_at) throw new Error('This private food was removed. Save it as a new food.');
    item.isShared = input.isShared ?? Boolean(existing?.is_shared);
    const now = new Date(Math.max(Date.now(), (Date.parse(existing?.client_updated_at ?? '') || 0) + 1)).toISOString();
    const payload = {
      id: existing?.id ?? Crypto.randomUUID(), catalog_id: item.id,
      name: item.name, brand: item.brand, barcode: item.barcode,
      serving_quantity: item.servingQuantity, serving_unit: item.servingUnit,
      calories_kcal: item.caloriesKcal, protein_g: item.proteinG,
      carbohydrate_g: item.carbohydrateG, fat_g: item.fatG, fibre_g: item.fibreG,
      created_at: existing?.created_at ?? now, updated_at: now, client_updated_at: now, deleted_at: null,
      is_shared: item.isShared,
    };
    const columns = Object.keys(payload);
    await transactionDb.runAsync(`INSERT INTO private_foods (${columns.join(',')}, last_used_at)
      VALUES (${columns.map(() => '?').join(',')}, ?)
      ON CONFLICT(id) DO UPDATE SET ${columns.filter((column) => column !== 'id').map((column) => `${column} = excluded.${column}`).join(',')}, last_used_at = excluded.last_used_at`,
      [...Object.values(payload).map((value) => typeof value === 'boolean' ? Number(value) : value), now]);
    await enqueueUpsert(transactionDb, 'private_foods', payload.id, payload);
  });
  return item;
}

export function normalizePrivateFoodBarcode(value?: string | null): string | null {
  if (!value?.trim()) return null;
  const clean = value.replace(/[\s-]/g, '');
  if (!/^\d{8,14}$/.test(clean)) throw new Error('Enter an 8–14 digit barcode, or leave it blank.');
  return clean;
}

/** Withdrawal changes visibility only, never an unsaved meal portion or edited macros. */
export async function stopSharingPrivateFood(db: SQLiteDatabase, catalogId: string): Promise<void> {
  await withExclusiveTransaction(db, async (transactionDb) => {
    const row = await transactionDb.getFirstAsync<Record<string, string | number | null>>(
      `SELECT id, catalog_id, name, brand, barcode, serving_quantity, serving_unit,
        calories_kcal, protein_g, carbohydrate_g, fat_g, fibre_g, created_at,
        updated_at, client_updated_at, deleted_at
       FROM private_foods WHERE catalog_id = ? AND deleted_at IS NULL`, [catalogId]);
    if (!row) throw new Error('This saved food could not be found.');
    const now = new Date(Math.max(Date.now(), (Date.parse(String(row.client_updated_at)) || 0) + 1)).toISOString();
    await transactionDb.runAsync('UPDATE private_foods SET is_shared = 0, updated_at = ?, client_updated_at = ? WHERE id = ?',
      [now, now, row.id!]);
    await enqueueUpsert(transactionDb, 'private_foods', String(row.id), {
      ...row, is_shared: false, updated_at: now, client_updated_at: now,
    });
  });
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
