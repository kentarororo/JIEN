import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useEffect, useState, type PropsWithChildren } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { StatePanel } from '@/components/ui';
import { getAccountState } from '@/lib/auth';
import {
  externalizeLegacyMealPhotoPayloads,
  getSetting,
  hasCompletedOnboarding,
  syncAccountData,
  type AccountSyncResult,
} from '@/lib/db';
import { MainThreadMemoryDatabase } from '@/lib/db/main-thread-memory-database';
import { canOpenCachedWebDatabase, hydrationCopy } from '@/lib/web-cloud-hydration';
import { spacing } from '@/theme';

export function WebCloudHydrationGate({ children }: PropsWithChildren) {
  if (Platform.OS !== 'web') return children;
  return <WebCloudHydrationGateContent>{children}</WebCloudHydrationGateContent>;
}

function WebCloudHydrationGateContent({ children }: PropsWithChildren) {
  const db = useSQLiteContext();
  const [state, setState] = useState<{ result: AccountSyncResult | null; canOpen: boolean; error: string | null }>({ result: null, canOpen: false, error: null });
  const hydrate = useCallback(async () => {
    setState({ result: null, canOpen: false, error: null });
    try {
      const result = await syncAccountData(db, { trigger: 'auth_state_change' });
      const webDatabase = db as unknown as MainThreadMemoryDatabase;
      // Older snapshots may contain large inline photos. Move them to the
      // account-scoped payload store before creating the first durable image.
      await externalizeLegacyMealPhotoPayloads(db);
      if (result.state === 'synced') {
        await webDatabase.resumePersistenceAsync();
        setState({ result, canOpen: true, error: null });
        return;
      }
      const [account, localOwnerUserId, completedProfile] = await Promise.all([
        getAccountState(),
        getSetting(db, 'cloud_owner_user_id'),
        hasCompletedOnboarding(db),
      ]);
      const canOpen = canOpenCachedWebDatabase({
        result,
        authenticatedUserId: account.user?.id ?? null,
        localOwnerUserId,
        hasCompletedProfile: completedProfile,
        requiresCloudRebuild: webDatabase.requiresCloudRebuild,
      });
      if (canOpen) await webDatabase.resumePersistenceAsync();
      setState({ result, canOpen, error: null });
    } catch {
      setState({ result: null, canOpen: false, error: 'Local recovery could not be completed safely. Refresh JIEN, then try again.' });
    }
  }, [db]);
  useEffect(() => { void hydrate(); }, [hydrate]);
  if (state.canOpen) return children;

  const copy = hydrationCopy(state.result);
  return (
    <View style={styles.screen}>
      <StatePanel
        title={state.error ? 'JIEN needs to recover local data' : copy.title}
        body={state.error ?? copy.body}
        loading={state.result == null && !state.error}
        actionLabel={state.result || state.error ? 'Try again' : undefined}
        onAction={state.result || state.error ? () => void hydrate() : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1, padding: spacing.lg, justifyContent: 'center' } });
