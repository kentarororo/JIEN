import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useEffect, useState, type PropsWithChildren } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { StatePanel } from '@/components/ui';
import { syncAccountData, type AccountSyncResult } from '@/lib/db';
import { hydrationCopy } from '@/lib/web-cloud-hydration';
import { spacing } from '@/theme';

export function WebCloudHydrationGate({ children }: PropsWithChildren) {
  if (Platform.OS !== 'web') return children;
  return <WebCloudHydrationGateContent>{children}</WebCloudHydrationGateContent>;
}

function WebCloudHydrationGateContent({ children }: PropsWithChildren) {
  const db = useSQLiteContext();
  const [result, setResult] = useState<AccountSyncResult | null>(null);
  const hydrate = useCallback(async () => {
    setResult(null);
    setResult(await syncAccountData(db, { trigger: 'auth_state_change' }));
  }, [db]);
  useEffect(() => { void hydrate(); }, [hydrate]);
  if (result?.state === 'synced') return children;

  const copy = hydrationCopy(result);
  return (
    <View style={styles.screen}>
      <StatePanel title={copy.title} body={copy.body} loading={result == null} actionLabel={result ? 'Try again' : undefined} onAction={result ? () => void hydrate() : undefined} />
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1, padding: spacing.lg, justifyContent: 'center' } });
