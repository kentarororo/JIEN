import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import {
  getLastExerciseSessionSets,
  getUserProfile,
  getWorkoutDetail,
  listExercises,
  listRecentWorkouts,
  savePlannedWorkout,
  type Exercise,
  type LoadUnit,
  type PlannedWorkoutExercise,
  type WorkoutDetail,
} from '@/lib/db';
import {
  applyStoredJointConsiderationHold,
  buildPlannedWorkoutExercise,
  hasStoredJointConsideration,
} from '@/lib/planning/workout-plan';
import { localTimestampForDateAndTime, toLocalDateKey } from '@/lib/time';
import { radii, spacing, typography, useJienTheme } from '@/theme';

const COMMON_EXERCISE_COUNT = 12;

function tomorrowKey(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return toLocalDateKey(date);
}

export default function PlanWorkoutScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string; planWorkoutId?: string }>();
  const { width } = useWindowDimensions();
  const compact = width < 640;
  const { colors } = useJienTheme();
  const planIdRef = useRef(params.planWorkoutId ?? Crypto.randomUUID());
  const submitLockRef = useRef(false);
  const [catalog, setCatalog] = useState<Exercise[] | null>(null);
  const [preferredUnit, setPreferredUnit] = useState<LoadUnit>('kg');
  const [jointProgressionHold, setJointProgressionHold] = useState(false);
  const [latestWorkout, setLatestWorkout] = useState<WorkoutDetail | null>(null);
  const [title, setTitle] = useState('Next training session');
  const [date, setDate] = useState(params.date ?? tomorrowKey());
  const [time, setTime] = useState('18:00');
  const [query, setQuery] = useState('');
  const [browseAll, setBrowseAll] = useState(false);
  const [planned, setPlanned] = useState<PlannedWorkoutExercise[]>([]);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyExerciseId, setBusyExerciseId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadingError(null);
    try {
      const [exercises, profile, recent, existingPlan] = await Promise.all([
        listExercises(db),
        getUserProfile(db),
        listRecentWorkouts(db, 1),
        params.planWorkoutId ? getWorkoutDetail(db, params.planWorkoutId) : Promise.resolve(null),
      ]);
      const shouldHoldProgression = hasStoredJointConsideration(profile?.injuryFlags);
      setCatalog(exercises);
      setPreferredUnit(profile?.preferredLoadUnit ?? 'kg');
      setJointProgressionHold(shouldHoldProgression);
      setLatestWorkout(recent[0] ? await getWorkoutDetail(db, recent[0].id) : null);
      if (existingPlan?.status === 'planned' && existingPlan.plan) {
        setTitle(existingPlan.title);
        setDate(existingPlan.performedOn);
        setTime(existingPlan.scheduledAt ? formatClock(existingPlan.scheduledAt) : '18:00');
        setPlanned(
          applyStoredJointConsiderationHold(existingPlan.plan, shouldHoldProgression)?.exercises
            ?? existingPlan.plan.exercises,
        );
      }
    } catch (cause) {
      setLoadingError(cause instanceof Error ? cause.message : 'Could not prepare workout planning.');
    }
  }, [db, params.planWorkoutId]);

  useEffect(() => { void load(); }, [load]);

  const addExercise = async (exercise: Exercise) => {
    if (planned.some((item) => item.exerciseId === exercise.id)) return;
    setBusyExerciseId(exercise.id);
    setFormError(null);
    try {
      const history = await getLastExerciseSessionSets(db, exercise.id);
      const next = buildPlannedWorkoutExercise({
        exercise,
        history,
        preferredLoadUnit: preferredUnit,
        jointFlag: jointProgressionHold,
      });
      setPlanned((current) => [...current, next]);
      setQuery('');
      setBrowseAll(false);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not add that exercise.');
    } finally {
      setBusyExerciseId(null);
    }
  };

  const useLatestSession = async () => {
    if (!latestWorkout || !catalog) return;
    setBusyExerciseId('latest');
    setFormError(null);
    try {
      const ids = [...new Set(latestWorkout.sets.filter((set) => set.kind === 'working').map((set) => set.exerciseId))];
      const next = await Promise.all(ids.map(async (exerciseId) => {
        const exercise = catalog.find((item) => item.id === exerciseId);
        if (!exercise) return null;
        return buildPlannedWorkoutExercise({
          exercise,
          history: latestWorkout.sets.filter((set) => set.exerciseId === exerciseId),
          preferredLoadUnit: preferredUnit,
          jointFlag: jointProgressionHold,
        });
      }));
      setTitle(latestWorkout.title);
      setPlanned(next.filter((item): item is PlannedWorkoutExercise => item != null));
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not prepare the last session.');
    } finally {
      setBusyExerciseId(null);
    }
  };

  const save = async () => {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      if (date < toLocalDateKey()) throw new Error('Choose today or a future calendar day.');
      const scheduledAt = localTimestampForDateAndTime(date, time);
      const id = await savePlannedWorkout(db, {
        id: planIdRef.current,
        title,
        performedOn: date,
        scheduledAt,
        exercises: planned,
      });
      router.replace({ pathname: '/workouts/[id]', params: { id } });
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not save this planned session.');
      submitLockRef.current = false;
      setSaving(false);
    }
  };

  const results = useMemo(() => {
    if (!catalog || (!query.trim() && !browseAll)) return [];
    const term = query.trim().toLocaleLowerCase();
    return catalog.filter((exercise) => !term
      || `${exercise.name} ${exercise.primaryMuscleGroup} ${exercise.equipment ?? ''}`.toLocaleLowerCase().includes(term));
  }, [browseAll, catalog, query]);

  if (!catalog && !loadingError) return <Screen><StatePanel title="Preparing your plan" body="Reading exercises and recent completed sessions from this device." loading /></Screen>;
  if (loadingError) return <Screen><StatePanel title="Planning is unavailable" body={loadingError} actionLabel="Try again" onAction={() => void load()} /></Screen>;

  const common = catalog?.slice(0, COMMON_EXERCISE_COUNT) ?? [];
  return (
    <Screen contentContainerStyle={styles.screenContent}>
      <ScreenHeading eyebrow="Calendar-backed plan" title={params.planWorkoutId ? 'Edit planned session' : 'Plan the next session'} />
      <Card style={{ backgroundColor: colors.surfaceMuted }}>
        <AppText style={styles.cardTitle}>Plan now, log the work later</AppText>
        <AppText style={{ color: colors.textMuted }}>JIEN copies the last completed loads and reps. Green cues show the smallest optional progression without changing those fields.</AppText>
      </Card>

      {jointProgressionHold ? (
        <Card style={{ backgroundColor: colors.warningSoft, borderColor: colors.warning }}>
          <AppText style={[styles.cardTitle, { color: colors.warning }]}>Progression suggestions are on hold</AppText>
          <AppText style={{ color: colors.textMuted }}>Your profile contains a joint or injury consideration. JIEN will preserve previous sets as a reference without suggesting more load or reps. You remain in control of what feels appropriate.</AppText>
        </Card>
      ) : null}

      <View style={[styles.scheduleFields, !compact && styles.scheduleFieldsWide]}>
        <Field label="Session name" value={title} onChangeText={setTitle} containerStyle={styles.flex} />
        <Field label="Date" hint="YYYY-MM-DD" value={date} onChangeText={setDate} containerStyle={styles.dateField} />
        <Field label="Start time" hint="24-hour time" value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" containerStyle={styles.timeField} />
      </View>

      {latestWorkout ? (
        <Card>
          <View style={styles.row}>
            <View style={styles.flex}>
              <AppText style={styles.cardTitle}>Repeat {latestWorkout.title}</AppText>
              <AppText style={{ color: colors.textMuted }}>{latestWorkout.exerciseCount} exercises from the most recent completed session.</AppText>
            </View>
            <Button label="Use session" onPress={() => void useLatestSession()} busy={busyExerciseId === 'latest'} variant="secondary" />
          </View>
        </Card>
      ) : null}

      <SectionHeading title="Exercises" detail={`${planned.length} selected`} />
      <Card>
        <AppText style={styles.label}>Common exercises</AppText>
        <View style={styles.pills}>{common.map((exercise) => (
          <Pill
            key={exercise.id}
            label={exercise.name}
            active={planned.some((item) => item.exerciseId === exercise.id)}
            onPress={() => void addExercise(exercise)}
          />
        ))}</View>
        <View style={styles.searchRow}>
          <Field placeholder="Search exercise, muscle, or equipment" value={query} onChangeText={setQuery} containerStyle={styles.flex} />
          <Button label={browseAll ? 'Close list' : `Browse all ${catalog?.length ?? 0}`} onPress={() => setBrowseAll((value) => !value)} variant="secondary" />
        </View>
        {query.trim() || browseAll ? (
          <ScrollView style={[styles.results, { borderColor: colors.border }]} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {results.map((exercise) => {
              const selected = planned.some((item) => item.exerciseId === exercise.id);
              return (
                <Pressable
                  key={exercise.id}
                  accessibilityRole="button"
                  disabled={selected || busyExerciseId != null}
                  onPress={() => void addExercise(exercise)}
                  style={({ pressed }) => [styles.result, { borderBottomColor: colors.border }, pressed && styles.pressed, selected && styles.disabled]}
                >
                  <View style={styles.flex}><AppText style={styles.resultName}>{exercise.name}</AppText><AppText style={{ color: colors.textMuted }}>{exercise.primaryMuscleGroup.replaceAll('_', ' ')} · {exercise.equipment ?? 'bodyweight'}</AppText></View>
                  <AppText style={{ color: selected ? colors.success : colors.accent, fontWeight: '700' }}>{selected ? 'Added' : busyExerciseId === exercise.id ? 'Adding…' : 'Add'}</AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </Card>

      {formError ? <View accessibilityRole="alert" style={[styles.error, { backgroundColor: colors.dangerSoft }]}><AppText style={{ color: colors.danger }}>{formError}</AppText></View> : null}

      <View style={styles.planList}>
        {planned.map((exercise, index) => (
          <Card key={exercise.exerciseId}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <AppText style={styles.kicker}>EXERCISE {index + 1}</AppText>
                <AppText style={styles.exerciseName}>{exercise.exerciseName}</AppText>
                <AppText style={{ color: colors.textMuted }}>{exercise.primaryMuscleGroup.replaceAll('_', ' ')} · target {exercise.targetRepMin}–{exercise.targetRepMax}</AppText>
              </View>
              <Button label="Remove" onPress={() => setPlanned((current) => current.filter((item) => item.exerciseId !== exercise.exerciseId))} variant="quiet" />
            </View>
            <View style={styles.targetList}>
              {exercise.sets.map((set, setIndex) => {
                const cue = exercise.progression.cues.find((item) => item.workingSetIndex === setIndex);
                return (
                  <View key={`${exercise.exerciseId}-${setIndex}`} style={[styles.targetRow, { borderColor: colors.border }]}>
                    <AppText style={styles.setNumber}>{setIndex + 1}</AppText>
                    <View style={styles.flex}>
                      <AppText style={styles.targetValue}>{set.loadValue == null || set.reps == null ? `Choose load · ${exercise.targetRepMin}–${exercise.targetRepMax} reps` : `${set.loadValue} ${set.loadUnit} × ${set.reps}`}</AppText>
                      {cue ? <AppText style={[styles.cue, { color: colors.success }]}>{cue.label}</AppText> : null}
                    </View>
                  </View>
                );
              })}
            </View>
            <View style={[styles.reason, { backgroundColor: exercise.progression.action === 'hold' ? colors.warningSoft : colors.successSoft }]}>
              <AppText style={{ color: exercise.progression.action === 'hold' ? colors.warning : colors.success, fontWeight: '700' }}>{exercise.progression.reason}</AppText>
            </View>
          </Card>
        ))}
      </View>

      {!planned.length ? <StatePanel title="Choose the work you intend to do" body="Add exercises individually or use your latest completed session. Loads are never invented when no history exists." /> : null}
      <Button label={params.planWorkoutId ? 'Update planned workout' : 'Save planned workout'} onPress={() => void save()} busy={saving} disabled={!planned.length} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { width: '100%', maxWidth: 960, alignSelf: 'center' },
  scheduleFields: { gap: spacing.md },
  scheduleFieldsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  dateField: { width: 180 },
  timeField: { width: 150 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardTitle: { ...typography.bodyLarge, fontWeight: '700' },
  label: { ...typography.label, fontWeight: '700' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  searchRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: spacing.sm },
  results: { maxHeight: 300, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control },
  result: { minHeight: 58, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  resultName: { fontWeight: '700' },
  planList: { gap: spacing.md },
  kicker: { ...typography.caption, fontWeight: '800', opacity: 0.65 },
  exerciseName: { ...typography.section, fontWeight: '700' },
  targetList: { gap: spacing.xs },
  targetRow: { minHeight: 52, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.compact, padding: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  setNumber: { width: 28, textAlign: 'center', fontWeight: '700' },
  targetValue: { fontWeight: '700', fontVariant: ['tabular-nums'] },
  cue: { ...typography.caption, fontWeight: '700' },
  reason: { padding: spacing.sm, borderRadius: radii.control },
  error: { padding: spacing.md, borderRadius: radii.control },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
});

function formatClock(value: string): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
import * as Crypto from 'expo-crypto';
