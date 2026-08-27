import { useRouter } from 'expo-router';

import { AccountAuthControls } from '@/components/account-auth-controls';
import { AppText, Card, Screen } from '@/components/ui';
import type { AccountSyncResult } from '@/lib/db';
import { useJienTheme } from '@/theme';

export default function AccountScreen() {
  const router = useRouter();
  const { colors } = useJienTheme();

  const finishSync = async (result: AccountSyncResult) => {
    if (result.state === 'account_conflict') {
      throw new Error('This device is linked to another JIEN account. Sign in with the original account; local records are never merged automatically.');
    }
    if (result.state === 'partial' || result.state === 'action_required') {
      throw new Error(result.error);
    }
    router.back();
  };

  return (
    <Screen>
      <Card>
        <AppText style={{ color: colors.textMuted }}>
          Logging works without an account. Sign in to restore your profile and history on another device. The first account used here owns this local database. Records from different accounts are never merged automatically.
        </AppText>
      </Card>
      <AccountAuthControls allowSignUp onAuthenticated={finishSync} />
    </Screen>
  );
}
