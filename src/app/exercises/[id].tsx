import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, Button, Card, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { getExerciseSessionHistory } from '@/lib/db';
import { muscleGroupLabel } from '@/lib/progression';
import { summarizeExerciseHistory } from '@/lib/training/history';
import { formatShortDate } from '@/lib/time';
import { radii, spacing, typography, useJienTheme } from '@/theme';

export default function ExerciseHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const { width } = useWindowDimensions();
  const loader = useCallback(() => id ? getExerciseSessionHistory(db, id, 16) : Promise.resolve(null), [db, id]);
  const { data, error, loading, reload } = useScreenData(loader);
  const summary = useMemo(() => summarizeExerciseHistory(data?.sessions ?? []), [data?.sessions]);
  const chartSessions = summary.chronological.slice(width >= 700 ? -12 : -7);
  const chartMaximum = Math.max(1, ...chartSessions.map((session) => session.volumeKg));
  const compact = width < 600;

  if (loading && !data) return <Screen><StatePanel title="Loading exercise history" body="Reading completed working sets from this device." loading /></Screen>;
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
        </Card>
      ) : <StatePanel title="No completed history yet" body="Complete this exercise in a workout and its exact working sets will appear here." />}

      {summary.chronological.length ? (
        <>
          <SectionHeading title="Work trend" detail={`${chartSessions.length} most recent session${chartSessions.length === 1 ? '' : 's'}${chartSessions.length < summary.chronological.length ? ` of ${summary.chronological.length}` : ''}`} />
          <Card>
            <View accessibilityLabel={`${data.exerciseName} work by completed session`} style={styles.trend}>
              {chartSessions.map((session, index) => {
                const ratio = session.volumeKg / chartMaximum;
                const latest = index === chartSessions.length - 1;
                return (
                  <View key={session.workoutId} style={styles.trendColumn}>
                    <AppText style={[styles.trendValue, { color: latest ? colors.accent : colors.textMuted }]}>{formatCompactWork(session.volumeKg)}</AppText>
                    <View style={[styles.trendTrack, { backgroundColor: colors.surfaceMuted }]}>
                      <View style={[styles.trendBar, { height: `${Math.max(8, ratio * 100)}%`, backgroundColor: latest ? colors.accent : colors.wood }]} />
                    </View>
                    <AppText style={[styles.trendDate, { color: colors.textMuted }]}>{formatCompactDate(session.performedOn)}</AppText>
                  </View>
                );
              })}
            </View>
          </Card>
        </>
      ) : null}

      {data.sessions.length ? <SectionHeading title="Completed sessions" detail="Open a session to review or edit the original sets" /> : null}
      <View style={styles.sessionList}>
        {data.sessions.map((session) => (
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
                      <AppText style={{ color: colors.textMuted }}>{set.rpe == null ? 'RPE —' : `RPE ${formatNumber(set.rpe)}`}</AppText>
                    </View>
                  ))}
                </View>
              </Card>
            </Pressable>
          </Link>
        ))}
      </View>

      {summary.latest ? <Button label="Use latest session as template" onPress={() => router.push({ pathname: '/workouts/new', params: { templateWorkoutId: summary.latest!.workoutId } })} variant="secondary" /> : null}
      <Button label="Back to training" onPress={() => router.replace('/train')} variant="quiet" />
    </Screen>
  );
}

function formatWork(value: number): string {
  return `${Math.round(value).toLocaleString()} kg·reps`;
}

function formatCompactWork(value: number): string {
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

function formatCompactDate(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00`);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
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
  trend: { minHeight: 188, flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, paddingTop: spacing.md },
  trendColumn: { flex: 1, minWidth: 34, alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs },
  trendValue: { ...typography.caption, fontWeight: '700', fontVariant: ['tabular-nums'] },
  trendTrack: { width: '72%', maxWidth: 52, minWidth: 18, height: 112, borderRadius: radii.compact, justifyContent: 'flex-end', overflow: 'hidden' },
  trendBar: { width: '100%', minHeight: spacing.xs, borderRadius: radii.compact },
  trendDate: { ...typography.caption, fontVariant: ['tabular-nums'] },
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
