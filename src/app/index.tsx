import { Redirect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import { Screen, StatePanel } from '@/components/ui';
import { hasCompletedOnboarding } from '@/lib/db';

export default function IndexRoute() {
  const db = useSQLiteContext();
  const [complete, setComplete] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setComplete(await hasCompletedOnboarding(db));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read onboarding status.');
    }
  }, [db]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <Screen><StatePanel title="Setup is unavailable" body={error} actionLabel="Try again" onAction={() => void load()} /></Screen>;
  if (complete == null) return <Screen><StatePanel title="Preparing JIEN" body="Loading your local profile." loading /></Screen>;
  return <Redirect href={complete ? '/(tabs)/today' : '/onboarding'} />;
}
