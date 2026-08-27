import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { deleteSleepLog, getSleepLog, listSleepLogs, saveSleepLog, updateSleepLog } from '@/lib/db';
import { formatShortDate, localTimestampForDate, toLocalDateKey } from '@/lib/time';
import { averageSleepDuration, formatSleepDuration } from '@/lib/wellness/sleep-record';
import { radii, spacing, typography, useJienTheme } from '@/theme';

const QUALITY_LABELS = ['Very poor', 'Poor', 'Okay', 'Good', 'Restorative'];

export default function SleepScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string | string[]; id?: string | string[] }>();
  const { colors } = useJienTheme();
  const { width } = useWindowDimensions();
  const selectedDate = normalizeDate(firstParam(params.date));
  const sleepId = firstParam(params.id);
  const loader = useCallback(async () => {
    const [history, selected] = await Promise.all([
      listSleepLogs(db, 60),
      sleepId ? getSleepLog(db, sleepId) : Promise.resolve(null),
    ]);
    return { history, selected, sleepId };
  }, [db, sleepId]);
  const { data, error, loading, reload } = useScreenData(loader);
  const initializedFor = useRef<string | null>(null);
  const [sleepHours, setSleepHours] = useState('');
  const [quality, setQuality] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const formKey = sleepId ?? `new:${selectedDate}`;
    if (loading || initializedFor.current === formKey) return;
    initializedFor.current = formKey;
    const selected = data?.selected;
    setSleepHours(selected?.sleepDurationMinutes == null ? '' : trimDecimal(selected.sleepDurationMinutes / 60));
    setQuality(selected?.sleepQualityScore ?? null);
    setNotes(selected?.notes ?? '');
    setConfirmDelete(false);
    setNotice(null);
  }, [data?.selected, loading, selectedDate, sleepId]);

  const history = data?.history ?? [];
  const recentWithDuration = history.filter((entry) => entry.sleepDurationMinutes != null).slice(0, 7);
  const recentAverage = useMemo(() => averageSleepDuration(recentWithDuration), [recentWithDuration]);
  const save = async () => {
    const parsedHours = sleepHours.trim() ? Number(sleepHours) : null;
    if (parsedHours != null && (!Number.isFinite(parsedHours) || parsedHours < 0 || parsedHours > 24)) {
      setNotice('Enter sleep between 0 and 24 hours.');
      return;
    }
    setBusy('save');
    setNotice(null);
    try {
      const input = {
        sleepDurationMinutes: parsedHours == null ? null : Math.round(parsedHours * 60),
        sleepQualityScore: quality,
        notes,
      };
      if (sleepId) {
        await updateSleepLog(db, sleepId, input);
        setNotice('Sleep entry updated on this device and queued for sync.');
      } else {
        await saveSleepLog(db, input, localTimestampForDate(selectedDate));
        setSleepHours('');
        setQuality(null);
        setNotes('');
        setNotice('Sleep saved on this device and queued for sync.');
      }
      await reload();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'The sleep entry could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!sleepId) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setNotice('Select “Delete sleep entry” again to confirm.');
      return;
    }
    setBusy('delete');
    setNotice(null);
    try {
      await deleteSleepLog(db, sleepId);
      router.replace({ pathname: '/wellness/sleep', params: { date: data?.selected?.loggedOn ?? selectedDate } } as never);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'The sleep entry could not be deleted.');
      setBusy(null);
    }
  };

  if (loading && !data) return <Screen><StatePanel title="Loading sleep history" body="Reading private sleep entries from this device." loading /></Screen>;
  if (error) return <Screen><StatePanel title="Sleep history is unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /></Screen>;
  if (sleepId && data && !data.selected) return <Screen><StatePanel title="Sleep entry not found" body="It may have been removed on another device." actionLabel="Open sleep history" onAction={() => router.replace('/wellness/sleep' as never)} /></Screen>;

  const editing = Boolean(sleepId && data?.selected);
  const readOnly = Boolean(editing && data?.selected?.source !== 'manual');
  const formDate = data?.selected?.loggedOn ?? selectedDate;
  return (
    <Screen contentContainerStyle={styles.content}>
      <ScreenHeading eyebrow="Recovery" title={editing ? 'Review your sleep.' : 'Log last night’s sleep.'} />
      <Card style={{ backgroundColor: colors.accentSoft, borderColor: colors.accent }}>
        <AppText style={styles.cardTitle}>{formatSelectedDate(formDate)}</AppText>
        <AppText style={{ color: colors.textMuted }}>Attach sleep to the day you woke up. A single night informs context; it never changes training or nutrition targets by itself.</AppText>
      </Card>

      <View style={[styles.layout, width >= 820 && styles.layoutWide]}>
        <Card style={styles.formCard}>
          <SectionHeading title={editing ? 'Edit entry' : 'New sleep entry'} detail="Duration, quality, or a note is enough" />
          {readOnly ? <AppText style={{ color: colors.warning }}>This entry came from a connected health source. Review it here and make changes in that source so provenance stays accurate.</AppText> : null}
          <Field label="Sleep duration" value={sleepHours} onChangeText={setSleepHours} editable={!readOnly} inputMode="decimal" placeholder="Hours, e.g. 7.5" hint="Enter the time actually asleep if you know it—not time spent in bed." />
          <View style={styles.scoreBlock}>
            <AppText style={styles.fieldLabel}>Sleep quality</AppText>
            <View style={styles.pillRow}>{QUALITY_LABELS.map((label, index) => (
              <Pill key={label} label={`${index + 1} · ${label}`} active={quality === index + 1} onPress={readOnly ? undefined : () => setQuality((current) => current === index + 1 ? null : index + 1)} />
            ))}</View>
          </View>
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} editable={!readOnly} placeholder="Waking, schedule, soreness, travel…" multiline style={styles.multiline} />
          {!readOnly ? <Button label={editing ? 'Save sleep changes' : 'Save sleep'} onPress={() => void save()} busy={busy === 'save'} /> : null}
          {editing && !readOnly ? <Button label={confirmDelete ? 'Delete sleep entry' : 'Remove sleep entry'} onPress={() => void remove()} busy={busy === 'delete'} variant="danger" /> : null}
          {confirmDelete ? <Button label="Keep entry" onPress={() => { setConfirmDelete(false); setNotice(null); }} variant="quiet" /> : null}
          {notice ? <AppText accessibilityRole="alert" style={{ color: notice.includes('saved') || notice.includes('updated') ? colors.success : colors.warning }}>{notice}</AppText> : null}
        </Card>

        <Card style={styles.summaryCard}>
          <AppText style={styles.cardTitle}>Recent signal</AppText>
          <AppText style={styles.metric}>{formatSleepDuration(recentAverage)}</AppText>
          <AppText style={{ color: colors.textMuted }}>{recentAverage == null ? 'Log a duration to begin a neutral baseline.' : `Average across ${recentWithDuration.length} recent logged night${recentWithDuration.length === 1 ? '' : 's'}.`}</AppText>
          <AppText style={{ color: colors.textMuted }}>This view reports only your entries. It does not infer sleep stages or diagnose recovery.</AppText>
        </Card>
      </View>

      <SectionHeading title="Recent sleep" detail={history.length ? `${history.length} saved entr${history.length === 1 ? 'y' : 'ies'}` : 'No sleep history yet'} />
      {history.length ? <Card>{history.map((entry) => (
        <Pressable
          key={entry.id}
          accessibilityRole="button"
          accessibilityLabel={`Edit sleep from ${formatShortDate(entry.loggedAt)}`}
          onPress={() => router.push({ pathname: '/wellness/sleep', params: { id: entry.id, date: entry.loggedOn } } as never)}
          style={({ pressed }) => [styles.historyRow, { borderBottomColor: colors.border }, pressed && styles.pressed]}
        >
          <View style={styles.flex}><AppText style={styles.historyValue}>{formatSleepDuration(entry.sleepDurationMinutes)}</AppText><AppText style={{ color: colors.textMuted }}>{formatShortDate(entry.loggedAt)} · {entry.source === 'manual' ? 'Manual' : 'Imported'}</AppText>{entry.notes ? <AppText numberOfLines={1} style={{ color: colors.textMuted }}>{entry.notes}</AppText> : null}</View>
          <View style={styles.historyEnd}><AppText style={styles.quality}>{entry.sleepQualityScore == null ? '—' : `${entry.sleepQualityScore}/5`}</AppText><AppText style={{ color: colors.accent, fontWeight: '800' }}>Edit</AppText></View>
        </Pressable>
      ))}</Card> : <StatePanel title="No sleep entries yet" body="Log only what is useful. Duration and quality remain editable, private, and available offline." />}

      <Button label="Back to wellness" onPress={() => router.back()} variant="quiet" />
    </Screen>
  );
}

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function normalizeDate(value: string | null): string {
  const today = toLocalDateKey();
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today) return today;
  try {
    localTimestampForDate(value);
    return value;
  } catch {
    return today;
  }
}

function formatSelectedDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function trimDecimal(value: number): string {
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 980, alignSelf: 'center' },
  layout: { gap: spacing.lg },
  layoutWide: { flexDirection: 'row', alignItems: 'flex-start' },
  formCard: { flex: 2 },
  summaryCard: { flex: 1, minWidth: 240 },
  cardTitle: { ...typography.bodyLarge, fontWeight: '800' },
  metric: { ...typography.title, fontWeight: '800', fontVariant: ['tabular-nums'] },
  fieldLabel: { ...typography.label, fontWeight: '700' },
  scoreBlock: { gap: spacing.xs },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  multiline: { minHeight: 96, textAlignVertical: 'top', paddingTop: spacing.sm },
  historyRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: radii.compact },
  historyValue: { ...typography.bodyLarge, fontWeight: '800', fontVariant: ['tabular-nums'] },
  historyEnd: { alignItems: 'flex-end', gap: spacing.xxs },
  quality: { ...typography.bodyLarge, fontWeight: '800', fontVariant: ['tabular-nums'] },
  flex: { flex: 1 },
  pressed: { opacity: 0.68 },
});
