import type { SQLiteDatabase } from 'expo-sqlite';

export async function addColumnIfMissing(
  db: Pick<SQLiteDatabase, 'execAsync' | 'getAllAsync'>,
  table: string,
  column: string,
  definition: string,
): Promise<boolean> {
  if (![table, column].every((value) => /^[a-z][a-z0-9_]*$/.test(value))) {
    throw new Error('Invalid migration identifier.');
  }
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((entry) => entry.name === column)) return false;
  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}
