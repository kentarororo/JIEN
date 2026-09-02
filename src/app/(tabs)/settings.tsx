import { useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, Switch, View } from 'react-native';

import { AppText, Button, Card, Pill, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { getAccountState, signOut } from '@/lib/auth';
import { exportAllJson, exportNutritionCsv, exportWorkoutsCsv } from '@/lib/export';
import { getAccountSyncHealth, getSyncStatus, getUserProfile, listNotificationPreferences, saveNotificationPreference, subscribeToAccountSyncHealth, syncAccountData } from '@/lib/db';
import { reconcileMealGapNotification, reconcileSyncAttentionNotification, reconcileWorkoutPlanNotification } from '@/lib/notifications';
import { radii, spacing, typography, type ThemePreference, useJienTheme } from '@/theme';

async function loadSettings(db: ReturnType<typeof useSQLiteContext>) {
  const [sync, syncHealth, notifications, account, profile] = await Promise.all([getSyncStatus(db), getAccountSyncHealth(db), listNotificationPreferences(db), getAccountState(), getUserProfile(db)]);
  return {
    sync,
    syncHealth,
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
  const [settingsView, setSettingsView] = useState<'general' | 'reminders' | 'data'>('general');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'warning'>('success');

  useEffect(() => subscribeToAccountSyncHealth(() => { void reload(); }), [reload]);

  const selectSettingsView = (view: 'general' | 'reminders' | 'data') => {
    setSettingsView(view);
    setMessage(null);
  };

  const showMessage = (value: string, tone: 'success' | 'warning' = 'success') => {
    setMessageTone(tone);
    setMessage(value);
  };

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
      showMessage(
        !enabled ? 'Meal-gap reminders are off.' : outcome === 'scheduled' ? 'A reminder will appear only if today still looks incomplete.' : outcome === 'permission_denied' ? 'Notification permission was not granted.' : outcome === 'unsupported' ? 'Local reminders are available on iOS and Android.' : 'No reminder is needed for today.',
        outcome === 'permission_denied' || outcome === 'unsupported' ? 'warning' : 'success',
      );
      await reload();
    });
  };

  const toggleSyncAttention = async (enabled: boolean) => {
    await run('sync-notification', async () => {
      await saveNotificationPreference(db, 'sync_issue', enabled);
      const outcome = await reconcileSyncAttentionNotification(db, enabled);
      showMessage(
        !enabled
          ? 'Sync-attention reminders are off.'
          : outcome === 'scheduled'
            ? 'A notification appears once when saved changes require action.'
            : outcome === 'permission_denied'
              ? 'Notification permission was not granted.'
              : outcome === 'unsupported'
                ? 'Local reminders are available on iOS and Android.'
                : 'No sync action is needed right now.',
        outcome === 'permission_denied' || outcome === 'unsupported' ? 'warning' : 'success',
      );
      await reload();
    });
  };

  const toggleWorkoutPlan = async (enabled: boolean) => {
    await run('workout-notification', async () => {
      await saveNotificationPreference(db, 'workout_plan', enabled);
      const outcome = await reconcileWorkoutPlanNotification(db, enabled);
      showMessage(
        !enabled
          ? 'Planned-workout reminders are off.'
          : outcome === 'scheduled'
            ? 'The next planned session will remind you about one hour before it starts.'
            : outcome === 'permission_denied'
              ? 'Notification permission was not granted.'
              : outcome === 'unsupported'
                ? 'Local reminders are available on iOS and Android.'
                : 'Plan a future workout before a reminder is needed.',
        outcome === 'permission_denied' || outcome === 'unsupported' ? 'warning' : 'success',
      );
      await reload();
    });
  };

  const performSync = async () => {
    await run('sync', async () => {
      const result = await syncAccountData(db, { trigger: 'manual' });
      switch (result.state) {
        case 'synced':
          showMessage(result.pushed || result.pulled
            ? `${result.pushed} uploaded · ${result.pulled} restored from cloud.`
            : 'Cloud sync is current.');
          break;
        case 'signed_out':
          showMessage('Local records remain on this device. Sign in to enable cloud sync.', 'warning');
          break;
        case 'not_configured':
          showMessage('Add Supabase environment variables to enable cloud sync.', 'warning');
          break;
        case 'offline':
          showMessage('You’re offline. Changes remain queued on this device.', 'warning');
          break;
        case 'partial':
          showMessage(`Uploaded ${result.pushed}, then paused: ${result.error}`, 'warning');
          break;
        case 'action_required':
          showMessage(`${result.error} Queued records remain on this device.`, 'warning');
          break;
        case 'account_conflict':
          showMessage('This device belongs to a different JIEN account. Sign back in with the original account; records were not merged.', 'warning');
          break;
      }
      await reload();
    });
  };

  return (
    <Screen>
      <ScreenHeading title="Settings" eyebrow="Account, preferences and data" />
      {loading && !data ? <StatePanel title="Loading settings" body="Reading preferences from this device." loading /> : null}
      {error ? <StatePanel title="Settings are unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /> : null}
      {message ? <Card style={{ backgroundColor: messageTone === 'warning' ? theme.colors.warningSoft : theme.colors.successSoft }}><AppText style={{ color: messageTone === 'warning' ? theme.colors.warning : theme.colors.success }}>{message}</AppText></Card> : null}

      <View accessibilityRole="tablist" style={[styles.viewSwitcher, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Pill label="General" active={settingsView === 'general'} onPress={() => selectSettingsView('general')} />
        <Pill label="Reminders" active={settingsView === 'reminders'} onPress={() => selectSettingsView('reminders')} />
        <Pill label="Data" active={settingsView === 'data'} onPress={() => selectSettingsView('data')} />
      </View>

      {settingsView === 'general' ? <>
        <SectionHeading title="Profile" detail="Training preferences and account setup" />
        <Card>
          <AppText style={styles.cardTitle}>{data?.profile ? 'Profile complete' : 'Profile not set'}</AppText>
          <AppText style={{ color: theme.colors.textMuted }}>{data?.profile ? `${data.profile.goals[0]?.replaceAll('_', ' ')} · ${data.profile.trainingExperience} · ${data.profile.preferredLoadUnit}` : 'Complete the guided setup to establish your preferences.'}</AppText>
          <Button label={data?.profile ? 'Review profile' : 'Start guided setup'} onPress={() => router.push({ pathname: '/onboarding', params: { edit: '1' } })} variant="secondary" />
        </Card>

        <SectionHeading title="Appearance" detail="Uses your device setting by default" />
        <Card style={styles.pillRow}>
          {(['system', 'light', 'dark'] as ThemePreference[]).map((preference) => <Pill key={preference} label={preference[0]!.toUpperCase() + preference.slice(1)} active={theme.preference === preference} onPress={() => theme.setPreference(preference)} />)}
        </Card>

        <SectionHeading title="AI connection" detail="Optional meal-photo and wellness features" />
        <Card>
          <AppText style={styles.cardTitle}>Personal Gemini key</AppText>
          <AppText style={{ color: theme.colors.textMuted }}>The key is verified by the server and encrypted in Supabase Vault. Manual logging and progression do not require it.</AppText>
          <Button label="Review AI connection" onPress={() => router.push('/settings/ai' as never)} variant="secondary" />
        </Card>

        <SectionHeading title="Health guidance" />
        <Card><AppText style={styles.cardTitle}>Not medical advice</AppText><AppText style={{ color: theme.colors.textMuted }}>AI guidance can support reflection and planning. It does not diagnose, treat, or replace a qualified clinician.</AppText><Button label="Open wellness" onPress={() => router.push('/wellness' as never)} variant="secondary" /></Card>
      </> : null}

      {settingsView === 'reminders' ? <>
        <SectionHeading title="Contextual reminders" detail="All reminders are off until you opt in" />
        <Card>
          <View style={styles.row}>
            <View style={styles.copy}><AppText style={styles.cardTitle}>Possible missing meal</AppText><AppText style={{ color: theme.colors.textMuted }}>At 8 pm, after recent history establishes a multi-meal pattern and today’s log is below it.</AppText></View>
            <Switch accessibilityLabel="Possible missing meal reminder" disabled={busy === 'notification'} value={data?.mealGap?.enabled ?? false} onValueChange={(value) => void toggleMealGap(value)} trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.wood }} thumbColor={theme.colors.surfaceRaised} />
          </View>
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <View style={styles.row}>
            <View style={styles.copy}><AppText style={styles.cardTitle}>Planned workout approaching</AppText><AppText style={{ color: theme.colors.textMuted }}>About one hour before the next scheduled session. Changing or completing the plan cancels stale reminders.</AppText></View>
            <Switch accessibilityLabel="Planned workout reminder" disabled={busy === 'workout-notification'} value={data?.workoutPlan?.enabled ?? false} onValueChange={(value) => void toggleWorkoutPlan(value)} trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.wood }} thumbColor={theme.colors.surfaceRaised} />
          </View>
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <View style={styles.row}>
            <View style={styles.copy}><AppText style={styles.cardTitle}>Sync needs attention</AppText><AppText style={{ color: theme.colors.textMuted }}>Only persistent account, permission, validation, or schema problems trigger this reminder. Ordinary offline retries stay silent.</AppText></View>
            <Switch accessibilityLabel="Sync needs attention reminder" disabled={busy === 'sync-notification'} value={data?.syncIssue?.enabled ?? false} onValueChange={(value) => void toggleSyncAttention(value)} trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.wood }} thumbColor={theme.colors.surfaceRaised} />
          </View>
        </Card>
        {Platform.OS === 'web' ? <Card style={{ backgroundColor: theme.colors.accentSoft }}><AppText>Reminder scheduling is available in the iOS and Android apps.</AppText></Card> : null}
      </> : null}

      {settingsView === 'data' ? <>
        <SectionHeading title="Account and sync" detail="SQLite remains the on-device source of truth" />
        <Card>
          <View style={styles.syncHeading}>
            <View style={styles.copy}><AppText style={styles.cardTitle}>{data?.account.user?.email ?? (data?.account.configured ? 'Not signed in' : 'Supabase not configured')}</AppText><AppText style={{ color: theme.colors.textMuted }}>{data?.account.user ? 'Signed in on this device. Newer cloud records restore in the background.' : data?.account.configured ? 'Local logging remains available.' : 'Add the public URL and publishable key in your environment.'}</AppText></View>
            <Pill label={syncHealthLabel(data)} active={data?.account.user != null && data?.sync.pendingCount === 0 && data?.syncHealth?.state === 'synced'} />
          </View>
          {data?.syncHealth?.lastSuccessAt ? <AppText style={{ color: theme.colors.textMuted }}>Last successful cloud sync {formatSyncTimestamp(data.syncHealth.lastSuccessAt)}.</AppText> : data?.account.user ? <AppText style={{ color: theme.colors.textMuted }}>No successful cloud sync is recorded on this device yet.</AppText> : null}
          {data?.syncHealth?.safeMessage ? <View style={[styles.syncNotice, { backgroundColor: theme.colors.warningSoft }]}><AppText style={{ color: theme.colors.warning }}>{data.syncHealth.safeMessage} Queued records remain on this device.</AppText></View> : null}
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <View style={styles.copy}><AppText style={styles.cardTitle}>{data?.sync.pendingCount ?? 0} queued</AppText><AppText style={{ color: theme.colors.textMuted }}>{data?.sync.actionRequiredCount ? `${data.sync.actionRequiredCount} need attention. Sync now retries them after you sign in or update the app.` : data?.sync.failedCount ? `${data.sync.failedCount} waiting for an automatic retry` : 'No records are waiting for upload.'}</AppText></View>
          <View style={styles.dataActions}>
            <Button label="Sync now" onPress={() => void performSync()} busy={busy === 'sync'} variant="secondary" />
            {data?.account.user ? <Button label="Sign out" onPress={() => void run('account', async () => { await signOut(); await reload(); })} busy={busy === 'account'} variant="quiet" /> : data?.account.configured ? <Button label="Sign in or create account" onPress={() => router.push('/settings/account')} variant="secondary" /> : null}
          </View>
        </Card>

        <SectionHeading title="Export" detail="Portable files generated from this device" />
        <Card>
          <AppText style={{ color: theme.colors.textMuted }}>Exports contain sensitive health, nutrition, training, and AI records. Store and share them carefully.</AppText>
          <View style={styles.dataActions}>
            <Button label="Workout CSV" onPress={() => void run('workouts', () => exportWorkoutsCsv(db))} busy={busy === 'workouts'} variant="secondary" />
            <Button label="Nutrition CSV" onPress={() => void run('nutrition', () => exportNutritionCsv(db))} busy={busy === 'nutrition'} variant="secondary" />
            <Button label="Full data JSON" onPress={() => void run('all', async () => { await exportAllJson(db); setMessage(Platform.OS === 'web' ? 'Your full data JSON was downloaded by this browser.' : 'Your full data JSON was passed to the system share sheet.'); })} busy={busy === 'all'} variant="quiet" />
          </View>
        </Card>
      </> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', flexWrap: 'wrap' },
  viewSwitcher: { alignSelf: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', borderRadius: 999, padding: spacing.xxs, gap: spacing.xxs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  syncHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  copy: { flex: 1, gap: spacing.xxs },
  cardTitle: { ...typography.bodyLarge, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth },
  syncNotice: { padding: spacing.sm, borderRadius: radii.control },
  dataActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

function syncHealthLabel(data: Awaited<ReturnType<typeof loadSettings>> | null): string {
  if (!data?.account.configured) return 'Local only';
  if (!data.account.user) return 'Not signed in';
  if (data.sync.actionRequiredCount > 0 || data.syncHealth?.state === 'action_required') return 'Needs attention';
  if (data.syncHealth?.state === 'partial') return 'Retry scheduled';
  if (data.sync.pendingCount > 0) {
    if (data.syncHealth?.state === 'offline') return 'Saved offline';
    return 'Upload queued';
  }
  if (data.syncHealth?.state === 'synced') return 'Cloud current';
  if (data.syncHealth?.state === 'offline') return 'Offline';
  return 'Checking sync';
}

function formatSyncTimestamp(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
