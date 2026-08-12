import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { getAccountState } from '@/lib/auth';
import {
  acknowledgeMedicalDisclaimer,
  getUserProfile,
  getWellnessHubSummary,
  retryWellnessMessage,
  saveWellnessCheckIn,
  sendWellnessMessage,
  type AiMessage,
  type WellnessCheckInInput,
} from '@/lib/db';
import { radii, spacing, typography, useJienTheme } from '@/theme';

const PROMPTS = [
  'How should I pace today?',
  'What stands out this week?',
  'Help me reflect on recovery.',
];

async function loadWellness(db: ReturnType<typeof useSQLiteContext>) {
  const [summary, profile, account] = await Promise.all([
    getWellnessHubSummary(db),
    getUserProfile(db),
    getAccountState(),
  ]);
  return { summary, profile, account };
}

export default function WellnessScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { colors } = useJienTheme();
  const wide = width >= 900;
  const loader = useCallback(() => loadWellness(db), [db]);
  const { data, error, loading, reload } = useScreenData(loader);
  const [mood, setMood] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [soreness, setSoreness] = useState<number | null>(null);
  const [sleepQuality, setSleepQuality] = useState<number | null>(null);
  const [sleepHours, setSleepHours] = useState('');
  const [injuryNote, setInjuryNote] = useState('');
  const [checkInNote, setCheckInNote] = useState('');
  const [composer, setComposer] = useState('');
  const [busy, setBusy] = useState<'check-in' | 'disclaimer' | 'chat' | string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const summary = data?.summary;
  const unresolvedMessage = summary?.messages.find((message) => message.role === 'user' && message.localStatus !== 'complete');
  const aiReady = Boolean(
    data?.account.configured
      && data.account.user
      && data.profile?.aiDataConsent
      && data.profile.medicalDisclaimerAcknowledgedAt,
  );

  const submitCheckIn = async () => {
    const parsedHours = sleepHours.trim() ? Number(sleepHours) : null;
    if (parsedHours != null && (!Number.isFinite(parsedHours) || parsedHours < 0 || parsedHours > 24)) {
      setNotice('Enter sleep between 0 and 24 hours.');
      return;
    }
    setBusy('check-in');
    setNotice(null);
    try {
      const input: WellnessCheckInInput = {
        moodScore: mood,
        energyScore: energy,
        stressScore: null,
        sorenessScore: soreness,
        motivationScore: null,
        sleepDurationMinutes: parsedHours == null ? null : Math.round(parsedHours * 60),
        sleepQualityScore: sleepQuality,
        injuryFlags: injuryNote.trim() ? [injuryNote] : [],
        notes: checkInNote,
      };
      await saveWellnessCheckIn(db, input);
      setMood(null);
      setEnergy(null);
      setSoreness(null);
      setSleepQuality(null);
      setSleepHours('');
      setInjuryNote('');
      setCheckInNote('');
      setNotice('Check-in saved on this device and queued for sync.');
      await reload();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'The check-in could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const acknowledge = async () => {
    setBusy('disclaimer');
    setNotice(null);
    try {
      await acknowledgeMedicalDisclaimer(db);
      setNotice('Health guidance notice acknowledged.');
      await reload();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'The acknowledgement could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const ask = async (text: string, mode: 'chat' | 'plan_explanation' = 'chat') => {
    if (!summary) return;
    setBusy('chat');
    setNotice(null);
    try {
      await sendWellnessMessage(db, text, summary.plan, mode);
      setComposer('');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'AI guidance is unavailable right now.');
    } finally {
      setBusy(null);
      await reload();
    }
  };

  const retry = async (message: AiMessage) => {
    setBusy(`retry-${message.id}`);
    setNotice(null);
    try {
      await retryWellnessMessage(db, message.id);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'The cached message could not be retried.');
    } finally {
      setBusy(null);
      await reload();
    }
  };

  if (loading && !data) {
    return <Screen><StatePanel title="Reading the whole picture" body="Loading your private on-device context." loading /></Screen>;
  }
  if (error || !data || !summary) {
    return <Screen><StatePanel title="Wellness is unavailable" body={error ?? 'The local context could not be loaded.'} actionLabel="Try again" onAction={() => void reload()} /></Screen>;
  }

  return (
    <Screen contentContainerStyle={styles.screenContent}>
      <ScreenHeading eyebrow="Wellness hub" title="Read the whole picture." />

      <View style={[styles.metricGrid, wide && styles.rowWide]}>
        <MetricCard label="7-day training" value={`${summary.workoutCount7Days} session${summary.workoutCount7Days === 1 ? '' : 's'}`} detail={`${Math.round(summary.trainingVolume7DaysKg).toLocaleString()} kg working volume`} />
        <MetricCard label="Volume trend" value={formatPercent(summary.trainingVolumeChangePercent)} detail={summary.trainingVolumeChangePercent == null ? 'Previous week needed' : 'versus the prior 7 days'} tone={summary.trainingVolumeChangePercent != null && summary.trainingVolumeChangePercent < 0 ? 'warning' : 'success'} />
        <MetricCard label="Nutrition signal" value={`${Math.round(summary.averageProtein7Days)} g protein`} detail={`daily average · ${summary.nutritionDaysLogged}/7 days logged`} />
      </View>

      <View style={[styles.primaryGrid, wide && styles.rowWide]}>
        <Card style={styles.flexCard}>
          <View style={styles.cardHeading}>
            <View style={[styles.iconWell, { backgroundColor: colors.accentSoft }]}><Ionicons name="pulse-outline" size={22} color={colors.accent} /></View>
            <View style={styles.flex}><AppText style={styles.cardTitle}>Quick check-in</AppText><AppText style={{ color: colors.textMuted }}>Saved locally first; AI is optional.</AppText></View>
          </View>
          <ScorePicker label="Mood" value={mood} onChange={setMood} />
          <ScorePicker label="Energy" value={energy} onChange={setEnergy} />
          <ScorePicker label="Soreness" value={soreness} onChange={setSoreness} />
          <ScorePicker label="Sleep quality" value={sleepQuality} onChange={setSleepQuality} />
          <Field label="Sleep" value={sleepHours} onChangeText={setSleepHours} placeholder="Hours, e.g. 7.5" inputMode="decimal" />
          <Field label="Active joint or injury note" value={injuryNote} onChangeText={setInjuryNote} placeholder="Optional — what feels active today?" />
          <Field label="Anything else" value={checkInNote} onChangeText={setCheckInNote} placeholder="Stress, motivation, recovery, context…" multiline style={styles.multiline} />
          <Button label="Save check-in" onPress={() => void submitCheckIn()} busy={busy === 'check-in'} />
          {summary.latestCheckIn ? <AppText style={{ color: colors.textMuted }}>Last check-in {formatRelative(summary.latestCheckIn.loggedAt)}.</AppText> : null}
        </Card>

        <Card style={[styles.flexCard, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
          <View style={styles.cardHeading}>
            <View style={[styles.iconWell, { backgroundColor: colors.surfaceRaised }]}><Ionicons name="trending-up-outline" size={22} color={colors.accent} /></View>
            <View style={styles.flex}><AppText style={styles.cardTitle}>Next progression</AppText><AppText style={{ color: colors.textMuted }}>{summary.plan.sourceWorkoutTitle ? `From ${summary.plan.sourceWorkoutTitle}` : 'Complete a workout to generate steps'}</AppText></View>
          </View>
          {summary.plan.activeJointFlag ? <Card style={[styles.inlineNotice, { backgroundColor: colors.warningSoft, borderColor: colors.warning }]}><AppText style={{ color: colors.warning }}>Active joint note: load progression is held until it clears.</AppText></Card> : null}
          {summary.plan.exercises.length ? (
            <View style={styles.planList}>
              {summary.plan.exercises.slice(0, 6).map((exercise) => (
                <View key={exercise.exerciseId} style={[styles.planRow, { borderBottomColor: colors.border }]}>
                  <View style={styles.flex}><AppText style={styles.planName}>{exercise.exerciseName}</AppText><AppText style={{ color: colors.textMuted }}>{exercise.reason}</AppText></View>
                  <Pill label={formatPlanAction(exercise.action)} active={exercise.action === 'add_load' || exercise.action === 'add_reps'} />
                </View>
              ))}
            </View>
          ) : <AppText style={{ color: colors.textMuted }}>The progression engine stays quiet until it has completed working sets.</AppText>}
          {summary.plan.deloadSignal.kind !== 'none' ? <AppText style={{ color: colors.warning }}>{summary.plan.deloadSignal.message}</AppText> : null}
          <Button
            label="Explain my next step"
            onPress={() => void ask('Explain my deterministic next progression steps using my recent recovery and nutrition context. Keep the actions and numbers unchanged.', 'plan_explanation')}
            busy={busy === 'chat'}
            disabled={!aiReady || summary.plan.exercises.length === 0}
            variant="secondary"
          />
          <AppText style={{ color: colors.textMuted }}>The progression engine sets the numbers. AI only explains pacing and context.</AppText>
        </Card>
      </View>

      <SectionHeading title="Ask JIEN" detail="Recent guidance is cached for offline reading" />

      {!data.profile?.aiDataConsent ? (
        <StatePanel title="AI guidance is off" body="Your manual check-ins remain private and local-first. Enable AI data consent in your profile only if you want cross-context guidance." actionLabel="Review profile" onAction={() => router.push({ pathname: '/onboarding', params: { edit: '1' } })} />
      ) : !data.profile.medicalDisclaimerAcknowledgedAt ? (
        <Card style={[styles.disclaimer, { backgroundColor: colors.warningSoft, borderColor: colors.warning }]}>
          <AppText style={styles.cardTitle}>Health guidance, not medical care</AppText>
          <AppText>JIEN can support reflection and planning, but it cannot diagnose, treat, or replace a qualified clinician. Do not use it for emergencies.</AppText>
          <Button label="I understand" onPress={() => void acknowledge()} busy={busy === 'disclaimer'} variant="secondary" />
        </Card>
      ) : !data.account.configured ? (
        <StatePanel title="AI service not configured" body="Add the public Supabase URL and publishable key to enable new replies. Cached guidance and local check-ins remain available." />
      ) : !data.account.user ? (
        <StatePanel title="Sign in for new guidance" body="AI reads only your synced private context. Local check-ins and cached replies remain available while signed out." actionLabel="Sign in" onAction={() => router.push('/settings/account')} />
      ) : null}

      <Card style={styles.chatCard}>
        {summary.messages.length === 0 ? (
          <View style={styles.emptyChat}>
            <AppText style={styles.cardTitle}>One conversation, all your context</AppText>
            <AppText style={{ color: colors.textMuted }}>Ask about training pace, food consistency, sleep, soreness, or how the signals fit together.</AppText>
          </View>
        ) : (
          <View style={styles.messages}>
            {summary.messages.map((message) => (
              <View key={message.id} style={[styles.messageRow, message.role === 'user' && styles.userMessageRow]}>
                <View style={[
                  styles.bubble,
                  message.role === 'user' ? { backgroundColor: colors.accent, borderColor: colors.accent } : { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
                ]}>
                  <AppText style={message.role === 'user' ? { color: colors.textOnAccent } : undefined}>{message.content}</AppText>
                  {message.localStatus !== 'complete' ? (
                    <AppText style={[styles.messageStatus, { color: message.role === 'user' ? colors.textOnAccent : colors.textMuted }]}>{message.localStatus === 'failed' ? 'Reply failed' : 'Sending…'}</AppText>
                  ) : null}
                  {message.role === 'user' && message.localStatus !== 'complete' ? <Button label="Retry" onPress={() => void retry(message)} busy={busy === `retry-${message.id}`} variant="quiet" /> : null}
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.promptRow}>
          {PROMPTS.map((prompt) => <Pill key={prompt} label={prompt} onPress={() => setComposer(prompt)} />)}
        </View>
        <Field
          label="Message"
          value={composer}
          onChangeText={setComposer}
          placeholder="Ask about your recent training, food, sleep, or recovery…"
          multiline
          maxLength={2_000}
          style={styles.composer}
        />
        <View style={styles.composerActions}>
          <AppText style={{ color: colors.textMuted, flex: 1 }}>New replies need a connection. Not medical advice.</AppText>
          <Button label="Send" onPress={() => void ask(composer)} busy={busy === 'chat'} disabled={!aiReady || !composer.trim() || Boolean(unresolvedMessage)} />
        </View>
      </Card>

      {notice ? <Card style={{ backgroundColor: notice.toLowerCase().includes('saved') || notice.toLowerCase().includes('acknowledged') ? colors.successSoft : colors.warningSoft }}><AppText>{notice}</AppText></Card> : null}
    </Screen>
  );
}

function ScorePicker({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return (
    <View style={styles.scoreRow}>
      <AppText style={styles.scoreLabel}>{label}</AppText>
      <View style={styles.scorePills}>
        {[1, 2, 3, 4, 5].map((score) => <Pill key={score} label={String(score)} active={value === score} onPress={() => onChange(value === score ? null : score)} />)}
      </View>
    </View>
  );
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: 'success' | 'warning' }) {
  const { colors } = useJienTheme();
  return (
    <Card style={styles.metricCard}>
      <AppText style={[styles.kicker, { color: colors.textMuted }]}>{label}</AppText>
      <AppText style={[styles.metricValue, tone ? { color: colors[tone] } : undefined]}>{value}</AppText>
      <AppText style={{ color: colors.textMuted }}>{detail}</AppText>
    </Card>
  );
}

function formatPercent(value: number | null): string {
  if (value == null) return 'Baseline';
  const rounded = Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${value > 0 ? '+' : ''}${rounded}%`;
}

function formatPlanAction(action: string): string {
  return ({ add_load: 'Add load', add_reps: 'Add reps', hold: 'Hold', start: 'Start' } as Record<string, string>)[action] ?? action;
}

function formatRelative(value: string): string {
  const hours = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 3_600_000));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const styles = StyleSheet.create({
  screenContent: { width: '100%', maxWidth: 1120, alignSelf: 'center' },
  metricGrid: { gap: spacing.sm },
  primaryGrid: { gap: spacing.md, alignItems: 'flex-start' },
  rowWide: { flexDirection: 'row' },
  metricCard: { flex: 1, minWidth: 0 },
  kicker: { ...typography.caption, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  metricValue: { ...typography.section, fontWeight: '800' },
  flexCard: { flex: 1, width: '100%' },
  flex: { flex: 1 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconWell: { width: 44, height: 44, borderRadius: radii.control, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...typography.bodyLarge, fontWeight: '700' },
  scoreRow: { gap: spacing.xs },
  scoreLabel: { ...typography.label, fontWeight: '700' },
  scorePills: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  multiline: { minHeight: 76, paddingTop: spacing.sm, textAlignVertical: 'top' },
  inlineNotice: { padding: spacing.sm },
  planList: { gap: 0 },
  planRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  planName: { fontWeight: '700' },
  disclaimer: { padding: spacing.lg },
  chatCard: { padding: spacing.lg },
  emptyChat: { alignItems: 'flex-start', gap: spacing.xs, paddingVertical: spacing.sm },
  messages: { gap: spacing.sm },
  messageRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  userMessageRow: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '84%', minWidth: 120, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.md, gap: spacing.xs },
  messageStatus: { ...typography.caption, opacity: 0.82 },
  promptRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  composer: { minHeight: 96, paddingTop: spacing.sm, textAlignVertical: 'top' },
  composerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
