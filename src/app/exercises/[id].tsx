import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, Button, Card, Pill, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { getExerciseSessionHistory } from '@/lib/db';
import { detectExercisePlateau, muscleGroupLabel } from '@/lib/progression';
import { summarizeExerciseHistory } from '@/lib/training/history';
import { buildExerciseWeeklyTrend, PROGRESS_CHART_RANGES, type ExerciseWeeklyTrendPoint, type ProgressChartRange } from '@/lib/training/progress-charts';
import { formatShortDate } from '@/lib/time';
import { radii, spacing, typography, useJienTheme } from '@/theme';

export default function ExerciseHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const { width } = useWindowDimensions();
  const [chartRange, setChartRange] = useState<ProgressChartRange>(12);
  const loader = useCallback(() => id ? getExerciseSessionHistory(db, id, 600) : Promise.resolve(null), [db, id]);
  const { data, error, loading, reload } = useScreenData(loader);
  const summary = useMemo(() => summarizeExerciseHistory(data?.sessions ?? []), [data?.sessions]);
  const plateau = useMemo(() => detectExercisePlateau(data?.sessions ?? []), [data?.sessions]);
  const compact = width < 600;
  const weeklyTrend = useMemo(() => data ? buildExerciseWeeklyTrend(
    data.sessions,
    data.targetRepMin,
    data.targetRepMax,
    chartRange,
  ) : [], [chartRange, data]);
  const visibleSessions = data?.sessions.slice(0, 50) ?? [];

  if (loading && !data) return <Screen><StatePanel title="Loading exercise history" body="Reading completed working and failure sets from this device." loading /></Screen>;
  if (error) return <Screen><StatePanel title="Exercise history is unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /></Screen>;
  if (!data) return <Screen><StatePanel title="Exercise not found" body="It may have been removed from this account." actionLabel="Back to training" onAction={() => router.replace('/train')} /></Screen>;

  return (
    <Screen contentContainerStyle={styles.content}>
      <ScreenHeading title={data.exerciseName} eyebrow={`${muscleGroupLabel(data.primaryMuscleGroup)} · ${data.targetRepMin}–${data.targetRepMax} target reps`} />
      {summary.latest ? (
        <Card style={[styles.summaryCard, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
          <View style={styles.summaryHeader}>
            <View style={styles.flex}>
              <AppText style={[styles.kicker, { color: colors.accent }]}>LATEST COMPLETED EXPOSURE</AppText>
              <AppText style={styles.summaryValue}>{formatWork(summary.latest.volumeKg)}</AppText>
            </View>
            <AppText style={[styles.change, { color: summary.changePercent == null ? colors.textMuted : summary.changePercent >= 0 ? colors.success : colors.warning }]}>
              {summary.changePercent == null ? 'Baseline' : formatPercent(summary.changePercent)}
            </AppText>
          </View>
          <AppText style={{ color: colors.textMuted }}>{summary.changePercent == null
            ? 'A second completed session will create a point-to-point comparison.'
            : `Work performed versus the immediately previous ${data.exerciseName} session.`}</AppText>
          <AppText style={[styles.disclaimer, { color: colors.textMuted }]}>Load × reps is training work—not a strength or muscle-growth score.</AppText>
          <AppText style={{ color: colors.textMuted }}>This comparison includes working and failure sets. Drop sets remain in workout totals.</AppText>
        </Card>
      ) : <StatePanel title="No completed history yet" body="Complete working or failure sets for this exercise to start its progression history. Drop sets remain in your workout totals." />}

      {plateau.status === 'plateau' && summary.latest ? (
        <Card accessibilityLabel={`${data.exerciseName} plateau review`} style={[styles.plateauCard, { backgroundColor: colors.warningSoft, borderColor: colors.warning }]}>
          <AppText style={[styles.kicker, { color: colors.warning }]}>PLATEAU REVIEW</AppText>
          <AppText style={styles.plateauTitle}>Three comparable sessions stayed flat</AppText>
          <AppText style={{ color: colors.textMuted }}>
            Top-set reps, load, and weekly {data.exerciseName} work did not increase from {formatShortDate(plateau.windowStart!)} to {formatShortDate(plateau.windowEnd!)}.
          </AppText>
          <AppText style={{ color: colors.textMuted }}>No exercise, set, load, or rep value changes until you choose an option.</AppText>
          <View style={styles.plateauActions}>
            <Button label="Keep going" onPress={() => router.push({ pathname: '/workouts/new', params: { templateWorkoutId: summary.latest!.workoutId, sessionApproach: 'repeat' } })} variant="secondary" />
            <Button label="Swap exercise" onPress={() => router.push({ pathname: '/workouts/plan', params: { sourceWorkoutId: summary.latest!.workoutId, sessionApproach: 'repeat', swapExerciseId: data.exerciseId } } as never)} variant="secondary" />
            <Button label="Ease off" onPress={() => router.push({ pathname: '/workouts/new', params: { templateWorkoutId: summary.latest!.workoutId, sessionApproach: 'ease_off' } })} variant="quiet" />
          </View>
        </Card>
      ) : plateau.status === 'insufficient' && data.sessions.length > 0 ? (
        <StatePanel
          title="Plateau review needs more history"
          body={`${Math.min(plateau.comparableSessionCount, plateau.requiredSessionCount)} of ${plateau.requiredSessionCount} comparable sessions logged. Joint-hold and drop-only sessions stay out of this review.`}
        />
      ) : null}

      {data.sessions.length >= 2 ? (
        <>
          <SectionHeading title="Exercise trends" detail="Weekly logged work and best in-range sets" />
          <Card>
            <ChartRangePicker value={chartRange} onChange={setChartRange} />
            <ExerciseWeeklyCharts exerciseName={data.exerciseName} points={weeklyTrend} targetRepMin={data.targetRepMin} targetRepMax={data.targetRepMax} />
          </Card>
        </>
      ) : data.sessions.length ? <StatePanel title="Log 2 sessions to see a trend" body="One completed session is saved as your baseline. Repeat this exercise to compare weekly work and best sets." /> : null}

      {data.sessions.length ? <SectionHeading title="Completed sessions" detail="Open a session to review or edit the original sets" /> : null}
      <View style={styles.sessionList}>
        {visibleSessions.map((session) => (
          <Link key={session.workoutId} href={{ pathname: '/workouts/[id]', params: { id: session.workoutId } }} asChild>
            <Pressable accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
              <Card>
                <View style={styles.sessionHeader}>
                  <View style={styles.flex}>
                    <AppText style={styles.sessionTitle}>{session.workoutTitle}</AppText>
                    <AppText style={{ color: colors.textMuted }}>{formatShortDate(session.completedAt)} · {session.sets.length} working set{session.sets.length === 1 ? '' : 's'}</AppText>
                  </View>
                  <View style={[styles.sessionEnd, compact && styles.sessionEndCompact]}>
                    <AppText style={styles.sessionWork}>{formatWork(session.volumeKg)}</AppText>
                    <AppText style={{ color: colors.accent, fontWeight: '700' }}>Review · Edit</AppText>
                  </View>
                </View>
                <View style={styles.setList}>
                  {session.sets.map((set, index) => (
                    <View key={set.id} style={[styles.setRow, { borderTopColor: colors.border }]}>
                      <AppText style={[styles.setIndex, { color: colors.textMuted }]}>{index + 1}</AppText>
                      <AppText style={styles.setValue}>{formatNumber(set.loadValue)} {set.loadUnit} × {set.reps}</AppText>
                      <AppText style={{ color: colors.textMuted }}>{set.kind === 'failure' ? 'To failure · ' : ''}{set.rpe == null ? 'RPE —' : `RPE ${formatNumber(set.rpe)}`}</AppText>
                    </View>
                  ))}
                </View>
              </Card>
            </Pressable>
          </Link>
        ))}
      </View>
      {data.sessions.length > visibleSessions.length ? <AppText style={{ color: colors.textMuted }}>Showing the 50 most recent sessions. Charts include all {data.sessions.length} loaded sessions.</AppText> : null}

      {summary.latest ? <Button label="Use latest session as template" onPress={() => router.push({ pathname: '/workouts/new', params: { templateWorkoutId: summary.latest!.workoutId } })} variant="secondary" /> : null}
      <Button label="Back to training" onPress={() => router.replace('/train')} variant="quiet" />
    </Screen>
  );
}

function ChartRangePicker({ value, onChange }: { value: ProgressChartRange; onChange: (value: ProgressChartRange) => void }) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel="Chart time range" style={styles.rangePicker}>
      {PROGRESS_CHART_RANGES.map((range) => <Pill key={range} label={`${range} weeks`} active={value === range} onPress={() => onChange(range)} />)}
    </View>
  );
}

function ExerciseWeeklyCharts({
  exerciseName,
  points,
  targetRepMin,
  targetRepMax,
}: {
  exerciseName: string;
  points: ExerciseWeeklyTrendPoint[];
  targetRepMin: number;
  targetRepMax: number;
}) {
  const { colors } = useJienTheme();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(520, width - spacing.xl * 4, points.length * 28);
  const plotHeight = 136;
  const inset = 14;
  const maximumVolume = Math.max(1, ...points.map((point) => point.volumeKg));
  const maximumLoad = Math.max(1, ...points.map((point) => point.bestLoadKg ?? 0));
  const loadCoordinates = points.map((point, index) => ({
    point,
    x: inset + (points.length <= 1 ? 0 : index / (points.length - 1) * (chartWidth - inset * 2)),
    y: inset + (1 - (point.bestLoadKg ?? 0) / maximumLoad) * (plotHeight - inset * 2),
  }));
  const latestBest = points.findLast((point) => point.bestLoadKg != null);
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <View style={styles.chartStack}>
      <View style={styles.chartBlock}>
        <SectionHeading title="Weekly volume" detail="Working and failure sets" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalChartContent}>
          <View accessibilityLabel={`${exerciseName} weekly volume over ${points.length} weeks`} style={[styles.weeklyBarPlot, { width: chartWidth }]}>
            {points.map((point, index) => (
              <View key={point.week} style={styles.weeklyBarColumn}>
                <View style={[styles.weeklyBarTrack, { backgroundColor: colors.surfaceMuted }]}>
                  <View style={[styles.weeklyBar, {
                    height: point.volumeKg ? `${Math.max(4, point.volumeKg / maximumVolume * 100)}%` : 0,
                    backgroundColor: index === points.length - 1 ? colors.accent : colors.wood,
                  }]} />
                </View>
                <AppText style={[styles.axisLabel, { color: colors.textMuted }]}>{index % labelEvery === 0 || index === points.length - 1 ? formatWeek(point.week) : ''}</AppText>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
      <View style={styles.chartBlock}>
        <SectionHeading
          title="Best set in target range"
          detail={latestBest ? `${formatNumber(latestBest.bestLoadKg!)} kg × ${latestBest.bestReps} reps latest` : `No ${targetRepMin}–${targetRepMax} rep set in this range`}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalChartContent}>
          <View accessibilityLabel={`${exerciseName} heaviest logged set from ${targetRepMin} to ${targetRepMax} reps over ${points.length} weeks`} style={[styles.linePlot, { width: chartWidth, height: plotHeight }]}>
            {loadCoordinates.slice(0, -1).map((current, index) => {
              const next = loadCoordinates[index + 1]!;
              if (current.point.bestLoadKg == null || next.point.bestLoadKg == null) return null;
              const deltaX = next.x - current.x;
              const deltaY = next.y - current.y;
              const length = Math.sqrt(deltaX ** 2 + deltaY ** 2);
              const angle = Math.atan2(deltaY, deltaX);
              return <View key={`${current.point.week}-line`} style={[styles.lineSegment, {
                backgroundColor: colors.wood,
                left: (current.x + next.x - length) / 2,
                top: (current.y + next.y) / 2,
                width: length,
                transform: [{ rotate: `${angle}rad` }],
              }]} />;
            })}
            {loadCoordinates.map(({ point, x, y }, index) => point.bestLoadKg == null ? null : (
              <View key={point.week} accessibilityLabel={`${formatWeek(point.week)} ${formatNumber(point.bestLoadKg)} kilograms for ${point.bestReps} reps`} style={[styles.lineDot, {
                backgroundColor: index === points.length - 1 ? colors.accent : colors.wood,
                borderColor: colors.surfaceRaised,
                left: x - 5,
                top: y - 5,
              }]} />
            ))}
            {points.map((point, index) => (index % labelEvery === 0 || index === points.length - 1) ? <AppText key={`${point.week}-label`} style={[styles.lineAxisLabel, { color: colors.textMuted, left: loadCoordinates[index]!.x - 18 }]}>{formatWeek(point.week)}</AppText> : null)}
          </View>
        </ScrollView>
        <AppText style={[styles.disclaimer, { color: colors.textMuted }]}>Heaviest logged load inside the configured rep range. This is recorded training—not a max-effort estimate.</AppText>
      </View>
    </View>
  );
}

function formatWork(value: number): string {
  return `${Math.round(value).toLocaleString()} kg·reps`;
}

function formatWeek(value: string): string {
  const week = value.split('-W')[1];
  return week ? `W${Number(week)}` : value;
}

function formatPercent(value: number): string {
  const rounded = Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${value > 0 ? '+' : ''}${rounded}%`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 900, alignSelf: 'center' },
  flex: { flex: 1 },
  summaryCard: { padding: spacing.lg },
  summaryHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  kicker: { ...typography.caption, fontWeight: '800', letterSpacing: 0.6 },
  summaryValue: { ...typography.title, fontWeight: '800', fontVariant: ['tabular-nums'] },
  change: { ...typography.section, fontWeight: '800', fontVariant: ['tabular-nums'] },
  disclaimer: { ...typography.caption },
  plateauCard: { padding: spacing.lg },
  plateauTitle: { ...typography.section, fontWeight: '800' },
  plateauActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  rangePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chartStack: { gap: spacing.lg },
  chartBlock: { gap: spacing.xs },
  horizontalChartContent: { minWidth: '100%' },
  weeklyBarPlot: { height: 164, flexDirection: 'row', alignItems: 'flex-end', paddingTop: spacing.sm },
  weeklyBarColumn: { flex: 1, minWidth: 22, alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xxs },
  weeklyBarTrack: { width: '64%', minWidth: 8, maxWidth: 28, height: 124, borderRadius: radii.compact, justifyContent: 'flex-end', overflow: 'hidden' },
  weeklyBar: { width: '100%', minHeight: 0, borderRadius: radii.compact },
  axisLabel: { ...typography.caption, height: 20, minWidth: 28, textAlign: 'center', fontVariant: ['tabular-nums'] },
  linePlot: { position: 'relative', borderBottomWidth: StyleSheet.hairlineWidth },
  lineSegment: { position: 'absolute', height: 2 },
  lineDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  lineAxisLabel: { position: 'absolute', bottom: 0, width: 36, textAlign: 'center', ...typography.caption, fontVariant: ['tabular-nums'] },
  sessionList: { gap: spacing.sm },
  sessionHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: spacing.sm },
  sessionTitle: { ...typography.bodyLarge, fontWeight: '700' },
  sessionEnd: { alignItems: 'flex-end' },
  sessionEndCompact: { width: '100%', alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sessionWork: { fontWeight: '800', fontVariant: ['tabular-nums'] },
  setList: { gap: spacing.xxs },
  setRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  setIndex: { width: 24, fontVariant: ['tabular-nums'] },
  setValue: { flex: 1, fontWeight: '700', fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.68 },
});
