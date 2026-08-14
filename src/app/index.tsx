import { Redirect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AccountAuthControls } from '@/components/account-auth-controls';
import { AppText, Button, Card, Screen, StatePanel } from '@/components/ui';
import { resolveAccountEntry, routeForLocalEntry, type AccountEntryDecision } from '@/lib/auth/account-entry';
import { hasCompletedOnboarding, syncAccountData, type AccountSyncResult } from '@/lib/db';
import { spacing, typography, useJienTheme } from '@/theme';

export default function IndexRoute() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const [decision, setDecision] = useState<AccountEntryDecision | null>(null);
  const [hasLocalProfile, setHasLocalProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finishDecision = useCallback(async (sync: AccountSyncResult) => {
    const completed = await hasCompletedOnboarding(db);
    setHasLocalProfile(completed);
    setDecision(resolveAccountEntry(completed, sync));
  }, [db]);

  const load = useCallback(async () => {
    setError(null);
    setDecision(null);
    try {
      const sync = await syncAccountData(db);
      await finishDecision(sync);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read account setup.');
    }
  }, [db, finishDecision]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <Screen><StatePanel title="Setup is unavailable" body={error} actionLabel="Try again" onAction={() => void load()} /></Screen>;
  if (decision == null) return <Screen><StatePanel title="Preparing JIEN" body="Checking this device and your signed-in account." loading /></Screen>;
  if (decision.kind === 'app') return <Redirect href="/(tabs)/today" />;

  const notice = decision.kind === 'account_conflict' ? decision.message : decision.notice;
  const noticeTone = decision.kind === 'account_conflict' ? 'danger' : decision.noticeTone;

  return (
    <Screen contentContainerStyle={styles.screen}>
      <View style={styles.heading}>
        <AppText style={[styles.brand, { color: colors.accent }]}>JIEN</AppText>
        <AppText accessibilityRole="header" style={styles.title}>Welcome to your training record</AppText>
        <AppText style={[styles.subtitle, { color: colors.textMuted }]}>Restore an existing profile first, or start a new local one. Logging stays available without an account.</AppText>
      </View>

      {notice ? (
        <Card
          accessibilityRole="alert"
          style={{ backgroundColor: noticeTone === 'danger' ? colors.dangerSoft : noticeTone === 'warning' ? colors.warningSoft : colors.accentSoft }}
        >
          <AppText style={{ color: noticeTone === 'danger' ? colors.danger : noticeTone === 'warning' ? colors.warning : colors.text }}>{notice}</AppText>
          {noticeTone === 'warning' ? <Button label="Check again" onPress={() => void load()} variant="quiet" /> : null}
        </Card>
      ) : null}

      <Card style={styles.authCard}>
        <AppText style={styles.sectionTitle}>Restore your profile</AppText>
        <AppText style={{ color: colors.textMuted }}>Sign in with the account you used before. JIEN will check for your saved profile and history.</AppText>
        <AccountAuthControls onAuthenticated={finishDecision} />
      </Card>

      <View style={styles.localSetup}>
        <AppText style={[styles.sectionTitle, { textAlign: 'center' }]}>{hasLocalProfile ? 'Use this device\'s profile' : 'New to JIEN?'}</AppText>
        <Button
          label={hasLocalProfile ? 'Continue with local profile' : 'Set up as new'}
          onPress={() => router.replace(routeForLocalEntry(hasLocalProfile))}
          variant="secondary"
        />
        <AppText style={[styles.localNote, { color: colors.textMuted }]}>No sign-in required. You can connect an account later from Settings.</AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { width: '100%', maxWidth: 620, alignSelf: 'center', flexGrow: 1, justifyContent: 'center' },
  heading: { gap: spacing.xs },
  brand: { ...typography.bodyLarge, fontWeight: '800', letterSpacing: 1.2 },
  title: { ...typography.display, fontWeight: '700', letterSpacing: -0.7 },
  subtitle: { ...typography.bodyLarge },
  authCard: { padding: spacing.lg, gap: spacing.md },
  sectionTitle: { ...typography.bodyLarge, fontWeight: '700' },
  localSetup: { gap: spacing.sm },
  localNote: { ...typography.label, textAlign: 'center' },
});
