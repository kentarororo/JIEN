import type { SQLiteDatabase } from 'expo-sqlite';

import { signOut } from '@/lib/auth';
import { resetLocalAccountData } from '@/lib/db/account-data-reset';
import { clearMealPhotoPayloadsForAccount } from '@/lib/db/meal-photo-payload';
import { cancelAllContextualNotifications } from '@/lib/notifications';

export class AccountDeletionDeviceError extends Error {
  constructor(readonly code: 'NOTIFICATION_CLEANUP_FAILED' | 'PHOTO_CLEANUP_FAILED' | 'SQLITE_RESET_FAILED' | 'SESSION_CLEAR_FAILED') {
    super(code);
    this.name = 'AccountDeletionDeviceError';
  }
}

export async function finishAccountDeletionOnDevice(
  db: SQLiteDatabase,
  ownerUserId: string,
): Promise<void> {
  // Keep the session and SQLite connection alive until every device-owned
  // resource has been removed. Signing out first can unmount the provider.
  try {
    await cancelAllContextualNotifications(db);
  } catch {
    throw new AccountDeletionDeviceError('NOTIFICATION_CLEANUP_FAILED');
  }
  try {
    await clearMealPhotoPayloadsForAccount(ownerUserId);
  } catch {
    throw new AccountDeletionDeviceError('PHOTO_CLEANUP_FAILED');
  }
  try {
    await resetLocalAccountData(db);
  } catch {
    throw new AccountDeletionDeviceError('SQLITE_RESET_FAILED');
  }
  try {
    await signOut('local');
  } catch {
    throw new AccountDeletionDeviceError('SESSION_CLEAR_FAILED');
  }
}
