import { useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useState } from 'react';
import { Alert, Platform, StyleSheet, Switch, View } from 'react-native';

import { AppText, Button, Card, Pill, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { getAccountState, signOut } from '@/lib/auth';
import { exportAllJson, exportNutritionCsv, exportWorkoutsCsv } from '@/lib/export';
import { getSyncStatus, getUserProfile, listNotificationPreferences, saveNotificationPreference, syncAccountData } from '@/lib/db';
import { reconcileMealGapNotification, reconcileSyncAttentionNotification, reconcileWorkoutPlanNotification } from '@/lib/notifications';
import { spacing, typography, type ThemePreference, useJienTheme } from '@/theme';

async function loadSettings(db: ReturnType<typeof useSQLiteContext>) {
  const [sync, notifications, account, profile] = await Promise.all([getSyncStatus(db), listNotificationPreferences(db), getAccountState(), getUserProfile(db)]);
  return {
    sync,
    account,
    profile,
    mealGap: notifications.find((item) => item.type === 'meal_gap') ?? null,
    workoutPlan: notifications.find((item) => item.type === 'workout_plan') ?? null,
    syncIssue: notifications.find((item) => item.type === 'sync_issue') ?? null,
  };
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

  const toggleSyncAttention = async (enabled: boolean) => {
    await run('sync-notification', async () => {
      await saveNotificationPreference(db, 'sync_issue', enabled);
      const outcome = await reconcileSyncAttentionNotification(db, enabled);
      setMessage(
        !enabled
          ? 'Sync-attention reminders are off.'
          : outcome === 'scheduled'
            ? 'JIEN will notify you once when saved changes need action.'
            : outcome === 'permission_denied'
              ? 'Notification permission was not granted.'
              : outcome === 'unsupported'
                ? 'Local reminders are available on iOS and Android.'
                : 'No sync action is needed right now.',
      );
      await reload();
    });
  };

  const toggleWorkoutPlan = async (enabled: boolean) => {
    await run('workout-notification', async () => {
      await saveNotificationPreference(db, 'workout_plan', enabled);
      const outcome = await reconcileWorkoutPlanNotification(db, enabled);
      setMessage(
        !enabled
          ? 'Planned-workout reminders are off.'
          : outcome === 'scheduled'
            ? 'The next planned session will remind you about one hour before it starts.'
            : outcome === 'permission_denied'
              ? 'Notification permission was not granted.'
              : outcome === 'unsupported'
                ? 'Local reminders are available on iOS and Android.'
                : 'Plan a future workout before a reminder is needed.',
      );
      await reload();
    });
  };

  const performSync = async () => {
    await run('sync', async () => {
      const result = await syncAccountData(db, { trigger: 'manual' });
      switch (result.state) {
        case 'synced':
          setMessage(`${result.pushed} uploaded · ${result.pulled} cloud row${result.pulled === 1 ? '' : 's'} checked.`);
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
          setMessage(`Uploaded ${result.pushed}, then paused: ${result.error}`);
          break;
        case 'action_required':
          setMessage(`${result.error} Your queued records remain safe on this device.`);
          break;
        case 'account_conflict':
          setMessage('This device belongs to a different JIEN account. Sign back in with the original account; records were not merged.');
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
          <View style={styles.copy}><AppText style={styles.cardTitle}>Possible missing meal</AppText><AppText style={{ color: theme.colors.textMuted }}>At 8 pm, only after recent history establishes a multi-meal pattern and today's log is below it. A new meal cancels stale reminders.</AppText></View>
          <Switch accessibilityLabel="Possible missing meal reminder" disabled={busy === 'notification'} value={data?.mealGap?.enabled ?? false} onValueChange={(value) => void toggleMealGap(value)} trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.wood }} thumbColor={theme.colors.surfaceRaised} />
        </View>
        {Platform.OS === 'web' ? <AppText style={{ color: theme.colors.textMuted }}>Scheduling is available in the native app.</AppText> : null}
      </Card>
      <Card>
        <View style={styles.row}>
          <View style={styles.copy}><AppText style={styles.cardTitle}>Planned workout approaching</AppText><AppText style={{ color: theme.colors.textMuted }}>About one hour before the next calendar-backed session. Starting, completing, skipping, removing, or moving the plan cancels stale reminders.</AppText></View>
          <Switch accessibilityLabel="Planned workout reminder" disabled={busy === 'workout-notification'} value={data?.workoutPlan?.enabled ?? false} onValueChange={(value) => void toggleWorkoutPlan(value)} trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.wood }} thumbColor={theme.colors.surfaceRaised} />
        </View>
      </Card>
      <Card>
        <View style={styles.row}>
          <View style={styles.copy}><AppText style={styles.cardTitle}>Sync needs attention</AppText><AppText style={{ color: theme.colors.textMuted }}>Only for a persistent sign-in, permission, validation, or schema problem that requires you to act. Ordinary offline retries stay silent.</AppText></View>
          <Switch accessibilityLabel="Sync needs attention reminder" disabled={busy === 'sync-notification'} value={data?.syncIssue?.enabled ?? false} onValueChange={(value) => void toggleSyncAttention(value)} trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.wood }} thumbColor={theme.colors.surfaceRaised} />
        </View>
      </Card>

      <SectionHeading title="Sync" detail="SQLite remains the source of truth" />
      <Card>
        <View style={styles.row}><View style={styles.copy}><AppText style={styles.cardTitle}>{data?.account.user?.email ?? (data?.account.configured ? 'Not signed in' : 'Supabase not configured')}</AppText><AppText style={{ color: theme.colors.textMuted }}>{data?.account.user ? 'This device keeps your session and restores newer cloud records in the background.' : data?.account.configured ? 'Local logging stays fully available.' : 'Add the public URL and publishable key in your environment.'}</AppText></View></View>
        {data?.account.user ? <Button label="Sign out" onPress={() => void run('account', async () => { await signOut(); await reload(); })} busy={busy === 'account'} variant="quiet" /> : data?.account.configured ? <Button label="Sign in or create account" onPress={() => router.push('/settings/account')} variant="secondary" /> : null}
        <View style={styles.row}><View style={styles.copy}><AppText style={styles.cardTitle}>{data?.sync.pendingCount ?? 0} queued</AppText><AppText style={{ color: theme.colors.textMuted }}>{data?.sync.actionRequiredCount ? `${data.sync.actionRequiredCount} need attention. Sync now retries them after you sign in or update the app.` : data?.sync.failedCount ? `${data.sync.failedCount} waiting for an automatic retry` : 'Ready when a signed-in connection is available'}</AppText></View></View>
        <Button label="Sync now" onPress={() => void performSync()} busy={busy === 'sync'} variant="secondary" />
      </Card>

      <SectionHeading title="Export" detail="Portable files generated from this device" />
      <Card>
        <AppText style={{ color: theme.colors.textMuted }}>The full JSON contains sensitive health, wellness, nutrition, training, and AI conversation history. On web it downloads to your browser; on iOS or Android you choose its destination in the share sheet. Store and share it carefully.</AppText>
        <Button label="Workout CSV" onPress={() => void run('workouts', () => exportWorkoutsCsv(db))} busy={busy === 'workouts'} variant="secondary" />
        <Button label="Nutrition CSV" onPress={() => void run('nutrition', () => exportNutritionCsv(db))} busy={busy === 'nutrition'} variant="secondary" />
        <Button label="Full data JSON" onPress={() => void run('all', async () => { await exportAllJson(db); setMessage(Platform.OS === 'web' ? 'Your full data JSON was downloaded by this browser.' : 'Your full data JSON was passed to the system share sheet.'); })} busy={busy === 'all'} variant="quiet" />
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
