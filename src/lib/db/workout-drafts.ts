import type { SQLiteDatabase } from 'expo-sqlite';

import type { RecoverableWorkoutDraft } from '../workout-draft';
import { parseWorkoutDraft, workoutDraftStorageKey } from '../workout-draft';
import { withExclusiveTransaction } from './exclusive-transaction';

const LOCAL_OWNER = 'local-device';

export async function getWorkoutDraftOwnerId(db: SQLiteDatabase): Promise<string> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'cloud_owner_user_id'",
  );
  return row?.value.trim() || LOCAL_OWNER;
}

export async function getWorkoutDraft(
  db: SQLiteDatabase,
  ownerUserId: string,
  context: string,
): Promise<RecoverableWorkoutDraft | null> {
  const key = workoutDraftStorageKey(ownerUserId, context);
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [key],
  );
  return parseWorkoutDraft(row?.value ?? null, ownerUserId, context);
}

export async function saveWorkoutDraft(
  db: SQLiteDatabase,
  draft: RecoverableWorkoutDraft,
): Promise<void> {
  const key = workoutDraftStorageKey(draft.ownerUserId, draft.context);
  await withExclusiveTransaction(db, async (transaction) => {
    await transaction.runAsync(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
       WHERE excluded.updated_at >= app_settings.updated_at`,
      [key, JSON.stringify(draft), draft.updatedAt],
    );
  });
}

export async function deleteWorkoutDraft(
  db: SQLiteDatabase,
  ownerUserId: string,
  context: string,
): Promise<void> {
  await withExclusiveTransaction(db, async (transaction) => {
    await transaction.runAsync('DELETE FROM app_settings WHERE key = ?', [
      workoutDraftStorageKey(ownerUserId, context),
    ]);
  });
}
