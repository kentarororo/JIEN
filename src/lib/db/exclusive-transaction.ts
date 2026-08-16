import type { SQLiteDatabase } from 'expo-sqlite';

export type ExclusiveTransactionDatabase = SQLiteDatabase & {
  withExclusiveTransactionAsync?: <T>(
    task: (transactionDatabase: SQLiteDatabase) => Promise<T>,
  ) => Promise<T>;
};

/**
 * Run a repository transaction against a handle scoped to that transaction.
 *
 * Expo SQLite owns native transaction scheduling, so native databases receive
 * their ordinary handle. The web adapter supplies a scoped handle whose
 * operations bypass its outer operation queue; unrelated operations remain
 * queued until the complete transaction commits or rolls back.
 */
export async function withExclusiveTransaction<T>(
  database: SQLiteDatabase,
  task: (transactionDatabase: SQLiteDatabase) => Promise<T>,
): Promise<T> {
  const exclusiveDatabase = database as ExclusiveTransactionDatabase;
  if (exclusiveDatabase.withExclusiveTransactionAsync) {
    return exclusiveDatabase.withExclusiveTransactionAsync<T>(task);
  }

  let result!: T;
  await database.withTransactionAsync(async () => {
    result = await task(database);
  });
  return result;
}
