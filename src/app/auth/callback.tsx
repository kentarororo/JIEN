import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';

import { Screen, StatePanel } from '@/components/ui';
import { completeOAuthSignIn } from '@/lib/auth';
import { syncAccountData } from '@/lib/db';

export default function AuthCallbackScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        if (params.error_description) throw new Error(params.error_description);
        if (!params.code) throw new Error('Google did not return a sign-in code.');
        await completeOAuthSignIn(params.code);
        const sync = await syncAccountData(db);
        if (sync.state === 'account_conflict') {
          throw new Error('This device is already linked to a different JIEN account.');
        }
        router.replace('/');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Google sign-in could not finish.');
      }
    })();
  }, [db, params.code, params.error_description, router]);

  return (
    <Screen>
      <StatePanel
        title={error ? 'Sign-in needs attention' : 'Finishing sign-in'}
        body={error ?? 'Connecting your account and restoring your local-first profile.'}
        loading={!error}
        actionLabel={error ? 'Back to account' : undefined}
        onAction={error ? () => router.replace('/settings/account') : undefined}
      />
    </Screen>
  );
}
