import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, ChoiceCard, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { deleteWorkout, getUserProfile, getWorkoutDetail, getWorkoutProgressComparison, reschedulePlannedWorkout, skipPlannedWorkout } from '@/lib/db';
import { applyStoredJointConsiderationHold, hasStoredJointConsideration } from '@/lib/planning/workout-plan';
import { SESSION_APPROACHES, sessionApproachBody, sessionApproachTitle } from '@/lib/planning/session-approach';
import type { SessionApproach } from '@/lib/db';
import { formatShortDate, formatTime } from '@/lib/time';
import { radii, spacing, typography, useJienTheme } from '@/theme';

export default function WorkoutDetailScreen() {
  const { id, storageWarning } = useLocalSearchParams<{ id: string; storageWarning?: string }>();
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useJienTheme();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [moving, setMoving] = useState(false);
  const [nextApproach, setNextApproach] = useState<SessionApproach | null>(null);
  const loader = useCallback(async () => {
    const [detail, progress, profile] = await Promise.all([
      getWorkoutDetail(db, id),
      getWorkoutProgressComparison(db, id),
      getUserProfile(db),
    ]);
    return {
      detail: detail?.status === 'planned'
        ? {
            ...detail,
            plan: applyStoredJointConsiderationHold(
              detail.plan,
              hasStoredJointConsideration(profile?.injuryFlags),
            ),
          }
        : detail,
      progress,
    };
  }, [db, id]);
  const { data, error, loading, reload } = useScreenData(loader);
  const detail = data?.detail ?? null;
  const groups = useMemo(() => {
    const result = new Map<string, NonNullable<typeof detail>['sets']>();
    detail?.sets.forEach((set) => result.set(set.exerciseName, [...(result.get(set.exerciseName) ?? []), set]));
    return [...result.entries()];
  }, [detail]);

  const removeWorkout = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteWorkout(db, id);
      router.replace('/train');
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'The workout could not be removed.');
      setDeleting(false);
    }
  };

  const skipWorkout = async () => {
    if (skipping) return;
    setSkipping(true);
    setDeleteError(null);
    try {
      await skipPlannedWorkout(db, id);
      router.replace('/train');
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'The planned workout could not be skipped.');
      setSkipping(false);
    }
  };

  const moveWorkoutToTomorrow = async () => {
    if (moving || !detail?.scheduledAt) return;
    setMoving(true);
    setDeleteError(null);
    try {
      const previous = new Date(detail.scheduledAt);
      const next = new Date();
      next.setDate(next.getDate() + 1);
      next.setHours(previous.getHours(), previous.getMinutes(), 0, 0);
      await reschedulePlannedWorkout(db, id, next.toISOString());
      setConfirmSkip(false);
      await reload();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'The planned workout could not be moved.');
    } finally {
      setMoving(false);
    }
  };

  if (loading && !data) return <Screen><StatePanel title="Loading workout" body="Reading this session from your device." loading /></Screen>;
  if (error) return <Screen><StatePanel title="Workout unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /></Screen>;
  if (!detail) return <Screen><StatePanel title="Workout not found" body="It may have been removed from this device." /></Screen>;

  if (detail.status === 'planned') {
    const missed = detail.scheduledAt != null && new Date(detail.scheduledAt).getTime() < Date.now();
    return (
      <Screen contentContainerStyle={styles.screenContent}>
        <ScreenHeading
          title={detail.title}
          eyebrow={detail.scheduledAt ? `Planned · ${formatShortDate(detail.scheduledAt)} · ${formatTime(detail.scheduledAt)}` : 'Planned · No set time'}
        />
        <Card style={[styles.progress, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
          <AppText style={[styles.kicker, { color: colors.accent }]}>WORKOUT PLAN</AppText>
          <AppText style={styles.progressValue}>{detail.plan?.exercises.length ?? 0} exercises</AppText>
          <AppText style={{ color: colors.textMuted }}>{detail.plan?.sessionApproach ? `${sessionApproachTitle(detail.plan.sessionApproach)} · ${sessionApproachBody(detail.plan.sessionApproach)}` : 'Previous completed values are the starting point. Green cues are optional and remain separate until you choose them.'}</AppText>
          {detail.plan?.programContext ? <AppText style={{ color: colors.textMuted }}>{formatSplit(detail.plan.programContext.splitId)} · session {detail.plan.programContext.sessionIndex + 1} · {detail.plan.programContext.availableMinutes} minutes</AppText> : null}
        </Card>
        {missed ? (
          <Card style={{ backgroundColor: colors.warningSoft, borderColor: colors.warning }}>
            <AppText style={[styles.progressName, { color: colors.warning }]}>This planned time has passed</AppText>
            <AppText style={{ color: colors.textMuted }}>{detail.plan?.programContext?.missedSessionPolicy === 'skip' ? 'The saved preference is to mark missed sessions skipped.' : 'The saved preference is to move missed sessions.'} No completed history changes until you choose an action.</AppText>
            {deleteError ? <AppText style={{ color: colors.danger }}>{deleteError}</AppText> : null}
            <View style={styles.actions}>
              <Button label="Move to tomorrow" onPress={() => void moveWorkoutToTomorrow()} busy={moving} variant="secondary" />
              <Button label="Mark skipped" onPress={() => setConfirmSkip(true)} disabled={moving} variant="quiet" />
            </View>
          </Card>
        ) : null}
        {detail.plan?.exercises.map((exercise) => (
          <View key={exercise.exerciseId} style={styles.group}>
            <SectionHeading title={exercise.exerciseName} detail={`${exercise.primaryMuscleGroup.replaceAll('_', ' ')} · target ${exercise.targetRepMin}–${exercise.targetRepMax}`} />
            <Card>
              {exercise.sets.map((set, index) => {
                const cue = exercise.progression.cues.find((item) => item.workingSetIndex === index);
                return (
                  <View key={`${exercise.exerciseId}-${index}`} style={styles.plannedSet}>
                    <AppText style={styles.setIndex}>{index + 1}</AppText>
                    <View style={styles.flex}>
                      <AppText style={styles.setValue}>{set.loadValue == null || set.reps == null ? `Choose load · ${exercise.targetRepMin}–${exercise.targetRepMax} reps` : `${set.loadValue} ${set.loadUnit} × ${set.reps}`}</AppText>
                      {cue ? <AppText style={{ color: colors.success, fontWeight: '700' }}>{cue.label}</AppText> : null}
                    </View>
                  </View>
                );
              })}
              <View style={[styles.planReason, { backgroundColor: exercise.progression.action === 'hold' ? colors.warningSoft : colors.successSoft }]}>
                <AppText style={{ color: exercise.progression.action === 'hold' ? colors.warning : colors.success, fontWeight: '700' }}>{exercise.progression.reason}</AppText>
              </View>
            </Card>
          </View>
        ))}
        <Card style={{ backgroundColor: colors.surfaceMuted }}>
          <AppText style={styles.progressName}>Start this plan</AppText>
          <AppText style={{ color: colors.textMuted }}>Starting opens the normal set logger with these exact values. The workout records the date and time you actually start.</AppText>
          <View style={styles.actions}>
            <Button label="Start workout" onPress={() => router.replace({ pathname: '/workouts/new', params: { planWorkoutId: detail.id } })} />
            <Button label="Edit plan" onPress={() => router.replace({ pathname: '/workouts/plan', params: { planWorkoutId: detail.id } } as never)} variant="secondary" />
            <Button label={detail.scheduledAt ? 'Back to calendar' : 'Back to training'} onPress={() => router.replace(detail.scheduledAt ? '/today' : '/train')} variant="secondary" />
          </View>
        </Card>
        <Card style={confirmSkip ? { backgroundColor: colors.warningSoft, borderColor: colors.warning } : undefined}>
          {confirmSkip ? (
            <>
              <AppText style={styles.progressName}>Skip this planned session?</AppText>
              <AppText style={{ color: colors.textMuted }}>It will leave the upcoming list and its reminder will be cancelled. Completed history is unaffected.</AppText>
              {deleteError ? <AppText style={{ color: colors.danger }}>{deleteError}</AppText> : null}
              <View style={styles.actions}>
                <Button label="Mark skipped" onPress={() => void skipWorkout()} busy={skipping} variant="secondary" />
                <Button label="Keep plan" onPress={() => setConfirmSkip(false)} disabled={skipping} variant="quiet" />
              </View>
            </>
          ) : <Button label="Skip this session" onPress={() => setConfirmSkip(true)} variant="quiet" />}
        </Card>
        <Card style={confirmDelete ? { backgroundColor: colors.dangerSoft, borderColor: colors.danger } : undefined}>
          {confirmDelete ? (
            <>
              <AppText style={styles.progressName}>Remove this plan?</AppText>
              <AppText style={{ color: colors.textMuted }}>The plan and its reminder will be removed from every synced device.</AppText>
              {deleteError ? <AppText style={{ color: colors.danger }}>{deleteError}</AppText> : null}
              <View style={styles.actions}>
                <Button label="Remove plan" onPress={() => void removeWorkout()} busy={deleting} variant="danger" />
                <Button label="Keep it" onPress={() => setConfirmDelete(false)} disabled={deleting} variant="secondary" />
              </View>
            </>
          ) : <Button label="Remove this plan" onPress={() => setConfirmDelete(true)} variant="quiet" />}
        </Card>
      </Screen>
    );
  }

  return (
    <Screen contentContainerStyle={styles.screenContent}>
      <ScreenHeading title={detail.title} eyebrow={`${formatShortDate(detail.completedAt ?? detail.performedOn)} · ${detail.completedAt ? formatTime(detail.completedAt) : 'completed'}`} />
      {storageWarning === '1' ? (
        <Card style={{ backgroundColor: colors.warningSoft, borderColor: colors.warning }}>
          <AppText style={{ color: colors.warning, fontWeight: '800' }}>Workout captured; cloud recovery is in progress</AppText>
          <AppText style={{ color: colors.textMuted }}>Safari could not refresh its local snapshot after the save. The form draft remains available and account sync is queued. Keep this tab open until the sync indicator clears.</AppText>
        </Card>
      ) : null}
      <Card style={styles.summary}>
        <View><AppText style={styles.metric}>{detail.setCount}</AppText><AppText style={{ color: colors.textMuted }}>sets</AppText></View>
        <View><AppText style={styles.metric}>{detail.exerciseCount}</AppText><AppText style={{ color: colors.textMuted }}>exercises</AppText></View>
        <View><AppText style={styles.metric}>{Math.round(detail.totalVolumeKg).toLocaleString()}</AppText><AppText style={{ color: colors.textMuted }}>kg·reps work</AppText></View>
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
              <AppText style={{ color: colors.textMuted }}>work performed versus each exercise’s median across up to three prior matching sessions</AppText>
            </>
          )}
          <View style={styles.progressRows}>
            {data.progress.exercises.map((exercise) => (
              <View key={exercise.exerciseId} style={styles.progressRow}>
                <View style={styles.flex}>
                  <AppText style={styles.progressName}>{exercise.exerciseName}</AppText>
                  <AppText style={{ color: colors.textMuted }}>{Math.round(exercise.currentVolumeKg).toLocaleString()} kg·reps this session{exercise.baselineVolumeKg == null ? '' : ` · ${Math.round(exercise.baselineVolumeKg).toLocaleString()} recent median (${exercise.baselineSessionCount})`}</AppText>
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
            {sets[0]?.exerciseId ? <Button label="View exercise history" onPress={() => router.push({ pathname: '/exercises/[id]', params: { id: sets[0]!.exerciseId } } as never)} variant="quiet" /> : null}
          </Card>
        </View>
      ))}
      {detail.notes ? <><SectionHeading title="Notes" /><Card><AppText>{detail.notes}</AppText></Card></> : null}
      <Card style={[styles.nextSession, { backgroundColor: colors.surfaceMuted }]}>
        <View style={styles.flex}>
          <AppText style={styles.progressName}>Plan the next time you run this session</AppText>
          <AppText style={{ color: colors.textMuted }}>Choose how the completed work should become your next editable plan. This workout will not change.</AppText>
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel="Next workout approach" style={styles.approachChoices}>
          {SESSION_APPROACHES.map((approach) => (
            <ChoiceCard
              key={approach.id}
              title={approach.title}
              body={approach.body}
              selected={nextApproach === approach.id}
              onPress={() => setNextApproach(approach.id)}
            />
          ))}
        </View>
        <View style={styles.actions}>
          <Button
            label="Build next workout plan"
            disabled={nextApproach == null}
            onPress={() => nextApproach && router.replace({
              pathname: '/workouts/plan',
              params: {
                source: 'completed',
                sourceWorkoutId: detail.id,
                sessionApproach: nextApproach,
              },
            } as never)}
          />
          <Button label="Edit this workout" onPress={() => router.replace({ pathname: '/workouts/new', params: { editWorkoutId: detail.id } })} variant="secondary" />
          <Button label="Log from these values" onPress={() => router.replace({ pathname: '/workouts/new', params: { templateWorkoutId: detail.id } })} variant="secondary" />
          {detail.plan?.programContext ? (
            <Button
              label="Plan next programme session"
              onPress={() => router.replace({
                pathname: '/workouts/plan',
                params: {
                  source: 'program',
                  splitId: detail.plan!.programContext!.splitId,
                  sessionIndex: String(detail.plan!.programContext!.sessionIndex + 1),
                  availableMinutes: String(detail.plan!.programContext!.availableMinutes),
                },
              } as never)}
              variant="secondary"
            />
          ) : null}
          <Button label="Back to training" onPress={() => router.replace('/train')} variant="secondary" />
        </View>
      </Card>
      <Card style={confirmDelete ? { backgroundColor: colors.dangerSoft, borderColor: colors.danger } : undefined}>
        {confirmDelete ? (
          <>
            <AppText style={styles.progressName}>Remove this workout?</AppText>
            <AppText style={{ color: colors.textMuted }}>It will disappear from Training, Calendar, and progression totals. This action syncs to your account.</AppText>
            {deleteError ? <AppText style={{ color: colors.danger }}>{deleteError}</AppText> : null}
            <View style={styles.actions}>
              <Button label="Remove workout" onPress={() => void removeWorkout()} busy={deleting} />
              <Button label="Keep it" onPress={() => { setConfirmDelete(false); setDeleteError(null); }} disabled={deleting} variant="secondary" />
            </View>
          </>
        ) : <Button label="Remove this workout" onPress={() => setConfirmDelete(true)} variant="quiet" />}
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
  plannedSet: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  planReason: { padding: spacing.sm, borderRadius: radii.control },
  nextSession: { padding: spacing.lg },
  approachChoices: { gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

function formatPercent(value: number): string {
  const rounded = Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${value > 0 ? '+' : ''}${rounded}%`;
}

function formatSplit(value: 'push_pull_legs' | 'upper_lower' | 'full_body'): string {
  if (value === 'push_pull_legs') return 'Push · Pull · Legs';
  if (value === 'upper_lower') return 'Upper · Lower';
  return 'Full body';
}
