import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { getWorkoutDetail, getWorkoutProgressComparison } from '@/lib/db';
import { formatShortDate, formatTime } from '@/lib/time';
import { spacing, typography, useJienTheme } from '@/theme';

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useJienTheme();
  const loader = useCallback(async () => {
    const [detail, progress] = await Promise.all([
      getWorkoutDetail(db, id),
      getWorkoutProgressComparison(db, id),
    ]);
    return { detail, progress };
  }, [db, id]);
  const { data, error, loading, reload } = useScreenData(loader);
  const detail = data?.detail ?? null;
  const groups = useMemo(() => {
    const result = new Map<string, NonNullable<typeof detail>['sets']>();
    detail?.sets.forEach((set) => result.set(set.exerciseName, [...(result.get(set.exerciseName) ?? []), set]));
    return [...result.entries()];
  }, [detail]);

  if (loading && !data) return <Screen><StatePanel title="Loading workout" body="Reading this session from your device." loading /></Screen>;
  if (error) return <Screen><StatePanel title="Workout unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /></Screen>;
  if (!detail) return <Screen><StatePanel title="Workout not found" body="It may have been removed from this device." /></Screen>;

  return (
    <Screen contentContainerStyle={styles.screenContent}>
      <ScreenHeading title={detail.title} eyebrow={`${formatShortDate(detail.completedAt ?? detail.performedOn)} · ${detail.completedAt ? formatTime(detail.completedAt) : 'completed'}`} />
      <Card style={styles.summary}>
        <View><AppText style={styles.metric}>{detail.setCount}</AppText><AppText style={{ color: colors.textMuted }}>sets</AppText></View>
        <View><AppText style={styles.metric}>{detail.exerciseCount}</AppText><AppText style={{ color: colors.textMuted }}>exercises</AppText></View>
        <View><AppText style={styles.metric}>{Math.round(detail.totalVolumeKg).toLocaleString()}</AppText><AppText style={{ color: colors.textMuted }}>kg volume</AppText></View>
      </Card>

      {data?.progress ? (
        <Card style={[styles.progress, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
          <AppText style={[styles.kicker, { color: colors.accent }]}>PROGRESSION</AppText>
          {data.progress.overallChangePercent == null ? (
            <>
              <AppText style={styles.progressValue}>Baseline saved</AppText>
              <AppText style={{ color: colors.textMuted }}>This is the reference point for the next time you perform these exercises.</AppText>
            </>
          ) : (
            <>
              <AppText style={[styles.progressValue, { color: data.progress.overallChangePercent >= 0 ? colors.success : colors.warning }]}>{formatPercent(data.progress.overallChangePercent)}</AppText>
              <AppText style={{ color: colors.textMuted }}>working volume across exercises with a previous session</AppText>
            </>
          )}
          <View style={styles.progressRows}>
            {data.progress.exercises.map((exercise) => (
              <View key={exercise.exerciseId} style={styles.progressRow}>
                <View style={styles.flex}>
                  <AppText style={styles.progressName}>{exercise.exerciseName}</AppText>
                  <AppText style={{ color: colors.textMuted }}>{Math.round(exercise.currentVolumeKg).toLocaleString()} kg this session</AppText>
                </View>
                <AppText style={{ color: exercise.changePercent == null ? colors.textMuted : exercise.changePercent >= 0 ? colors.success : colors.warning, fontWeight: '800' }}>
                  {exercise.changePercent == null ? 'baseline' : formatPercent(exercise.changePercent)}
                </AppText>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {groups.map(([exerciseName, sets]) => (
        <View key={exerciseName} style={styles.group}>
          <SectionHeading title={exerciseName} detail={`${sets[0]?.primaryMuscleGroup.replaceAll('_', ' ')} · target ${sets[0]?.targetRepMin}–${sets[0]?.targetRepMax}`} />
          <Card>
            {sets.map((set, index) => <View key={set.id} style={styles.setRow}><AppText style={styles.setIndex}>{index + 1}</AppText><AppText style={styles.setValue}>{set.loadValue} {set.loadUnit} × {set.reps}</AppText><AppText style={{ color: colors.textMuted }}>{set.rpe ? `RPE ${set.rpe}` : 'RPE —'}</AppText></View>)}
          </Card>
        </View>
      ))}
      {detail.notes ? <><SectionHeading title="Notes" /><Card><AppText>{detail.notes}</AppText></Card></> : null}
      <Card style={[styles.nextSession, { backgroundColor: colors.surfaceMuted }]}>
        <View style={styles.flex}>
          <AppText style={styles.progressName}>Ready for the next session?</AppText>
          <AppText style={{ color: colors.textMuted }}>Load this workout again with JIEN's smallest safe rep or load progression already filled in.</AppText>
        </View>
        <View style={styles.actions}>
          <Button label="Plan next session" onPress={() => router.push({ pathname: '/workouts/new', params: { templateWorkoutId: detail.id } })} />
          <Button label="Back to training" onPress={() => router.replace('/train')} variant="secondary" />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { width: '100%', maxWidth: 900, alignSelf: 'center' },
  summary: { flexDirection: 'row', justifyContent: 'space-around' },
  metric: { ...typography.section, fontWeight: '700' },
  progress: { padding: spacing.lg },
  kicker: { ...typography.caption, fontWeight: '800', letterSpacing: 0.6 },
  progressValue: { ...typography.display, fontWeight: '800', letterSpacing: -0.7 },
  progressRows: { gap: spacing.sm, marginTop: spacing.xs },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  progressName: { fontWeight: '700' },
  flex: { flex: 1 },
  group: { gap: spacing.sm },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  setIndex: { width: 24, opacity: 0.65 },
  setValue: { flex: 1, fontWeight: '700' },
  nextSession: { padding: spacing.lg },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

function formatPercent(value: number): string {
  const rounded = Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${value > 0 ? '+' : ''}${rounded}%`;
}
