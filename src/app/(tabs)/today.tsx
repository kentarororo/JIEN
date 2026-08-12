import { Link, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, ProgressBar, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { getDashboardSummary } from '@/lib/db';
import { formatShortDate } from '@/lib/time';
import { spacing, typography, useJienTheme } from '@/theme';

export default function TodayScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const loader = useCallback(() => getDashboardSummary(db), [db]);
  const { data, error, loading, reload } = useScreenData(loader);

  if (loading && !data) return <Screen><StatePanel title="Opening your day" body="Loading your local training and nutrition log." loading /></Screen>;
  if (error || !data) return <Screen><StatePanel title="Today is unavailable" body={error ?? 'The summary could not be loaded.'} actionLabel="Try again" onAction={() => void reload()} /></Screen>;

  const calorieTarget = data.nutrition.target?.caloriesKcal ?? 0;
  const proteinTarget = data.nutrition.target?.proteinG ?? 0;
  return (
    <Screen>
      <ScreenHeading eyebrow={new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())} title="Keep the day honest." />

      <View style={styles.actions}>
        <Link href="/workouts/new" asChild><Pressable><Card style={styles.actionCard}><AppText style={styles.actionTitle}>Log a workout</AppText><AppText style={{ color: colors.textMuted }}>Sets, reps, load and effort</AppText></Card></Pressable></Link>
        <Link href="/meals/new" asChild><Pressable><Card style={styles.actionCard}><AppText style={styles.actionTitle}>Log a meal</AppText><AppText style={{ color: colors.textMuted }}>Calories and macros</AppText></Card></Pressable></Link>
      </View>

      <SectionHeading title="This week" detail="Completed training" />
      <Card style={styles.metricCard}>
        <View><AppText style={styles.metric}>{data.workoutCountThisWeek}</AppText><AppText style={{ color: colors.textMuted }}>workouts</AppText></View>
        <View><AppText style={styles.metric}>{Math.round(data.weeklyVolumeKg).toLocaleString()}</AppText><AppText style={{ color: colors.textMuted }}>kg volume</AppText></View>
      </Card>

      {data.workoutProgress ? (
        <Card style={[styles.progressCard, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
          <View style={styles.macroRow}>
            <View style={styles.flex}>
              <AppText style={[styles.kicker, { color: colors.accent }]}>PROGRESSIVE OVERLOAD</AppText>
              <AppText style={styles.progressMetric}>{data.workoutProgress.overallChangePercent == null ? 'Baseline' : formatPercent(data.workoutProgress.overallChangePercent)}</AppText>
            </View>
            <AppText style={{ color: colors.textMuted, textAlign: 'right' }}>{data.workoutProgress.overallChangePercent == null ? 'comparison starts next session' : `${data.workoutProgress.improvedExerciseCount}/${data.workoutProgress.comparableExerciseCount} exercises up`}</AppText>
          </View>
        </Card>
      ) : null}

      {data.latestBodyMeasurement ? (
        <>
          <SectionHeading title="Body baseline" detail="Latest wellness measurement" />
          <Card style={styles.bodyCard}>
            <View><AppText style={styles.metric}>{data.latestBodyMeasurement.bodyWeightKg}</AppText><AppText style={{ color: colors.textMuted }}>kg weight</AppText></View>
            <View><AppText style={styles.metric}>{data.latestBodyMeasurement.heightCm}</AppText><AppText style={{ color: colors.textMuted }}>cm height</AppText></View>
            {data.latestBodyMeasurement.bodyFatPercent != null ? <View><AppText style={styles.metric}>{data.latestBodyMeasurement.bodyFatPercent}%</AppText><AppText style={{ color: colors.textMuted }}>{data.latestBodyMeasurement.bodyFatIsEstimated ? 'estimated' : 'measured'} body fat</AppText></View> : null}
          </Card>
        </>
      ) : null}

      <SectionHeading title="Today’s fuel" detail={data.nutrition.meals.length === 0 ? 'Nothing logged yet' : `${data.nutrition.meals.length} meals logged`} />
      <Card>
        <View style={styles.macroRow}><AppText>Calories</AppText><AppText style={styles.value}>{Math.round(data.nutrition.totals.caloriesKcal)}{calorieTarget ? ` / ${Math.round(calorieTarget)}` : ''} kcal</AppText></View>
        <ProgressBar value={calorieTarget ? data.nutrition.totals.caloriesKcal / calorieTarget : 0} />
        <View style={styles.macroRow}><AppText>Protein</AppText><AppText style={styles.value}>{Math.round(data.nutrition.totals.proteinG)}{proteinTarget ? ` / ${Math.round(proteinTarget)}` : ''} g</AppText></View>
        <ProgressBar value={proteinTarget ? data.nutrition.totals.proteinG / proteinTarget : 0} color={colors.success} />
        {!data.nutrition.target ? <Button label="Set macro targets" onPress={() => router.push('/settings/macros')} variant="secondary" /> : null}
      </Card>

      <SectionHeading title="Last session" />
      {data.latestWorkout ? (
        <Link href={{ pathname: '/workouts/[id]', params: { id: data.latestWorkout.id } }} asChild>
          <Pressable><Card><AppText style={styles.actionTitle}>{data.latestWorkout.title}</AppText><AppText style={{ color: colors.textMuted }}>{formatShortDate(data.latestWorkout.completedAt ?? data.latestWorkout.performedOn)} · {data.latestWorkout.setCount} sets · {Math.round(data.latestWorkout.totalVolumeKg).toLocaleString()} kg</AppText></Card></Pressable>
        </Link>
      ) : <StatePanel title="Your first session starts here" body="Log the work you actually completed. JIEN will build progression guidance from it." actionLabel="Log workout" onAction={() => router.push('/workouts/new')} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: spacing.sm },
  actionCard: { flex: 1, minHeight: 110, justifyContent: 'space-between' },
  actionTitle: { ...typography.bodyLarge, fontWeight: '700' },
  metricCard: { flexDirection: 'row', justifyContent: 'space-around' },
  metric: { ...typography.title, fontWeight: '700' },
  macroRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  value: { fontWeight: '700' },
  flex: { flex: 1 },
  kicker: { ...typography.caption, fontWeight: '800', letterSpacing: 0.6 },
  progressCard: { padding: spacing.lg },
  progressMetric: { ...typography.title, fontWeight: '800' },
  bodyCard: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', gap: spacing.lg },
});

function formatPercent(value: number): string {
  const rounded = Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${value > 0 ? '+' : ''}${rounded}%`;
}
