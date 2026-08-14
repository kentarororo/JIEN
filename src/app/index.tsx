import { Redirect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import { Screen, StatePanel } from '@/components/ui';
import { hasCompletedOnboarding, syncAccountData } from '@/lib/db';

export default function IndexRoute() {
  const db = useSQLiteContext();
  const [complete, setComplete] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoreBlocked, setRestoreBlocked] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setRestoreBlocked(null);
    try {
      const sync = await syncAccountData(db);
      if (sync.state === 'account_conflict') {
        throw new Error('This device is linked to a different JIEN account. Sign back in with the original account; JIEN will not merge two people\'s local records.');
      }
      const completed = await hasCompletedOnboarding(db);
      if (!completed && sync.state === 'offline') {
        setRestoreBlocked('You are signed in, but this device needs a connection once to download your JIEN profile. Your cloud data has not been changed.');
      }
      if (!completed && sync.state === 'partial') {
        setRestoreBlocked(`JIEN paused before it could safely restore your profile: ${sync.error}`);
      }
      setComplete(completed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read onboarding status.');
    }
  }, [db]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <Screen><StatePanel title="Setup is unavailable" body={error} actionLabel="Try again" onAction={() => void load()} /></Screen>;
  if (complete == null) return <Screen><StatePanel title="Preparing JIEN" body="Loading your local profile." loading /></Screen>;
  if (restoreBlocked) return <Screen><StatePanel title="Reconnect to restore your profile" body={restoreBlocked} actionLabel="Try again" onAction={() => void load()} /></Screen>;
  return <Redirect href={complete ? '/(tabs)/today' : '/onboarding'} />;
}
