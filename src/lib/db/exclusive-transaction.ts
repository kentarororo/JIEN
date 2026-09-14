import type { SQLiteDatabase } from 'expo-sqlite';

export type ExclusiveTransactionDatabase = SQLiteDatabase & {
  withExclusiveTransactionAsync?: (
    task: (transactionDatabase: SQLiteDatabase) => Promise<void>,
  ) => Promise<void>;
};

/**
 * Run a repository transaction against a handle scoped to that transaction.
 *
 * Expo SQLite supplies a native transaction connection. The web adapter supplies a scoped handle whose
 * operations bypass its outer operation queue; unrelated operations remain
 * queued until the complete transaction commits or rolls back.
 */
export async function withExclusiveTransaction<T>(
  database: SQLiteDatabase,
  task: (transactionDatabase: SQLiteDatabase) => Promise<T>,
): Promise<T> {
  const exclusiveDatabase = database as ExclusiveTransactionDatabase;
  let result!: T;
  if (exclusiveDatabase.withExclusiveTransactionAsync) {
    // Expo native resolves void even when the callback returns a value.
    await exclusiveDatabase.withExclusiveTransactionAsync(async (transactionDatabase) => {
      result = await task(transactionDatabase);
    });
  } else {
    await database.withTransactionAsync(async () => {
      result = await task(database);
    });
  }
  return result;
}
