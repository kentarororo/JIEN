import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Platform, StyleSheet, Switch, View } from 'react-native';

import { AppText, Button, Card, Pill, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { getAccountState, signOut } from '@/lib/auth';
import { exportAllJson, exportNutritionCsv, exportWorkoutsCsv } from '@/lib/export';
import { getSyncStatus, getUserProfile, listNotificationPreferences, saveNotificationPreference, syncPendingChanges } from '@/lib/db';
import { reconcileMealGapNotification } from '@/lib/notifications';
import { spacing, typography, type ThemePreference, useJienTheme } from '@/theme';

async function loadSettings(db: ReturnType<typeof useSQLiteContext>) {
  const [sync, notifications, account, profile] = await Promise.all([getSyncStatus(db), listNotificationPreferences(db), getAccountState(), getUserProfile(db)]);
  return { sync, account, profile, mealGap: notifications.find((item) => item.type === 'meal_gap') ?? null };
}

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useJienTheme();
  const loader = useCallback(() => loadSettings(db), [db]);
  const { data, error, loading, reload } = useScreenData(loader);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    setMessage(null);
    try {
      await task();
    } catch (cause) {
      Alert.alert('Couldn’t complete that', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const toggleMealGap = async (enabled: boolean) => {
    await run('notification', async () => {
      await saveNotificationPreference(db, 'meal_gap', enabled);
      const outcome = await reconcileMealGapNotification(db, enabled);
      setMessage(
        !enabled ? 'Meal-gap reminders are off.' : outcome === 'scheduled' ? 'A reminder will appear only if today still looks incomplete.' : outcome === 'permission_denied' ? 'Notification permission was not granted.' : outcome === 'unsupported' ? 'Local reminders are available on iOS and Android.' : 'No reminder is needed for today.',
      );
      await reload();
    });
  };

  const performSync = async () => {
    await run('sync', async () => {
      const result = await syncPendingChanges(db);
      switch (result.state) {
        case 'synced':
          setMessage(`${result.processed} local change${result.processed === 1 ? '' : 's'} synced.`);
          break;
        case 'signed_out':
          setMessage('Your data is safe on this device. Sign in to enable cloud sync.');
          break;
        case 'not_configured':
          setMessage('Add Supabase environment variables to enable cloud sync.');
          break;
        case 'offline':
          setMessage('You’re offline. Changes remain queued on this device.');
          break;
        case 'partial':
          setMessage(`Synced ${result.processed}, then paused: ${result.error}`);
          break;
      }
      await reload();
    });
  };

  return (
    <Screen>
      <ScreenHeading title="Settings" eyebrow="Local-first control" />
      {loading && !data ? <StatePanel title="Loading settings" body="Reading preferences from this device." loading /> : null}
      {error ? <StatePanel title="Settings are unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /> : null}

      <SectionHeading title="Your foundation" detail="Used to tailor training and future guidance" />
      <Card>
        <AppText style={styles.cardTitle}>{data?.profile ? 'Profile complete' : 'Profile not set'}</AppText>
        <AppText style={{ color: theme.colors.textMuted }}>{data?.profile ? `${data.profile.goals[0]?.replaceAll('_', ' ')} · ${data.profile.trainingExperience} · ${data.profile.preferredLoadUnit}` : 'Complete the guided setup to establish your preferences.'}</AppText>
        <Button label={data?.profile ? 'Review profile' : 'Start guided setup'} onPress={() => router.push({ pathname: '/onboarding', params: { edit: '1' } })} variant="secondary" />
      </Card>

      <SectionHeading title="Appearance" detail="Follows your device by default" />
      <Card style={styles.pillRow}>
        {(['system', 'light', 'dark'] as ThemePreference[]).map((preference) => <Pill key={preference} label={preference[0]!.toUpperCase() + preference.slice(1)} active={theme.preference === preference} onPress={() => theme.setPreference(preference)} />)}
      </Card>

      <SectionHeading title="Contextual reminders" detail="Off until you opt in" />
      <Card>
        <View style={styles.row}>
          <View style={styles.copy}><AppText style={styles.cardTitle}>Possible missing meal</AppText><AppText style={{ color: theme.colors.textMuted }}>At 8 pm, only when fewer than two meals are logged. A new meal cancels stale reminders.</AppText></View>
          <Switch accessibilityLabel="Possible missing meal reminder" disabled={busy === 'notification'} value={data?.mealGap?.enabled ?? false} onValueChange={(value) => void toggleMealGap(value)} trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.wood }} thumbColor={theme.colors.surfaceRaised} />
        </View>
        {Platform.OS === 'web' ? <AppText style={{ color: theme.colors.textMuted }}>Scheduling is available in the native app.</AppText> : null}
      </Card>

      <SectionHeading title="Sync" detail="SQLite remains the source of truth" />
      <Card>
        <View style={styles.row}><View style={styles.copy}><AppText style={styles.cardTitle}>{data?.account.user?.email ?? (data?.account.configured ? 'Not signed in' : 'Supabase not configured')}</AppText><AppText style={{ color: theme.colors.textMuted }}>{data?.account.user ? 'Cloud sync is available for queued changes.' : data?.account.configured ? 'Local logging stays fully available.' : 'Add the public URL and publishable key in your environment.'}</AppText></View></View>
        {data?.account.user ? <Button label="Sign out" onPress={() => void run('account', async () => { await signOut(); await reload(); })} busy={busy === 'account'} variant="quiet" /> : data?.account.configured ? <Button label="Sign in or create account" onPress={() => router.push('/settings/account')} variant="secondary" /> : null}
        <View style={styles.row}><View><AppText style={styles.cardTitle}>{data?.sync.pendingCount ?? 0} queued</AppText><AppText style={{ color: theme.colors.textMuted }}>{data?.sync.failedCount ? `${data.sync.failedCount} waiting to retry` : 'Ready when a signed-in connection is available'}</AppText></View></View>
        <Button label="Sync now" onPress={() => void performSync()} busy={busy === 'sync'} variant="secondary" />
      </Card>

      <SectionHeading title="Export" detail="Portable files generated on this device" />
      <Card>
        <Button label="Workout CSV" onPress={() => void run('workouts', () => exportWorkoutsCsv(db))} busy={busy === 'workouts'} variant="secondary" />
        <Button label="Nutrition CSV" onPress={() => void run('nutrition', () => exportNutritionCsv(db))} busy={busy === 'nutrition'} variant="secondary" />
        <Button label="Complete JSON" onPress={() => void run('all', () => exportAllJson(db))} busy={busy === 'all'} variant="quiet" />
      </Card>

      {message ? <Card style={{ backgroundColor: theme.colors.successSoft }}><AppText>{message}</AppText></Card> : null}

      <SectionHeading title="Health guidance" />
      <Card><AppText style={styles.cardTitle}>Not medical advice</AppText><AppText style={{ color: theme.colors.textMuted }}>JIEN’s AI guidance supports reflection and planning; it does not diagnose, treat, or replace a qualified clinician.</AppText><Button label="Open wellness hub" onPress={() => router.push('/wellness' as never)} variant="secondary" /></Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  copy: { flex: 1, gap: spacing.xxs },
  cardTitle: { ...typography.bodyLarge, fontWeight: '700' },
});
