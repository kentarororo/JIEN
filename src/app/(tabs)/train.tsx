import { Link, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Screen, ScreenHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { listRecentWorkouts, listVolumeHistory } from '@/lib/db';
import { aggregateWeeklyVolume, detectDeloadSignal } from '@/lib/progression';
import { formatShortDate } from '@/lib/time';
import { spacing, typography, useJienTheme } from '@/theme';

export default function TrainScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const loader = useCallback(async () => {
    const [workouts, volumeSets] = await Promise.all([listRecentWorkouts(db), listVolumeHistory(db)]);
    const weeks = aggregateWeeklyVolume(volumeSets);
    return { workouts, weeks, signal: detectDeloadSignal(weeks.map((week) => week.totalKg)) };
  }, [db]);
  const { data, error, loading, reload } = useScreenData(loader);

  return (
    <Screen>
      <ScreenHeading title="Training" eyebrow="Machine-first log" action={<Button label="Add" onPress={() => router.push('/workouts/new')} />} />
      {loading && !data ? <StatePanel title="Loading workouts" body="Reading your on-device history." loading /> : null}
      {error ? <StatePanel title="Workouts are unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /> : null}
      {!loading && !error && data?.workouts.length === 0 ? <StatePanel title="No workouts yet" body="Start with one exercise and record the sets you completed." actionLabel="Log your first workout" onAction={() => router.push('/workouts/new')} /> : null}
      {data?.weeks.at(-1) ? (
        <Card>
          <View style={styles.row}><View><AppText style={styles.title}>Weekly volume</AppText><AppText style={{ color: colors.textMuted }}>{Math.round(data.weeks.at(-1)!.totalKg).toLocaleString()} kg working volume</AppText></View></View>
          {Object.entries(data.weeks.at(-1)!.muscleGroups).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([group, volume]) => <View key={group} style={styles.row}><AppText>{group.replaceAll('_', ' ')}</AppText><AppText style={{ fontWeight: '700' }}>{Math.round(volume).toLocaleString()} kg</AppText></View>)}
          {data.signal.kind !== 'none' ? <AppText style={{ color: colors.warning }}>{data.signal.message}</AppText> : null}
        </Card>
      ) : null}
      <View style={styles.list}>
        {data?.workouts.map((workout) => (
          <Link key={workout.id} href={{ pathname: '/workouts/[id]', params: { id: workout.id } }} asChild>
            <Pressable>
              <Card>
                <View style={styles.row}><AppText style={styles.title}>{workout.title}</AppText><AppText style={{ color: colors.textMuted }}>{formatShortDate(workout.completedAt ?? workout.performedOn)}</AppText></View>
                <AppText style={{ color: colors.textMuted }}>{workout.exerciseCount} exercise · {workout.setCount} sets · {Math.round(workout.totalVolumeKg).toLocaleString()} kg</AppText>
              </Card>
            </Pressable>
          </Link>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  title: { ...typography.bodyLarge, fontWeight: '700', flex: 1 },
});
