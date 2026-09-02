import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { JointProgressionChoicePanel, type JointProgressionChoice } from '@/components/joint-progression-choice';
import { AppText, Button, Card, Field, Pill, Screen, SectionHeading, StatePanel } from '@/components/ui';
import {
  getRecentExerciseSessionSets,
  getUserProfile,
  getWorkoutDetail,
  listExercises,
  listRecentWorkouts,
  listVolumeHistory,
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
  rebuildPlannedWorkoutProgression,
} from '@/lib/planning/workout-plan';
import {
  ROUTINE_STARTERS,
  rankRoutineStarters,
  repeatedMovementPatterns,
  resolveRoutineStarter,
  summarizePlannedMuscleCredits,
  type RoutineStarter,
} from '@/lib/planning/routine-starters';
import { buildMuscleGroupAdvisory, muscleGroupLabel, type MuscleGroupAdvisory } from '@/lib/progression';
import { formatShortDate, localTimestampForDateAndTime, toLocalDateKey } from '@/lib/time';
import { exerciseEquipmentLabel, filterExerciseCatalog } from '@/lib/training/exercise-catalog';
import { radii, spacing, typography, useJienTheme } from '@/theme';

const COMMON_EXERCISE_COUNT = 12;

function tomorrowKey(): string {
  return futureDateKey(1);
}

function futureDateKey(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return toLocalDateKey(date);
}

export default function PlanWorkoutScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string; planWorkoutId?: string; source?: string }>();
  const { width } = useWindowDimensions();
  const compact = width < 640;
  const { colors } = useJienTheme();
  const planIdRef = useRef(params.planWorkoutId ?? Crypto.randomUUID());
  const submitLockRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const exerciseBrowserYRef = useRef(0);
  const [catalog, setCatalog] = useState<Exercise[] | null>(null);
  const [preferredUnit, setPreferredUnit] = useState<LoadUnit>('kg');
  const [availableEquipment, setAvailableEquipment] = useState<string[]>([]);
  const [advisory, setAdvisory] = useState<MuscleGroupAdvisory | null>(null);
  const [hasJointConsideration, setHasJointConsideration] = useState(false);
  const [jointProgressionChoice, setJointProgressionChoice] = useState<JointProgressionChoice>('hold');
  const [latestWorkout, setLatestWorkout] = useState<WorkoutDetail | null>(null);
  const [title, setTitle] = useState('Next training session');
  const [date, setDate] = useState(params.date ?? tomorrowKey());
  const [time, setTime] = useState('18:00');
  const [query, setQuery] = useState('');
  const [browseAll, setBrowseAll] = useState(false);
  const [catalogLimit, setCatalogLimit] = useState(24);
  const [showScheduleEditor, setShowScheduleEditor] = useState(Boolean(params.planWorkoutId));
  const [planned, setPlanned] = useState<PlannedWorkoutExercise[]>([]);
  const [replacementIndex, setReplacementIndex] = useState<number | null>(null);
  const [draftReason, setDraftReason] = useState<string | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyExerciseId, setBusyExerciseId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadingError(null);
    try {
      const [exercises, profile, recent, existingPlan, volumeSets] = await Promise.all([
        listExercises(db),
        getUserProfile(db),
        listRecentWorkouts(db, 1),
        params.planWorkoutId ? getWorkoutDetail(db, params.planWorkoutId) : Promise.resolve(null),
        listVolumeHistory(db),
      ]);
      const shouldHoldProgression = hasStoredJointConsideration(profile?.injuryFlags);
      const savedJointChoice = existingPlan?.plan?.jointProgressionChoice ?? 'hold';
      setCatalog(exercises);
      setPreferredUnit(profile?.preferredLoadUnit ?? 'kg');
      setAvailableEquipment(profile?.availableEquipment ?? []);
      setAdvisory(buildMuscleGroupAdvisory(volumeSets));
      setHasJointConsideration(shouldHoldProgression);
      setJointProgressionChoice(savedJointChoice);
      setLatestWorkout(recent[0] ? await getWorkoutDetail(db, recent[0].id) : null);
      if (existingPlan?.status === 'planned' && existingPlan.plan) {
        setTitle(existingPlan.title);
        setDate(existingPlan.performedOn);
        setTime(existingPlan.scheduledAt ? formatClock(existingPlan.scheduledAt) : '18:00');
        const currentPlan = applyStoredJointConsiderationHold(existingPlan.plan, shouldHoldProgression);
        setPlanned(rebuildPlannedWorkoutProgression(
          currentPlan?.exercises ?? existingPlan.plan.exercises,
          exercises,
          shouldHoldProgression && savedJointChoice === 'hold',
        ));
      }
    } catch (cause) {
      setLoadingError(cause instanceof Error ? cause.message : 'Could not prepare workout planning.');
    }
  }, [db, params.planWorkoutId]);

  useEffect(() => { void load(); }, [load]);

  const jointProgressionHold = hasJointConsideration && jointProgressionChoice === 'hold';

  const chooseJointProgression = (choice: JointProgressionChoice) => {
    setJointProgressionChoice(choice);
    setPlanned((current) => rebuildPlannedWorkoutProgression(
      current,
      catalog ?? [],
      hasJointConsideration && choice === 'hold',
    ));
  };

  const addExercise = async (exercise: Exercise) => {
    const replacing = replacementIndex;
    if (planned.some((item, index) => item.exerciseId === exercise.id && index !== replacing)) return;
    setBusyExerciseId(exercise.id);
    setFormError(null);
    try {
      const history = (await getRecentExerciseSessionSets(db, exercise.id))[0] ?? [];
      const next = buildPlannedWorkoutExercise({
        exercise,
        history,
        preferredLoadUnit: preferredUnit,
        jointFlag: jointProgressionHold,
      });
      setPlanned((current) => replacing != null && current[replacing]
        ? current.map((item, index) => index === replacing ? next : item)
        : [...current, next]);
      setReplacementIndex(null);
      setDraftReason(null);
      setQuery('');
      setBrowseAll(false);
      setCatalogLimit(24);
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
      setReplacementIndex(null);
      setDraftReason(null);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not prepare the last session.');
    } finally {
      setBusyExerciseId(null);
    }
  };

  const useRoutineStarter = async (starter: RoutineStarter) => {
    if (!catalog || planned.length) return;
    const busyId = `routine:${starter.id}`;
    setBusyExerciseId(busyId);
    setFormError(null);
    try {
      const exercises = resolveRoutineStarter(starter, catalog, availableEquipment);
      if (exercises.length < 2) {
        throw new Error('This routine needs more exercises for the equipment saved in your profile. Add exercises individually or update your equipment.');
      }
      const next = await Promise.all(exercises.map(async (exercise) => buildPlannedWorkoutExercise({
        exercise,
        history: (await getRecentExerciseSessionSets(db, exercise.id))[0] ?? [],
        preferredLoadUnit: preferredUnit,
        jointFlag: jointProgressionHold,
      })));
      setTitle(starter.sessionTitle);
      setPlanned(next);
      setReplacementIndex(null);
      setDraftReason(routineRecommendations.find((item) => item.starter.id === starter.id)?.reason ?? null);
      setQuery('');
      setBrowseAll(false);
      setCatalogLimit(24);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not prepare that routine starter.');
    } finally {
      setBusyExerciseId(null);
    }
  };

  const moveExercise = (index: number, offset: -1 | 1) => {
    setPlanned((current) => {
      const target = index + offset;
      if (!current[index] || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const beginSwap = (index: number) => {
    const exercise = planned[index];
    if (!exercise) return;
    setReplacementIndex(index);
    setQuery(muscleGroupLabel(exercise.primaryMuscleGroup));
    setBrowseAll(true);
    setCatalogLimit(24);
    setFormError(null);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(0, exerciseBrowserYRef.current - spacing.md), animated: true }));
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
        jointProgressionChoice: hasJointConsideration ? jointProgressionChoice : undefined,
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
    return filterExerciseCatalog(catalog, { query });
  }, [browseAll, catalog, query]);
  const visibleResults = results.slice(0, catalogLimit);
  const routineRecommendations = useMemo(() => rankRoutineStarters({
    catalog: catalog ?? [],
    availableEquipment,
    focus: advisory?.status === 'focus' ? advisory.focus : [],
  }), [advisory, availableEquipment, catalog]);
  const recommendedByStarter = useMemo(() => new Map(
    routineRecommendations.map((item) => [item.starter.id, item]),
  ), [routineRecommendations]);
  const orderedRoutineStarters = useMemo(() => [
    ...routineRecommendations.map((item) => item.starter),
    ...ROUTINE_STARTERS.filter((starter) => !recommendedByStarter.has(starter.id)),
  ], [recommendedByStarter, routineRecommendations]);
  const advisoryRecommendation = params.source === 'advisory' ? routineRecommendations[0] ?? null : null;
  const draftMuscleCredits = useMemo(() => summarizePlannedMuscleCredits(
    planned.map((exercise) => ({ exerciseId: exercise.exerciseId, setCount: exercise.sets.length })),
    catalog ?? [],
  ), [catalog, planned]);
  const repeatedPatterns = useMemo(() => repeatedMovementPatterns(
    planned.map((exercise) => exercise.exerciseId),
    catalog ?? [],
  ), [catalog, planned]);

  if (!catalog && !loadingError) return <Screen><StatePanel title="Preparing your plan" body="Reading exercises and recent completed sessions from this device." loading /></Screen>;
  if (loadingError) return <Screen><StatePanel title="Planning is unavailable" body={loadingError} actionLabel="Try again" onAction={() => void load()} /></Screen>;

  const common = catalog?.slice(0, COMMON_EXERCISE_COUNT) ?? [];
  return (
    <Screen scrollViewRef={scrollRef} contentContainerStyle={styles.screenContent}>
      {!planned.length && advisoryRecommendation ? (
        <Card style={{ backgroundColor: colors.accentSoft, borderColor: colors.accent }}>
          <AppText style={[styles.kicker, { color: colors.accent }]}>CURRENT MUSCLE FOCUS</AppText>
          <AppText style={styles.cardTitle}>{advisoryRecommendation.starter.label} matches the current gaps</AppText>
          <AppText style={{ color: colors.textMuted }}>{advisoryRecommendation.reason}</AppText>
          <Button label={`Use ${advisoryRecommendation.starter.label} draft`} onPress={() => void useRoutineStarter(advisoryRecommendation.starter)} busy={busyExerciseId === `routine:${advisoryRecommendation.starter.id}`} variant="secondary" />
        </Card>
      ) : null}
      {latestWorkout ? (
        <Card style={{ backgroundColor: colors.surfaceMuted }}>
          <View style={styles.rowWrap}>
            <View style={styles.flex}>
              <AppText style={styles.cardTitle}>Repeat latest session</AppText>
              <AppText style={{ color: colors.textMuted }}>{latestWorkout.title} · {latestWorkout.exerciseCount} exercises</AppText>
            </View>
            <Button label="Use latest" onPress={() => void useLatestSession()} busy={busyExerciseId === 'latest'} variant="secondary" />
          </View>
        </Card>
      ) : null}

      {hasJointConsideration ? <JointProgressionChoicePanel value={jointProgressionChoice} onChange={chooseJointProgression} /> : null}

      <SectionHeading title="Schedule" detail={`${formatPlanDate(date)} · ${formatPlanTime(time)}`} />
      <Card>
        <View style={styles.rowWrap}>
          <View style={styles.flex}>
            <AppText style={styles.cardTitle}>{title.trim() || 'Untitled workout'}</AppText>
            <AppText style={{ color: colors.textMuted }}>{formatPlanDate(date)} at {formatPlanTime(time)}</AppText>
          </View>
          <Button label={showScheduleEditor ? 'Done' : 'Edit schedule'} onPress={() => setShowScheduleEditor((value) => !value)} expanded={showScheduleEditor} variant="secondary" />
        </View>
        {showScheduleEditor ? (
          <View style={styles.scheduleEditor}>
            <Field label="Session name" value={title} onChangeText={setTitle} />
            <View>
              <AppText style={styles.label}>Quick date</AppText>
              <View style={styles.pills}>
                {[
                  { label: 'Today', value: futureDateKey(0) },
                  { label: 'Tomorrow', value: futureDateKey(1) },
                  { label: 'In two days', value: futureDateKey(2) },
                ].map((option) => <Pill key={option.value} label={option.label} active={date === option.value} onPress={() => setDate(option.value)} />)}
              </View>
            </View>
            <View>
              <AppText style={styles.label}>Quick time</AppText>
              <View style={styles.pills}>
                {[
                  { label: 'Morning · 07:00', value: '07:00' },
                  { label: 'Lunch · 12:00', value: '12:00' },
                  { label: 'Evening · 18:00', value: '18:00' },
                  { label: 'Late · 20:00', value: '20:00' },
                ].map((option) => <Pill key={option.value} label={option.label} active={time === option.value} onPress={() => setTime(option.value)} />)}
              </View>
            </View>
            <View style={[styles.scheduleFields, !compact && styles.scheduleFieldsWide]}>
              <Field label="Exact date" hint="YYYY-MM-DD" value={date} onChangeText={setDate} containerStyle={styles.dateField} />
              <Field label="Exact time" hint="24-hour time" value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" containerStyle={styles.timeField} />
            </View>
          </View>
        ) : null}
      </Card>

      {planned.length ? (
        <Card>
          <AppText style={styles.cardTitle}>Targets start from your latest matching sets</AppText>
          {draftReason ? <AppText style={{ color: colors.accent }}>{draftReason}</AppText> : null}
          <AppText style={{ color: colors.textMuted }}>Optional progression cues never overwrite the loads and reps you logged.</AppText>
        </Card>
      ) : null}

      {draftMuscleCredits.length ? (
        <Card>
          <AppText style={styles.cardTitle}>Draft muscle coverage</AppText>
          <View style={styles.pills}>{draftMuscleCredits.map((item) => <Pill key={item.muscleGroup} label={`${item.label} · ${formatSetCredits(item.setCredits)}`} />)}</View>
          <AppText style={{ color: colors.textMuted }}>Planned working sets count 1.0 for the primary target and 0.5 for each distinct assisting target. This describes planned exposure, not measured activation.</AppText>
          {repeatedPatterns.length ? <View style={[styles.notice, { backgroundColor: colors.warningSoft }]}><AppText style={{ color: colors.warning }}>Repeated movement patterns: {repeatedPatterns.map((item) => `${movementPatternLabel(item.movementPattern)} × ${item.count}`).join(', ')}. Keep them when the different angles are intentional, or swap an exercise.</AppText></View> : null}
        </Card>
      ) : null}

      <SectionHeading title="Exercises" detail={`${planned.length} selected`} />
      {!planned.length ? (
        <Card style={{ backgroundColor: colors.surfaceMuted }}>
          <AppText style={styles.cardTitle}>Start from a routine</AppText>
          <AppText style={{ color: colors.textMuted }}>Exercise choices use the equipment in your profile. Previous loads appear only when they exist.</AppText>
          <View style={styles.starterActions}>
            {orderedRoutineStarters.map((starter) => (
              <Button
                key={starter.id}
                label={`${starter.label}${recommendedByStarter.has(starter.id) ? ' · focus match' : ''}`}
                accessibilityLabel={`Use ${starter.label} routine starter`}
                onPress={() => void useRoutineStarter(starter)}
                busy={busyExerciseId === `routine:${starter.id}`}
                disabled={busyExerciseId != null}
                variant="secondary"
              />
            ))}
          </View>
        </Card>
      ) : null}
      <Card onLayout={(event) => { exerciseBrowserYRef.current = event.nativeEvent.layout.y; }}>
        <AppText style={styles.label}>Quick add</AppText>
        {replacementIndex != null && planned[replacementIndex] ? (
          <View style={[styles.notice, { backgroundColor: colors.warningSoft }]}>
            <View style={styles.rowWrap}>
              <View style={styles.flex}>
                <AppText style={{ color: colors.warning, fontWeight: '700' }}>Replacing {planned[replacementIndex].exerciseName}</AppText>
                <AppText style={{ color: colors.textMuted }}>Choose another exercise below. Existing logged workouts will not change.</AppText>
              </View>
              <Button label="Cancel swap" onPress={() => { setReplacementIndex(null); setQuery(''); setBrowseAll(false); }} variant="quiet" />
            </View>
          </View>
        ) : null}
        <View style={styles.pills}>{common.map((exercise) => (
          <Pill
            key={exercise.id}
            label={exercise.name}
            active={planned.some((item) => item.exerciseId === exercise.id)}
            onPress={() => void addExercise(exercise)}
          />
        ))}</View>
        <View style={styles.searchRow}>
          <Field placeholder="Search exercise, muscle, or equipment" value={query} onChangeText={(value) => { setQuery(value); setCatalogLimit(24); }} containerStyle={styles.flex} />
          <Button label={browseAll ? 'Close list' : `Browse all ${catalog?.length ?? 0}`} onPress={() => { setBrowseAll((value) => !value); setCatalogLimit(24); }} variant="secondary" />
        </View>
        {query.trim() || browseAll ? (
          <>
            <ScrollView style={[styles.results, { borderColor: colors.border }]} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {visibleResults.map((exercise) => {
              const selected = planned.some((item) => item.exerciseId === exercise.id);
              return (
                <Pressable
                  key={exercise.id}
                  accessibilityRole="button"
                  disabled={selected || busyExerciseId != null}
                  onPress={() => void addExercise(exercise)}
                  style={({ pressed }) => [styles.result, { borderBottomColor: colors.border }, pressed && styles.pressed, selected && styles.disabled]}
                >
                  <View style={styles.flex}><AppText style={styles.resultName}>{exercise.name}</AppText><AppText style={{ color: colors.textMuted }}>{exercise.primaryMuscleGroup.replaceAll('_', ' ')} · {exerciseEquipmentLabel(exercise.equipment)}</AppText></View>
                  <AppText style={{ color: selected ? colors.success : colors.accent, fontWeight: '700' }}>{selected ? 'Added' : busyExerciseId === exercise.id ? 'Adding…' : 'Add'}</AppText>
                </Pressable>
              );
            })}
            </ScrollView>
            {visibleResults.length < results.length ? <Button label={`Show ${Math.min(24, results.length - visibleResults.length)} more`} onPress={() => setCatalogLimit((count) => count + 24)} variant="quiet" /> : null}
          </>
        ) : null}
      </Card>

      {formError ? <View accessibilityRole="alert" style={[styles.error, { backgroundColor: colors.dangerSoft }]}><AppText style={{ color: colors.danger }}>{formError}</AppText></View> : null}

      <View style={styles.planList}>
        {planned.map((exercise, index) => (
          <Card key={exercise.exerciseId}>
            <View style={styles.rowWrap}>
              <View style={styles.flex}>
                <AppText style={styles.kicker}>EXERCISE {index + 1}</AppText>
                <AppText style={styles.exerciseName}>{exercise.exerciseName}</AppText>
                <AppText style={{ color: colors.textMuted }}>{exercise.primaryMuscleGroup.replaceAll('_', ' ')} · target {exercise.targetRepMin}–{exercise.targetRepMax}</AppText>
              </View>
              <View style={styles.exerciseActions}>
                <Button label="Up" accessibilityLabel={`Move ${exercise.exerciseName} earlier`} onPress={() => moveExercise(index, -1)} disabled={index === 0} variant="quiet" />
                <Button label="Down" accessibilityLabel={`Move ${exercise.exerciseName} later`} onPress={() => moveExercise(index, 1)} disabled={index === planned.length - 1} variant="quiet" />
                <Button label="Swap" accessibilityLabel={`Swap ${exercise.exerciseName}`} onPress={() => beginSwap(index)} variant="quiet" />
                <Button label="Remove" onPress={() => { setPlanned((current) => current.filter((item) => item.exerciseId !== exercise.exerciseId)); setDraftReason(null); setReplacementIndex(null); }} variant="quiet" />
              </View>
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

      {!planned.length ? <StatePanel title="Add exercises" body="Choose them individually or repeat your latest session. Previous loads appear only when they exist." /> : null}
      <Button label={params.planWorkoutId ? 'Update planned workout' : 'Save planned workout'} onPress={() => void save()} busy={saving} disabled={!planned.length} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { width: '100%', maxWidth: 960, alignSelf: 'center' },
  scheduleFields: { gap: spacing.md },
  scheduleFieldsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  scheduleEditor: { gap: spacing.md, paddingTop: spacing.md },
  dateField: { width: 180 },
  timeField: { width: 150 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  cardTitle: { ...typography.bodyLarge, fontWeight: '700' },
  label: { ...typography.label, fontWeight: '700' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  starterActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  exerciseActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.xs },
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
  notice: { padding: spacing.sm, borderRadius: radii.control, gap: spacing.xs },
  error: { padding: spacing.md, borderRadius: radii.control },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
});

function formatClock(value: string): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatPlanDate(value: string): string {
  try {
    return formatShortDate(`${value}T12:00:00`);
  } catch {
    return value || 'Choose a date';
  }
}

function formatPlanTime(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value || 'Choose a time';
  const date = new Date(2000, 0, 1, Number(match[1]), Number(match[2]));
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatSetCredits(value: number): string {
  const amount = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${amount} set credit${value === 1 ? '' : 's'}`;
}

function movementPatternLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/^./, (character) => character.toLocaleUpperCase());
}
