import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Button, Card, Field, Pill, Screen, SectionHeading, StatePanel } from '@/components/ui';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useScreenData } from '@/hooks/use-screen-data';
import { deleteCardioSession, getCardioSession, listCardioSessions, saveCardioSession } from '@/lib/db/cardio';
import { CARDIO_ACTIVITIES, cardioBaseline, cardioLabel, type CardioActivity } from '@/lib/training/cardio';
import { formatShortDate, localTimestampForDate, shiftLocalDateKey, toLocalDateKey } from '@/lib/time';
import { spacing, typography, useJienTheme } from '@/theme';

export default function CardioScreen() {
  const params = useLocalSearchParams<{ id?: string; date?: string }>();
  return <CardioEntry key={`${params.id ?? 'new'}:${params.date ?? 'today'}`} id={params.id} initialDate={params.date ?? toLocalDateKey()} />;
}
function CardioEntry({ id, initialDate }: { id?: string; initialDate: string }) {
  const db = useSQLiteContext(); const router = useRouter(); const { colors } = useJienTheme();
  const today = toLocalDateKey();
  const loader = useCallback(async () => ({
    history: await listCardioSessions(db, shiftLocalDateKey(today, -89), today),
    selected: id ? await getCardioSession(db, id) : null,
  }), [db, id, today]);
  const { data, loading, error, reload } = useScreenData(loader);
  const [draft, setDraft] = useState({ activity: 'walk' as CardioActivity, minutes: '', distance: '', effort: '', notes: '', date: initialDate });
  const latestDraft = useRef(draft);
  const { activity, minutes, distance, effort, notes, date } = draft;
  function changeDraft(patch: Partial<typeof draft>) {
    // Capture input events synchronously, including a save before React's next render.
    latestDraft.current = { ...latestDraft.current, ...patch };
    setDraft(latestDraft.current);
  }
  const [details, setDetails] = useState(false);
  const [notice, setNotice] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false); const lock = useRef(false);
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!data || initialized) return;
    if (data.selected) {
      const entry = data.selected;
      changeDraft({ activity: entry.activity, minutes: String(entry.minutes),
        distance: entry.distanceKm == null ? '' : String(entry.distanceKm), effort: entry.effort == null ? '' : String(entry.effort),
        notes: entry.notes, date: entry.loggedOn });
    }
    setInitialized(true);
  }, [data, initialized]);
  async function save() {
    if (lock.current) return; lock.current = true; setBusy(true); setNotice(null);
    let navigating = false;
    try {
      const input = latestDraft.current;
      const loggedAt = id && data?.selected?.loggedOn === input.date ? data.selected.loggedAt : localTimestampForDate(input.date);
      const savedId = await saveCardioSession(db, { activity: input.activity, minutes: input.minutes.trim() ? Number(input.minutes) : NaN,
        distanceKm: input.distance.trim() ? Number(input.distance) : null, effort: input.effort.trim() ? Number(input.effort) : null, notes: input.notes }, loggedAt, id);
      if (id) { await reload(); setNotice('Cardio updated on this device and queued for sync.'); }
      else { router.replace({ pathname: '/cardio', params: { id: savedId } } as never); navigating = true; }
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Cardio could not be saved.'); }
    finally { if (!navigating) { lock.current = false; setBusy(false); } }
  }
  async function remove() {
    if (!id || lock.current) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    lock.current = true; setBusy(true);
    try { await deleteCardioSession(db, id); router.replace('/cardio' as never); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Cardio could not be removed.'); }
    finally { lock.current = false; setBusy(false); }
  }
  if ((loading && !data) || (data && !initialized)) return <Screen><StatePanel title="Loading cardio" body="Reading sessions from this device." loading /></Screen>;
  if (error) return <Screen><StatePanel title="Cardio is unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /></Screen>;
  if (id && !data?.selected) return <Screen><StatePanel title="Cardio entry not found" body="It may have been removed or saved by a newer app version." actionLabel="Open cardio" onAction={() => router.replace('/cardio' as never)} /></Screen>;
  const baseline = cardioBaseline(data?.history ?? [], activity, date, id);
  const lastSeven = (data?.history ?? []).filter((entry) => entry.loggedOn >= shiftLocalDateKey(today, -6));
  return <Screen>
    <SectionHeading title={id ? 'Saved cardio' : 'Log cardio'} detail={id ? 'Edit the activity you completed' : 'Record a completed session'} />
    <Card>
      <AppText style={styles.label}>Activity</AppText>
      <View style={styles.choices}>{CARDIO_ACTIVITIES.map(([key, label]) => <Pill key={key} label={label} active={activity === key} onPress={() => changeDraft({ activity: key })} />)}</View>
      <Field label="Duration (minutes)" value={minutes} onChangeText={(minutes) => changeDraft({ minutes })} onEndEditing={(event) => changeDraft({ minutes: event.nativeEvent.text })} autoCorrect={false} inputMode="decimal" placeholder="e.g. 20" />
      <Field label="Distance (km, optional)" value={distance} onChangeText={(distance) => changeDraft({ distance })} onEndEditing={(event) => changeDraft({ distance: event.nativeEvent.text })} autoCorrect={false} inputMode="decimal" placeholder="Leave blank if unknown" />
      <Field label="Session effort (1–10, optional)" value={effort} onChangeText={(effort) => changeDraft({ effort })} onEndEditing={(event) => changeDraft({ effort: event.nativeEvent.text })} autoCorrect={false} inputMode="decimal" placeholder="Leave blank if unknown" hint="Your overall effort, not a heart-rate zone." />
      <AppText style={{ color: colors.textMuted }}>{baseline.medianMinutes == null ? 'No recent sessions for this activity.'
        : `Recent ${cardioLabel(activity).toLowerCase()} duration: ${baseline.medianMinutes} min median across ${baseline.count} session${baseline.count === 1 ? '' : 's'}.`}</AppText>
      <AppText style={{ color: colors.textMuted }}>Duration describes work logged, not fitness gained. Different activities, routes and machine settings are not equivalent.</AppText>
      <Button label={details ? 'Hide date and notes' : `Date and notes · ${date}`} expanded={details} onPress={() => setDetails(!details)} variant="quiet" />
      {details ? <><Field label="Cardio date" value={date} onChangeText={(date) => changeDraft({ date })} placeholder="YYYY-MM-DD" /><Field label="Cardio notes (optional)" value={notes} onChangeText={(notes) => changeDraft({ notes })} multiline placeholder="Route, incline or machine settings" /></> : null}
      {notice ? <AppText accessibilityRole="alert">{notice}</AppText> : null}
      <Button label={id ? 'Save cardio changes' : 'Save cardio'} onPress={() => void save()} busy={busy} />
      {id ? <><Button label={confirmDelete ? 'Confirm remove cardio' : 'Remove cardio'} onPress={() => void remove()} disabled={busy} variant="danger" />
        {confirmDelete ? <Button label="Keep cardio" variant="quiet" onPress={() => setConfirmDelete(false)} /> : null}
        <Button label="Log another cardio session" variant="secondary" onPress={() => router.replace('/cardio' as never)} /></> : null}
    </Card>
    <Card><AppText style={styles.label}>Last 7 days · cardio</AppText><AppText style={styles.metric}>{Math.round(lastSeven.reduce((sum, row) => sum + row.minutes, 0) * 10) / 10} min</AppText>
      <AppText>{lastSeven.length} saved session{lastSeven.length === 1 ? '' : 's'} · separate from lifting volume</AppText></Card>
    <SectionHeading title="Recent cardio" detail="Last 90 days · latest 30 entries" />
    {(data?.history ?? []).slice(0, 30).map((entry) => <Card key={entry.id}>
      <AppText style={styles.label}>{cardioLabel(entry.activity)} · {entry.minutes} min</AppText>
      <AppText>{formatShortDate(entry.loggedAt)}{entry.distanceKm != null ? ` · ${entry.distanceKm} km` : ''}{entry.effort != null ? ` · effort ${entry.effort}/10` : ''}</AppText>
      <Button label={`Review ${cardioLabel(entry.activity)} from ${entry.loggedOn}`} variant="quiet" onPress={() => router.replace({ pathname: '/cardio', params: { id: entry.id } } as never)} />
    </Card>)}
  </Screen>;
}
const styles = StyleSheet.create({ choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, label: { ...typography.label, fontWeight: '700' }, metric: { ...typography.title } });
