import { Link, useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, ProgressBar, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { getWorkoutProgressComparison, listRecentWorkouts, listUpcomingPlannedWorkouts, listVolumeHistory } from '@/lib/db';
import { aggregateWeeklyVolume, buildMuscleGroupAdvisory, buildMuscleGroupTrends, muscleGroupLabel, type MuscleGroupAdvisory, type MuscleGroupTrend, type WeeklyVolume } from '@/lib/progression';
import { formatShortDate, formatTime } from '@/lib/time';
import { filterWorkoutHistory, groupWorkoutHistoryByMonth } from '@/lib/training/history';
import { radii, spacing, typography, useJienTheme } from '@/theme';

export default function TrainScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const [trainingView, setTrainingView] = useState<'overview' | 'history'>('overview');
  const [showAllMuscles, setShowAllMuscles] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyMuscle, setHistoryMuscle] = useState<string | null>(null);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(12);
  const [showAllHistoryMuscles, setShowAllHistoryMuscles] = useState(false);
  const loader = useCallback(async () => {
    const [workouts, planned, volumeSets, progress] = await Promise.all([
      listRecentWorkouts(db, 100),
      listUpcomingPlannedWorkouts(db),
      listVolumeHistory(db),
      getWorkoutProgressComparison(db),
    ]);
    const weeks = aggregateWeeklyVolume(volumeSets);
    return {
      workouts,
      planned,
      weeks,
      advisory: buildMuscleGroupAdvisory(volumeSets),
      muscleTrends: buildMuscleGroupTrends(weeks),
      progress,
    };
  }, [db]);
  const { data, error, loading, reload } = useScreenData(loader);
  const filteredHistory = useMemo(
    () => filterWorkoutHistory(data?.workouts ?? [], historyQuery, historyMuscle),
    [data?.workouts, historyMuscle, historyQuery],
  );
  const filterActive = Boolean(historyQuery.trim() || historyMuscle);
  const visibleHistory = filterActive ? filteredHistory : filteredHistory.slice(0, visibleHistoryCount);
  const historyGroups = useMemo(() => groupWorkoutHistoryByMonth(visibleHistory), [visibleHistory]);
  const historyMuscles = useMemo(() => [...new Set((data?.workouts ?? []).flatMap((workout) => workout.muscleGroups))]
    .sort((a, b) => muscleGroupLabel(a).localeCompare(muscleGroupLabel(b))), [data?.workouts]);
  const visibleHistoryMuscles = useMemo(() => {
    if (showAllHistoryMuscles) return historyMuscles;
    const primary = historyMuscles.slice(0, 7);
    return historyMuscle && !primary.includes(historyMuscle) ? [...primary, historyMuscle] : primary;
  }, [historyMuscle, historyMuscles, showAllHistoryMuscles]);

  return (
    <Screen>
      <ScreenHeading title="Training" action={<Button icon="barbell-outline" label="Log workout" onPress={() => router.push('/workouts/new')} />} />
      <View style={styles.trainingTools}>
        <Button icon="calendar-outline" label="Plan workout" onPress={() => router.push('/workouts/plan' as never)} variant="secondary" />
        <Button icon="options-outline" label="Exercise targets" onPress={() => router.push('/exercises' as never)} variant="quiet" />
      </View>
      <View accessibilityRole="tablist" style={[styles.viewSwitcher, { backgroundColor: colors.surfaceMuted }]}>
        <Pill label="Overview" active={trainingView === 'overview'} onPress={() => setTrainingView('overview')} />
        <Pill label={data?.workouts.length ? `History ${data.workouts.length}` : 'History'} active={trainingView === 'history'} onPress={() => setTrainingView('history')} />
      </View>
      {loading && !data ? <StatePanel title="Loading workouts" body="Reading your on-device history." loading /> : null}
      {error ? <StatePanel title="Workouts are unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /> : null}
      {!loading && !error && data?.workouts.length === 0 && data.planned.length === 0 ? <StatePanel title="No workouts yet" body="Plan the work ahead or start with one exercise and record the sets you completed." actionLabel="Plan your first workout" onAction={() => router.push('/workouts/plan' as never)} /> : null}
      {trainingView === 'overview' ? <>
      {data ? <MuscleAdvisoryCard advisory={data.advisory} onPlan={() => router.push({ pathname: '/workouts/plan', params: { source: 'advisory' } } as never)} onLog={() => router.push('/workouts/new')} /> : null}
      {data?.planned.length ? <>
        <SectionHeading title="Workout plans" detail={`${data.planned.length} saved session${data.planned.length === 1 ? '' : 's'}`} />
        <View style={styles.list}>{data.planned.map((workout) => (
          <Link key={workout.id} href={{ pathname: '/workouts/[id]', params: { id: workout.id } }} asChild>
            <Pressable><Card style={{ backgroundColor: colors.accentSoft, borderColor: colors.accent }}>
              <View style={styles.row}><AppText style={styles.title}>{workout.title}</AppText><AppText style={{ color: colors.accent, fontWeight: '700' }}>{workout.scheduledAt ? `${formatShortDate(workout.scheduledAt)} · ${formatTime(workout.scheduledAt)}` : 'No set time'}</AppText></View>
              <View style={styles.upcomingFooter}><AppText style={{ color: colors.textMuted }}>{workout.exerciseCount} exercise{workout.exerciseCount === 1 ? '' : 's'} · {workout.setCount} target sets</AppText><AppText style={{ color: colors.accent, fontWeight: '700' }}>Open plan ›</AppText></View>
            </Card></Pressable>
          </Link>
        ))}</View>
      </> : null}
      {data?.progress ? (
        <Card style={[styles.progressCard, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
          <AppText style={[styles.kicker, { color: colors.accent }]}>RECENT EXERCISE CHECK</AppText>
          {data.progress.overallChangePercent == null ? (
            <>
              <AppText style={styles.progressValue}>Baseline saved</AppText>
              <AppText style={{ color: colors.textMuted }}>A recent baseline appears after you repeat one of these exercises.</AppText>
            </>
          ) : (
            <>
              <AppText style={[styles.progressValue, { color: data.progress.overallChangePercent >= 0 ? colors.success : colors.warning }]}> 
                {formatPercent(data.progress.overallChangePercent)}
              </AppText>
              <AppText style={{ color: colors.textMuted }}>Load × reps versus each exercise’s median across up to three prior matching sessions · {data.progress.improvedExerciseCount} of {data.progress.comparableExerciseCount} repeated exercises up</AppText>
              <View style={styles.comparisonGrid}>
                <View style={[styles.comparisonMetric, { backgroundColor: colors.surfaceRaised }]}> 
                  <AppText style={[styles.comparisonLabel, { color: colors.textMuted }]}>Recent baseline work</AppText>
                  <AppText style={styles.comparisonValue}>{formatWork(data.progress.baselineComparableVolumeKg)}</AppText>
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
              <Link key={exercise.exerciseId} href={{ pathname: '/exercises/[id]', params: { id: exercise.exerciseId } } as never} asChild>
                <Pressable accessibilityLabel={`Open ${exercise.exerciseName} history`} style={({ pressed }) => [styles.exerciseHistoryRow, { borderTopColor: colors.border }, pressed && styles.pressed]}>
                  <View style={styles.flex}>
                    <AppText>{exercise.exerciseName}</AppText>
                    <AppText style={[styles.exerciseWork, { color: colors.textMuted }]}>
                      {exercise.baselineVolumeKg == null
                        ? `${formatWork(exercise.currentVolumeKg)} baseline`
                        : `${formatWork(exercise.baselineVolumeKg)} median (${exercise.baselineSessionCount}) → ${formatWork(exercise.currentVolumeKg)}`}
                    </AppText>
                  </View>
                  <View style={styles.exerciseHistoryEnd}>
                    <AppText style={{ color: exercise.changePercent == null ? colors.textMuted : exercise.changePercent >= 0 ? colors.success : colors.warning, fontWeight: '700' }}>
                      {exercise.changePercent == null ? 'baseline' : formatPercent(exercise.changePercent)}
                    </AppText>
                    <AppText style={{ color: colors.accent, fontWeight: '700' }}>History ›</AppText>
                  </View>
                </Pressable>
              </Link>
            ))}
          </View>
          <Button label="Use as next-session template" onPress={() => router.push({ pathname: '/workouts/new', params: { templateWorkoutId: data.progress!.workoutId } })} variant="secondary" />
        </Card>
      ) : null}
      {data?.weeks.at(-1) ? (
        <Card>
          <View style={styles.row}><View><AppText style={styles.title}>Load and rep detail</AppText><AppText style={{ color: colors.textMuted }}>{formatWork(data.weeks.at(-1)!.totalKg)} this logged week</AppText></View></View>
          <WeeklyWorkTrend weeks={data.weeks} />
          <AppText style={[styles.chartNote, { color: colors.textMuted }]}>This is completed working-set load × reps, not a strength or muscle-growth score.</AppText>
        </Card>
      ) : null}
      {data?.muscleTrends.length ? <>
        <SectionHeading title="Muscle-group coverage" detail="Completed working-set credits by muscle" />
        <Card>
          <View style={styles.muscleGrid}>
            {(showAllMuscles ? data.muscleTrends : data.muscleTrends.slice(0, 6)).map((trend) => (
              <MuscleTrendCard key={trend.muscleGroup} trend={trend} recentWeekCount={Math.min(4, data.weeks.length)} />
            ))}
          </View>
          {data.muscleTrends.length > 6 ? <Button label={showAllMuscles ? 'Show main areas' : `Show all ${data.muscleTrends.length} areas`} onPress={() => setShowAllMuscles((value) => !value)} variant="quiet" /> : null}
          <AppText style={[styles.chartNote, { color: colors.textMuted }]}>One primary working set counts as 1.0; each tagged assisting muscle counts as 0.5. Exercise angles stay in the log, while related regions are pooled only in the next-workout focus.</AppText>
          <Button label="Explain this month" onPress={() => router.push({ pathname: '/wellness', params: { trainingReview: '1' } } as never)} variant="secondary" />
        </Card>
      </> : null}
      </> : null}
      {trainingView === 'history' ? <>
      {data?.workouts.length ? <>
        <SectionHeading title="Workout history" detail={`${filteredHistory.length} matching saved session${filteredHistory.length === 1 ? '' : 's'}`} />
        <Card style={{ backgroundColor: colors.surfaceMuted }}>
          <Field label="Find a workout or exercise" value={historyQuery} onChangeText={setHistoryQuery} placeholder="Try push, cable row, chest…" returnKeyType="search" />
          {historyMuscles.length ? <View style={styles.historyFilters}>
            <Pill label="All muscles" active={historyMuscle == null} onPress={() => setHistoryMuscle(null)} />
            {visibleHistoryMuscles.map((group) => <Pill key={group} label={muscleGroupLabel(group)} active={historyMuscle === group} onPress={() => setHistoryMuscle(group)} />)}
          </View> : null}
          <View style={styles.historyFilterActions}>
            {historyMuscles.length > 7 ? <Button label={showAllHistoryMuscles ? 'Show fewer muscles' : `Show all ${historyMuscles.length} muscles`} onPress={() => setShowAllHistoryMuscles((value) => !value)} variant="quiet" /> : null}
            {filterActive ? <Button label="Clear filters" onPress={() => { setHistoryQuery(''); setHistoryMuscle(null); }} variant="quiet" /> : null}
          </View>
        </Card>
      </> : null}
      {historyGroups.map((group) => (
        <View key={group.month} style={styles.historyMonth}>
          <SectionHeading title={formatHistoryMonth(group.month)} detail={`${group.workouts.length} session${group.workouts.length === 1 ? '' : 's'}`} />
          <View style={styles.list}>
            {group.workouts.map((workout) => (
              <Link key={workout.id} href={{ pathname: '/workouts/[id]', params: { id: workout.id } }} asChild>
                <Pressable accessibilityLabel={`Open ${workout.title} from ${formatShortDate(workout.completedAt ?? workout.performedOn)}`} style={({ pressed }) => pressed && styles.pressed}>
                  <Card>
                    <View style={styles.row}><AppText style={styles.title}>{workout.title}</AppText><AppText style={{ color: colors.textMuted }}>{formatShortDate(workout.completedAt ?? workout.performedOn)}{workout.completedAt ? ` · ${formatTime(workout.completedAt)}` : ''}</AppText></View>
                    <AppText style={{ color: colors.textMuted }}>{workout.exerciseCount} exercise{workout.exerciseCount === 1 ? '' : 's'} · {workout.setCount} sets · {formatWork(workout.totalVolumeKg)}</AppText>
                    {workout.exerciseNames.length ? <AppText style={[styles.exerciseNames, { color: colors.textMuted }]}>{workout.exerciseNames.join(' · ')}</AppText> : null}
                    {workout.muscleGroups.length ? <View style={styles.workoutTags}>{workout.muscleGroups.slice(0, 5).map((groupName) => <Pill key={groupName} label={muscleGroupLabel(groupName)} />)}</View> : null}
                  </Card>
                </Pressable>
              </Link>
            ))}
          </View>
        </View>
      ))}
      {data?.workouts.length && filteredHistory.length === 0 ? <StatePanel title="No matching sessions" body="Try another workout name, exercise, or muscle filter." actionLabel="Clear filters" onAction={() => { setHistoryQuery(''); setHistoryMuscle(null); }} /> : null}
      {!filterActive && visibleHistory.length < filteredHistory.length ? <Button label={`Load ${Math.min(12, filteredHistory.length - visibleHistory.length)} older sessions`} onPress={() => setVisibleHistoryCount((count) => count + 12)} variant="secondary" /> : null}
      </> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  trainingTools: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  viewSwitcher: { alignSelf: 'flex-start', flexDirection: 'row', gap: spacing.xs, borderRadius: radii.pill, padding: spacing.xxs },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  upcomingFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { ...typography.bodyLarge, fontWeight: '700', flex: 1 },
  flex: { flex: 1 },
  progressCard: { padding: spacing.lg },
  advisoryCard: { padding: spacing.lg, gap: spacing.sm },
  advisoryTitle: { ...typography.title, fontWeight: '800', letterSpacing: -0.4 },
  advisoryFocus: { gap: spacing.xxs },
  advisoryRow: { minHeight: 56, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.xs },
  kicker: { ...typography.caption, fontWeight: '800', letterSpacing: 0.6 },
  progressValue: { ...typography.display, fontWeight: '800', letterSpacing: -0.7 },
  exerciseProgressList: { gap: spacing.xs, marginTop: spacing.xs },
  exerciseHistoryRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.xs },
  exerciseHistoryEnd: { alignItems: 'flex-end' },
  comparisonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  comparisonMetric: { flexGrow: 1, flexBasis: 220, minWidth: 180, borderRadius: radii.control, padding: spacing.md },
  comparisonLabel: { ...typography.caption, fontWeight: '700' },
  comparisonValue: { ...typography.bodyLarge, fontWeight: '800', fontVariant: ['tabular-nums'] },
  exerciseWork: { ...typography.caption, fontVariant: ['tabular-nums'] },
  muscleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  muscleCard: { flexGrow: 1, flexBasis: 250, minWidth: 220, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, gap: spacing.sm },
  muscleHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  muscleMetric: { ...typography.section, fontWeight: '800', fontVariant: ['tabular-nums'] },
  muscleBars: { gap: spacing.xs },
  muscleBarRow: { gap: spacing.xxs },
  muscleBarLabel: { ...typography.caption, fontVariant: ['tabular-nums'] },
  workoutTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  exerciseNames: { ...typography.caption },
  historyFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  historyFilterActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  historyMonth: { gap: spacing.sm },
  trendPlot: { minHeight: 172, flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, paddingTop: spacing.lg },
  trendColumn: { flex: 1, minWidth: 36, alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs },
  trendValue: { ...typography.caption, fontWeight: '700', fontVariant: ['tabular-nums'] },
  trendTrack: { width: '72%', maxWidth: 56, minWidth: 20, height: 112, borderRadius: radii.compact, justifyContent: 'flex-end', overflow: 'hidden' },
  trendBar: { width: '100%', minHeight: spacing.xs, borderRadius: radii.compact },
  trendWeek: { ...typography.caption, fontVariant: ['tabular-nums'] },
  chartNote: { ...typography.caption },
  pressed: { opacity: 0.68 },
});

function formatPercent(value: number): string {
  const rounded = Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${value > 0 ? '+' : ''}${rounded}%`;
}

function MuscleTrendCard({ trend, recentWeekCount }: { trend: MuscleGroupTrend; recentWeekCount: number }) {
  const { colors } = useJienTheme();
  const maximumSets = Math.max(trend.currentSetEquivalents, trend.previousSetEquivalents, 1);
  const tone = trend.status === 'down' || trend.status === 'inactive'
    ? colors.warning
    : trend.status === 'up' || trend.status === 'new'
      ? colors.success
      : colors.accent;
  return (
    <View style={[styles.muscleCard, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
      <View style={styles.muscleHeader}>
        <AppText style={styles.title}>{trend.label}</AppText>
        <AppText style={{ color: tone, fontWeight: '700' }}>{muscleStatusLabel(trend)}</AppText>
      </View>
      <View>
        <AppText style={styles.muscleMetric}>{formatSetEquivalents(trend.currentSetEquivalents)}</AppText>
        <AppText style={{ color: colors.textMuted }}>weighted working sets · {trend.activeWeeks}/{recentWeekCount} weeks</AppText>
      </View>
      <View style={styles.muscleBars}>
        <View style={styles.muscleBarRow}>
          <AppText style={[styles.muscleBarLabel, { color: colors.textMuted }]}>Previous {formatSetEquivalents(trend.previousSetEquivalents)}</AppText>
          <ProgressBar value={trend.previousSetEquivalents / maximumSets} color={colors.wood} />
        </View>
        <View style={styles.muscleBarRow}>
          <AppText style={[styles.muscleBarLabel, { color: colors.textMuted }]}>Latest {formatSetEquivalents(trend.currentSetEquivalents)}</AppText>
          <ProgressBar value={trend.currentSetEquivalents / maximumSets} color={tone} />
        </View>
      </View>
      <AppText style={{ color: colors.textMuted }}>{trend.setChangePercent == null ? 'New set baseline' : `${formatPercent(trend.setChangePercent)} set credits versus prior logged week`}</AppText>
    </View>
  );
}

function muscleStatusLabel(trend: MuscleGroupTrend): string {
  if (trend.status === 'new') return 'New baseline';
  if (trend.status === 'up') return 'More sets';
  if (trend.status === 'down') return 'Down 20%+';
  if (trend.status === 'inactive') return 'Not this week';
  if (trend.status === 'partial') return 'Week in progress';
  return 'Steady';
}

function formatSetEquivalents(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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

function formatHistoryMonth(value: string): string {
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

function MuscleAdvisoryCard({ advisory, onPlan, onLog }: { advisory: MuscleGroupAdvisory; onPlan: () => void; onLog: () => void }) {
  const { colors } = useJienTheme();
  const headline = advisory.status === 'focus'
    ? `Focus next on ${formatFocusNames(advisory.focus.map((item) => item.label))}`
    : advisory.status === 'recovery'
      ? 'Your largest coverage gaps were trained recently'
      : advisory.status === 'covered'
        ? 'Usual weekly muscle coverage reached'
        : 'Complete another training week to establish your usual coverage';
  const detail = advisory.status === 'focus'
    ? `These muscles are furthest below your ${advisory.baselineWeekCount}-week set-credit average and were not trained in the last 48 hours.`
    : advisory.status === 'recovery'
      ? 'Use your current soreness, joint status, and recovery before repeating them. No load or set change is applied automatically.'
      : advisory.status === 'covered'
        ? `Every recently trained muscle is at or above its ${advisory.baselineWeekCount}-week set-credit average.`
        : 'The guidance needs at least one completed calendar week. Exercise-specific load and rep suggestions remain available now.';
  return (
    <Card style={[styles.advisoryCard, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
      <AppText style={[styles.kicker, { color: colors.accent }]}>NEXT WORKOUT</AppText>
      <AppText style={styles.advisoryTitle}>{headline}</AppText>
      <AppText style={{ color: colors.textMuted }}>{detail}</AppText>
      {advisory.focus.length ? <View style={styles.advisoryFocus}>
        {advisory.focus.map((item) => (
          <View key={item.muscleGroup} style={[styles.advisoryRow, { borderTopColor: colors.border }]}>
            <View style={styles.flex}><AppText style={{ fontWeight: '700' }}>{item.label}</AppText><AppText style={{ color: colors.textMuted }}>{formatSetEquivalents(item.currentSetCredits)} this week · {formatSetEquivalents(item.baselineSetCredits)} usual</AppText></View>
            <AppText style={{ color: item.trainedWithin48Hours ? colors.warning : colors.accent, fontWeight: '700' }}>{item.trainedWithin48Hours ? 'Trained recently' : `${formatSetEquivalents(item.remainingSetCredits)} sets behind`}</AppText>
          </View>
        ))}
      </View> : null}
      <View style={styles.trainingTools}>
        <Button label={advisory.status === 'focus' ? 'Plan from this focus' : 'Plan next workout'} onPress={onPlan} variant="secondary" />
        <Button label="Log workout" onPress={onLog} variant="quiet" />
      </View>
      <AppText style={[styles.chartNote, { color: colors.textMuted }]}>Muscle guidance uses set credits, not cross-exercise weight totals. Primary targets count 1.0 and assisting targets 0.5.</AppText>
    </Card>
  );
}

function formatFocusNames(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? 'your usual muscle groups';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]}, ${labels[1]}, and ${labels[2]}`;
}
