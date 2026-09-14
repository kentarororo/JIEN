import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Button, Card, Field, Pill, Screen, ScreenHeading, StatePanel } from '@/components/ui';
import { useSQLiteContext } from '@/lib/db/database-context';
import { getUserProfile, saveTrainingProgramme } from '@/lib/db';
import { PROGRAMME_GOALS, PROGRAMME_MUSCLES, parseTrainingProgramme, type TrainingProgramme } from '@/lib/planning/training-programme';
import { muscleGroupFamilyLabel } from '@/lib/progression';
import { spacing, typography, useJienTheme } from '@/theme';

export default function TrainingProgrammeScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const [goal, setGoal] = useState<TrainingProgramme['goal']>('balanced');
  const [sessions, setSessions] = useState('');
  const [targets, setTargets] = useState<Array<{ muscleGroup: string; value: string }>>([]);
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [exists, setExists] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const profile = await getUserProfile(db);
      if (!profile) throw new Error('Complete your profile before setting training targets.');
      const programme = profile.trainingProgramme;
      if (programme) {
        setGoal(programme.goal);
        setSessions(String(programme.sessionsPerWeek));
        setTargets(programme.targets.map((target) => ({ muscleGroup: target.muscleGroup, value: String(target.weeklySetCredits) })));
      }
      setExists(Boolean(programme));
      setLoaded(true);
    } catch (cause) { setLoadError(cause instanceof Error ? cause.message : 'Could not load training targets.'); }
  }, [db]);
  useEffect(() => { void load(); }, [load]);

  async function save(remove = false) {
    if (saving.current) return;
    const programme = parseTrainingProgramme({ version: 1, goal, sessionsPerWeek: Number(sessions),
      targets: targets.map((target) => ({ muscleGroup: target.muscleGroup, weeklySetCredits: Number(target.value) })) });
    if (!remove && !programme) {
      setError('Enter 1–7 sessions and choose 1–6 muscles. Each target must be 0.5–40, in half-set steps.');
      return;
    }
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      await saveTrainingProgramme(db, remove ? null : programme);
      router.replace('/train' as never);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save training targets.'); }
    finally { saving.current = false; setBusy(false); }
  }

  return <Screen>
    <ScreenHeading title="Training targets" />
    <AppText style={{ color: colors.textMuted }}>Choose what to focus on. These are weekly planning targets, not a required increase. Log whenever you train.</AppText>
    {loadError ? <StatePanel title="Targets are unavailable" body={loadError} actionLabel="Try again" onAction={() => void load()} /> : !loaded ? <StatePanel title="Loading targets" body="Reading your saved programme." loading /> : <>
      <Card>
        <AppText style={styles.title}>Your goal</AppText>
        <AppText style={{ color: colors.textMuted }}>Saved as your intention. It does not set your weights, reps, or weekly targets.</AppText>
        <View style={styles.options}>{PROGRAMME_GOALS.map((item) => <Pill key={item.value} label={item.label} accessibilityRole="radio" active={goal === item.value} onPress={() => { if (!busy) setGoal(item.value); }} />)}</View>
        <Field label="Sessions per week" value={sessions} onChangeText={setSessions} keyboardType="number-pad" editable={!busy} placeholder="Your usual availability" />
        <AppText style={{ color: colors.textMuted }}>No fixed days or times. Missing a session does not add catch-up work.</AppText>
      </Card>
      <Card>
        <AppText style={styles.title}>Priority muscles</AppText>
        <AppText style={{ color: colors.textMuted }}>Choose up to six. Use targets from your programme or coach; no target is filled in for you.</AppText>
        <AppText style={{ color: colors.textMuted }}>A completed primary set counts as 1 credit; supporting muscles receive 0.5. Working, failure and drop sets count; warm-ups do not. Credits describe logged work, not muscle growth or recovery.</AppText>
        {targets.map((target) => <View key={target.muscleGroup} style={styles.target}>
          <Field label={`${muscleGroupFamilyLabel(target.muscleGroup)} weekly credits`} value={target.value} keyboardType="decimal-pad" editable={!busy}
            onChangeText={(value) => setTargets((items) => items.map((item) => item.muscleGroup === target.muscleGroup ? { ...item, value } : item))} placeholder="Enter your target" />
          <Button label={`Remove ${muscleGroupFamilyLabel(target.muscleGroup)}`} variant="quiet" disabled={busy} onPress={() => setTargets((items) => items.filter((item) => item.muscleGroup !== target.muscleGroup))} />
        </View>)}
        {targets.length < 6 ? <>
          <Field label="Find a priority muscle" value={query} onChangeText={setQuery} editable={!busy} placeholder="Chest, quads, back…" />
          <View style={styles.options}>{PROGRAMME_MUSCLES.filter((muscle) => !targets.some((target) => target.muscleGroup === muscle)
            && muscleGroupFamilyLabel(muscle).toLowerCase().includes(query.trim().toLowerCase())).map((muscle) => <Pill key={muscle} label={muscleGroupFamilyLabel(muscle)} accessibilityLabel={`Add ${muscleGroupFamilyLabel(muscle)}`}
              onPress={() => { if (!busy) { setTargets((items) => items.length >= 6 || items.some((item) => item.muscleGroup === muscle) ? items : [...items, { muscleGroup: muscle, value: '' }]); setQuery(''); } }} />)}</View>
        </> : <AppText>Six priority muscles selected. Remove one to choose another.</AppText>}
        <AppText style={{ color: colors.textMuted }}>Targets accept 0.5–40 credits in half-set steps. This is an input range, not a recommended amount. Other muscles still count in your training history.</AppText>
      </Card>
      {error ? <AppText accessibilityRole="alert" style={{ color: colors.danger }}>{error}</AppText> : null}
      <Button label="Save training targets" busy={busy} onPress={() => void save()} />
      <Button label="Cancel" disabled={busy} variant="quiet" onPress={() => router.replace('/train' as never)} />
      {exists ? confirmRemove ? <Card>
        <AppText>Remove your goal and weekly targets? Workouts and saved session plans will stay unchanged.</AppText>
        <Button label="Confirm remove targets" variant="danger" busy={busy} onPress={() => void save(true)} />
        <Button label="Keep targets" variant="quiet" disabled={busy} onPress={() => setConfirmRemove(false)} />
      </Card> : <Button label="Remove training targets" variant="quiet" disabled={busy} onPress={() => setConfirmRemove(true)} /> : null}
    </>}
  </Screen>;
}

const styles = StyleSheet.create({
  title: { ...typography.section },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  target: { gap: spacing.xs, marginVertical: spacing.xs },
});
