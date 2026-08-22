export const DATABASE_JOURNAL_MODE = 'WAL';

export function resolveDatabaseJournalMode(database: unknown): 'WAL' | 'DELETE' {
  return (
    database
    && typeof database === 'object'
    && 'recommendedJournalMode' in database
    && database.recommendedJournalMode === 'DELETE'
  ) ? 'DELETE' : DATABASE_JOURNAL_MODE;
}
