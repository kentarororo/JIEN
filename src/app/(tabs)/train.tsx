import { Link, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { getWorkoutProgressComparison, listRecentWorkouts, listUpcomingPlannedWorkouts, listVolumeHistory } from '@/lib/db';
import { aggregateWeeklyVolume, detectDeloadSignal, type WeeklyVolume } from '@/lib/progression';
import { formatShortDate, formatTime } from '@/lib/time';
import { radii, spacing, typography, useJienTheme } from '@/theme';

export default function TrainScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const loader = useCallback(async () => {
    const [workouts, planned, volumeSets, progress] = await Promise.all([
      listRecentWorkouts(db),
      listUpcomingPlannedWorkouts(db),
      listVolumeHistory(db),
      getWorkoutProgressComparison(db),
    ]);
    const weeks = aggregateWeeklyVolume(volumeSets);
    return { workouts, planned, weeks, progress, signal: detectDeloadSignal(weeks.map((week) => week.totalKg)) };
  }, [db]);
  const { data, error, loading, reload } = useScreenData(loader);

  return (
    <Screen>
      <ScreenHeading title="Training" eyebrow="Machine-first log" action={<View style={styles.headerActions}><Button label="Plan" onPress={() => router.push('/workouts/plan' as never)} variant="secondary" /><Button label="Log" onPress={() => router.push('/workouts/new')} /></View>} />
      {loading && !data ? <StatePanel title="Loading workouts" body="Reading your on-device history." loading /> : null}
      {error ? <StatePanel title="Workouts are unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /> : null}
      {!loading && !error && data?.workouts.length === 0 && data.planned.length === 0 ? <StatePanel title="No workouts yet" body="Plan the work ahead or start with one exercise and record the sets you completed." actionLabel="Plan your first workout" onAction={() => router.push('/workouts/plan' as never)} /> : null}
      {data?.planned.length ? <>
        <SectionHeading title="Upcoming" detail="Calendar-backed sessions" />
        <View style={styles.list}>{data.planned.map((workout) => (
          <Link key={workout.id} href={{ pathname: '/workouts/[id]', params: { id: workout.id } }} asChild>
            <Pressable><Card style={{ backgroundColor: colors.accentSoft, borderColor: colors.accent }}>
              <View style={styles.row}><AppText style={styles.title}>{workout.title}</AppText><AppText style={{ color: colors.accent, fontWeight: '700' }}>{workout.scheduledAt ? `${formatShortDate(workout.scheduledAt)} · ${formatTime(workout.scheduledAt)}` : formatShortDate(workout.performedOn)}</AppText></View>
              <AppText style={{ color: colors.textMuted }}>{workout.exerciseCount} exercise{workout.exerciseCount === 1 ? '' : 's'} · {workout.setCount} target sets · review or start</AppText>
            </Card></Pressable>
          </Link>
        ))}</View>
      </> : null}
      {data?.progress ? (
        <Card style={[styles.progressCard, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
          <AppText style={[styles.kicker, { color: colors.accent }]}>LATEST SESSION PROGRESS</AppText>
          {data.progress.overallChangePercent == null ? (
            <>
              <AppText style={styles.progressValue}>Baseline saved</AppText>
              <AppText style={{ color: colors.textMuted }}>Repeat one of these exercises and JIEN will compare working volume session to session.</AppText>
            </>
          ) : (
            <>
              <AppText style={[styles.progressValue, { color: data.progress.overallChangePercent >= 0 ? colors.success : colors.warning }]}> 
                {formatPercent(data.progress.overallChangePercent)}
              </AppText>
              <AppText style={{ color: colors.textMuted }}>work performed vs each exercise's previous matching session · {data.progress.improvedExerciseCount} of {data.progress.comparableExerciseCount} exercises up</AppText>
              <View style={styles.comparisonGrid}>
                <View style={[styles.comparisonMetric, { backgroundColor: colors.surfaceRaised }]}> 
                  <AppText style={[styles.comparisonLabel, { color: colors.textMuted }]}>Previous matching work</AppText>
                  <AppText style={styles.comparisonValue}>{formatWork(data.progress.previousComparableVolumeKg)}</AppText>
                </View>
                <View style={[styles.comparisonMetric, { backgroundColor: colors.surfaceRaised }]}> 
                  <AppText style={[styles.comparisonLabel, { color: colors.textMuted }]}>This session</AppText>
                  <AppText style={styles.comparisonValue}>{formatWork(data.progress.currentComparableVolumeKg)}</AppText>
                </View>
              </View>
            </>
          )}
          <View style={styles.exerciseProgressList}>
            {data.progress.exercises.slice(0, 6).map((exercise) => (
              <View key={exercise.exerciseId} style={styles.row}>
                <View style={styles.flex}>
                  <AppText>{exercise.exerciseName}</AppText>
                  <AppText style={[styles.exerciseWork, { color: colors.textMuted }]}> 
                    {exercise.previousVolumeKg == null
                      ? `${formatWork(exercise.currentVolumeKg)} baseline`
                      : `${formatWork(exercise.previousVolumeKg)} → ${formatWork(exercise.currentVolumeKg)}`}
                  </AppText>
                </View>
                <AppText style={{ color: exercise.changePercent == null ? colors.textMuted : exercise.changePercent >= 0 ? colors.success : colors.warning, fontWeight: '700' }}>
                  {exercise.changePercent == null ? 'baseline' : formatPercent(exercise.changePercent)}
                </AppText>
              </View>
            ))}
          </View>
          <Button label="Use as next-session template" onPress={() => router.push({ pathname: '/workouts/new', params: { templateWorkoutId: data.progress!.workoutId } })} variant="secondary" />
        </Card>
      ) : null}
      {data?.weeks.at(-1) ? (
        <Card>
          <View style={styles.row}><View><AppText style={styles.title}>Weekly training work</AppText><AppText style={{ color: colors.textMuted }}>{formatWork(data.weeks.at(-1)!.totalKg)} this logged week</AppText></View></View>
          <WeeklyWorkTrend weeks={data.weeks} />
          {Object.entries(data.weeks.at(-1)!.muscleGroups).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([group, volume]) => <View key={group} style={styles.row}><AppText>{group.replaceAll('_', ' ')}</AppText><AppText style={{ fontWeight: '700' }}>{formatWork(volume)}</AppText></View>)}
          {data.signal.kind !== 'none' ? <AppText style={{ color: colors.warning }}>{data.signal.message}</AppText> : null}
          <AppText style={[styles.chartNote, { color: colors.textMuted }]}>This is completed working-set load × reps, not a strength or muscle-growth score.</AppText>
        </Card>
      ) : null}
      {data?.workouts.length ? <SectionHeading title="Workout history" detail="Each card is one saved session" /> : null}
      <View style={styles.list}>
        {data?.workouts.map((workout) => (
          <Link key={workout.id} href={{ pathname: '/workouts/[id]', params: { id: workout.id } }} asChild>
            <Pressable>
              <Card>
                <View style={styles.row}><AppText style={styles.title}>{workout.title}</AppText><AppText style={{ color: colors.textMuted }}>{formatShortDate(workout.completedAt ?? workout.performedOn)}{workout.completedAt ? ` · ${formatTime(workout.completedAt)}` : ''}</AppText></View>
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
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  title: { ...typography.bodyLarge, fontWeight: '700', flex: 1 },
  flex: { flex: 1 },
  progressCard: { padding: spacing.lg },
  kicker: { ...typography.caption, fontWeight: '800', letterSpacing: 0.6 },
  progressValue: { ...typography.display, fontWeight: '800', letterSpacing: -0.7 },
  exerciseProgressList: { gap: spacing.xs, marginTop: spacing.xs },
  comparisonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  comparisonMetric: { flexGrow: 1, flexBasis: 220, minWidth: 180, borderRadius: radii.control, padding: spacing.md },
  comparisonLabel: { ...typography.caption, fontWeight: '700' },
  comparisonValue: { ...typography.bodyLarge, fontWeight: '800', fontVariant: ['tabular-nums'] },
  exerciseWork: { ...typography.caption, fontVariant: ['tabular-nums'] },
  trendPlot: { minHeight: 172, flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, paddingTop: spacing.lg },
  trendColumn: { flex: 1, minWidth: 36, alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs },
  trendValue: { ...typography.caption, fontWeight: '700', fontVariant: ['tabular-nums'] },
  trendTrack: { width: '72%', maxWidth: 56, minWidth: 20, height: 112, borderRadius: radii.compact, justifyContent: 'flex-end', overflow: 'hidden' },
  trendBar: { width: '100%', minHeight: spacing.xs, borderRadius: radii.compact },
  trendWeek: { ...typography.caption, fontVariant: ['tabular-nums'] },
  chartNote: { ...typography.caption },
});

function formatPercent(value: number): string {
  const rounded = Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${value > 0 ? '+' : ''}${rounded}%`;
}

function formatWork(value: number): string {
  return `${Math.round(value).toLocaleString()} kg·reps`;
}

function WeeklyWorkTrend({ weeks }: { weeks: WeeklyVolume[] }) {
  const { colors } = useJienTheme();
  const recent = weeks.slice(-6);
  const maximum = Math.max(...recent.map((week) => week.totalKg), 1);
  return (
    <View accessibilityLabel={`Training work over ${recent.length} logged week${recent.length === 1 ? '' : 's'}`} style={styles.trendPlot}>
      {recent.map((week, index) => {
        const ratio = week.totalKg / maximum;
        const active = index === recent.length - 1;
        return (
          <View key={week.week} style={styles.trendColumn}>
            <AppText style={[styles.trendValue, { color: active ? colors.accent : colors.textMuted }]}>{formatCompactWork(week.totalKg)}</AppText>
            <View style={[styles.trendTrack, { backgroundColor: colors.surfaceRaised }]}>
              <View style={[styles.trendBar, { height: `${Math.max(8, ratio * 100)}%`, backgroundColor: active ? colors.accent : colors.accentSoft }]} />
            </View>
            <AppText style={[styles.trendWeek, { color: active ? colors.text : colors.textMuted }]}>{formatWeek(week.week)}</AppText>
          </View>
        );
      })}
    </View>
  );
}

function formatCompactWork(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

function formatWeek(value: string): string {
  const week = value.split('-W')[1];
  return week ? `W${Number(week)}` : value;
}
