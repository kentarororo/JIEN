import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { enqueueUpsert } from './sync-queue.ts';

/** Called inside migration 17's transaction. Keep the old cache rows as recovery copies. */
export async function migratePrivateFoods(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`CREATE TABLE IF NOT EXISTS private_foods (
    id TEXT PRIMARY KEY NOT NULL, catalog_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, brand TEXT, barcode TEXT,
    serving_quantity REAL NOT NULL, serving_unit TEXT NOT NULL,
    calories_kcal REAL NOT NULL, protein_g REAL NOT NULL, carbohydrate_g REAL NOT NULL,
    fat_g REAL NOT NULL, fibre_g REAL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, client_updated_at TEXT NOT NULL,
    deleted_at TEXT, last_used_at TEXT,
    is_shared INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS private_foods_barcode_idx ON private_foods(barcode) WHERE deleted_at IS NULL;`);
  const legacy = await db.getAllAsync<Record<string, string | number | null>>(`SELECT * FROM food_catalog_cache WHERE source = 'custom'`);
  for (const row of legacy) {
    if (await db.getFirstAsync('SELECT id FROM private_foods WHERE catalog_id = ?', [row.id!])) continue;
    const now = new Date().toISOString();
    const legacyUuid = String(row.id).slice('custom-'.length);
    const payload = {
      id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(legacyUuid) ? legacyUuid : Crypto.randomUUID(),
      catalog_id: row.id, name: row.name, brand: row.brand, barcode: row.barcode,
      serving_quantity: row.serving_quantity, serving_unit: row.serving_unit,
      calories_kcal: row.calories_kcal, protein_g: row.protein_g, carbohydrate_g: row.carbohydrate_g,
      fat_g: row.fat_g, fibre_g: row.fibre_g, created_at: row.updated_at ?? now,
      updated_at: now, client_updated_at: now, deleted_at: null,
    };
    const columns = Object.keys(payload);
    await db.runAsync(`INSERT INTO private_foods (${columns.join(',')}, last_used_at) VALUES (${columns.map(() => '?').join(',')}, ?)`,
      [...Object.values(payload).map((value) => value ?? null), row.last_used_at ?? null]);
    await enqueueUpsert(db, 'private_foods', payload.id, payload);
  }
}
