import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { getWorkoutDetail } from '@/lib/db';
import { formatShortDate, formatTime } from '@/lib/time';
import { spacing, typography, useJienTheme } from '@/theme';

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { colors } = useJienTheme();
  const loader = useCallback(() => getWorkoutDetail(db, id), [db, id]);
  const { data, error, loading, reload } = useScreenData(loader);
  const groups = useMemo(() => {
    const result = new Map<string, NonNullable<typeof data>['sets']>();
    data?.sets.forEach((set) => result.set(set.exerciseName, [...(result.get(set.exerciseName) ?? []), set]));
    return [...result.entries()];
  }, [data]);

  if (loading && !data) return <Screen><StatePanel title="Loading workout" body="Reading this session from your device." loading /></Screen>;
  if (error) return <Screen><StatePanel title="Workout unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /></Screen>;
  if (!data) return <Screen><StatePanel title="Workout not found" body="It may have been removed from this device." /></Screen>;

  return (
    <Screen>
      <ScreenHeading title={data.title} eyebrow={`${formatShortDate(data.completedAt ?? data.performedOn)} · ${data.completedAt ? formatTime(data.completedAt) : 'completed'}`} />
      <Card style={styles.summary}>
        <View><AppText style={styles.metric}>{data.setCount}</AppText><AppText style={{ color: colors.textMuted }}>sets</AppText></View>
        <View><AppText style={styles.metric}>{data.exerciseCount}</AppText><AppText style={{ color: colors.textMuted }}>exercises</AppText></View>
        <View><AppText style={styles.metric}>{Math.round(data.totalVolumeKg).toLocaleString()}</AppText><AppText style={{ color: colors.textMuted }}>kg volume</AppText></View>
      </Card>
      {groups.map(([exerciseName, sets]) => (
        <View key={exerciseName} style={styles.group}>
          <SectionHeading title={exerciseName} detail={`${sets[0]?.primaryMuscleGroup.replaceAll('_', ' ')} · target ${sets[0]?.targetRepMin}–${sets[0]?.targetRepMax}`} />
          <Card>
            {sets.map((set, index) => <View key={set.id} style={styles.setRow}><AppText style={styles.setIndex}>{index + 1}</AppText><AppText style={styles.setValue}>{set.loadValue} {set.loadUnit} × {set.reps}</AppText><AppText style={{ color: colors.textMuted }}>{set.rpe ? `RPE ${set.rpe}` : 'RPE —'}</AppText></View>)}
          </Card>
        </View>
      ))}
      {data.notes ? <><SectionHeading title="Notes" /><Card><AppText>{data.notes}</AppText></Card></> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', justifyContent: 'space-around' },
  metric: { ...typography.section, fontWeight: '700' },
  group: { gap: spacing.sm },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  setIndex: { width: 24, opacity: 0.65 },
  setValue: { flex: 1, fontWeight: '700' },
});
