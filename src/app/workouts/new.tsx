import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, SectionHeading, StatePanel } from '@/components/ui';
import {
  createCustomExercise,
  completePlannedWorkout,
  getLastExerciseSessionSets,
  getWorkoutDetail,
  getUserProfile,
  listExercises,
  saveWorkout,
  updateWorkout,
  type Exercise,
  type LoadUnit,
  type WorkoutDetail,
} from '@/lib/db';
import { getAccountState } from '@/lib/auth';
import {
  buildSetProgressionPlan,
  MUSCLE_GROUP_OPTIONS,
  MUSCLE_GROUP_SECTIONS,
  muscleGroupLabel,
  type ProgressionSet,
  type SetProgressionCue,
  type SetProgressionPlan,
} from '@/lib/progression';
import { hasStoredJointConsideration } from '@/lib/planning/workout-plan';
import { radii, spacing, typography, useJienTheme } from '@/theme';
import { formatShortDate, localTimestampForDate } from '@/lib/time';
import {
  fillBlankWorkoutLoads,
  latestValidWorkoutLoad,
  parseWorkoutDraft,
  summarizeWorkoutDraft,
  workoutDraftContext,
  workoutDraftStorageKey,
} from '@/lib/workout-draft';

type DraftSet = { key: string; id?: string; load: string; reps: string; rpe: string };
type DraftExercise = {
  key: string;
  exerciseId: string;
  sets: DraftSet[];
  progression: SetProgressionPlan | null;
  sourceSets: ProgressionSet[] | null;
};

const COMMON_EXERCISE_COUNT = 12;
const newSet = (load = '', reps = '', rpe = '', id?: string): DraftSet => ({ key: Crypto.randomUUID(), id, load, reps, rpe });
const newBlock = (exerciseId: string): DraftExercise => ({
  key: Crypto.randomUUID(),
  exerciseId,
  sets: [newSet(), newSet(), newSet()],
  progression: null,
  sourceSets: null,
});
const isRowEmpty = (set: DraftSet) => !set.load.trim() && !set.reps.trim() && !set.rpe.trim();

export default function NewWorkoutScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { templateWorkoutId, planWorkoutId, editWorkoutId, date } = useLocalSearchParams<{ templateWorkoutId?: string; planWorkoutId?: string; editWorkoutId?: string; date?: string }>();
  const workoutIdRef = useRef(editWorkoutId ?? planWorkoutId ?? Crypto.randomUUID());
  const submitLockRef = useRef(false);
  const { width } = useWindowDimensions();
  const compact = width < 520;
  const { colors } = useJienTheme();
  const [catalog, setCatalog] = useState<Exercise[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [title, setTitle] = useState('Training session');
  const [unit, setUnit] = useState<LoadUnit>('kg');
  const [jointProgressionHold, setJointProgressionHold] = useState(false);
  const [blocks, setBlocks] = useState<DraftExercise[]>([]);
  const [exerciseQueries, setExerciseQueries] = useState<Record<string, string>>({});
  const [exerciseBrowsers, setExerciseBrowsers] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [editStartedAt, setEditStartedAt] = useState<string | null>(null);
  const [draftOwnerUserId, setDraftOwnerUserId] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(process.env.EXPO_OS !== 'web');
  const [draftRecovered, setDraftRecovered] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customNotes, setCustomNotes] = useState('');
  const [customMuscle, setCustomMuscle] = useState<string>(MUSCLE_GROUP_OPTIONS[0].value);
  const [customSecondaryMuscles, setCustomSecondaryMuscles] = useState<string[]>([]);
  const [customSaving, setCustomSaving] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoadError(null);
    try {
      const [exercises, profile, template] = await Promise.all([
        listExercises(db),
        getUserProfile(db),
        templateWorkoutId || planWorkoutId || editWorkoutId
          ? getWorkoutDetail(db, editWorkoutId ?? planWorkoutId ?? templateWorkoutId!)
          : Promise.resolve(null),
      ]);
      setCatalog(exercises);
      setJointProgressionHold(hasStoredJointConsideration(profile?.injuryFlags));
      if (template?.sets[0]) setUnit(template.sets[0].loadUnit);
      else if (template?.plan?.exercises[0]?.sets[0]) setUnit(template.plan.exercises[0].sets[0].loadUnit);
      else if (profile) setUnit(profile.preferredLoadUnit);
      if (template) {
        setTitle(template.title);
        setEditStartedAt(editWorkoutId ? template.completedAt : null);
        setBlocks(template.status === 'planned'
          ? blocksFromPlan(template)
          : editWorkoutId ? blocksFromEdit(template) : blocksFromTemplate(template));
      } else {
        setBlocks((current) => current.length ? current : [newBlock(exercises[0]?.id ?? '')]);
      }
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not load exercises.');
    }
  }, [db, editWorkoutId, planWorkoutId, templateWorkoutId]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const draftContext = useMemo(() => workoutDraftContext({ date, templateWorkoutId, planWorkoutId, editWorkoutId }), [date, editWorkoutId, planWorkoutId, templateWorkoutId]);
  const draftSummary = useMemo(() => summarizeWorkoutDraft(blocks), [blocks]);

  useEffect(() => {
    if (process.env.EXPO_OS !== 'web') return;
    void getAccountState().then((account) => {
      setDraftOwnerUserId(account.configured ? account.user?.id ?? null : null);
    });
  }, []);

  useEffect(() => {
    if (process.env.EXPO_OS !== 'web' || !catalog || !draftOwnerUserId || draftReady) return;
    const recovered = parseWorkoutDraft(
      globalThis.localStorage?.getItem(workoutDraftStorageKey(draftOwnerUserId, draftContext)) ?? null,
      draftOwnerUserId,
      draftContext,
    );
    if (recovered) {
      workoutIdRef.current = recovered.workoutId;
      setTitle(recovered.title);
      setUnit(recovered.unit);
      setEditStartedAt(recovered.startedAt);
      setBlocks(recovered.blocks.map((block) => ({
        key: Crypto.randomUUID(),
        exerciseId: block.exerciseId,
        sets: block.sets.map((set) => newSet(set.load, set.reps, set.rpe, set.id)),
        progression: null,
        sourceSets: null,
      })));
      setDraftRecovered(true);
    }
    setDraftReady(true);
  }, [catalog, draftContext, draftOwnerUserId, draftReady]);

  useEffect(() => {
    if (process.env.EXPO_OS !== 'web' || !draftReady || !draftOwnerUserId || blocks.length === 0) return;
    globalThis.localStorage?.setItem(workoutDraftStorageKey(draftOwnerUserId, draftContext), JSON.stringify({
      version: 1,
      ownerUserId: draftOwnerUserId,
      workoutId: workoutIdRef.current,
      context: draftContext,
      title,
      unit,
      startedAt: editStartedAt,
      updatedAt: new Date().toISOString(),
      blocks: blocks.map((block) => ({
        exerciseId: block.exerciseId,
        sets: block.sets.map(({ id, load, reps, rpe }) => ({ id, load, reps, rpe })),
      })),
    }));
  }, [blocks, draftContext, draftOwnerUserId, draftReady, editStartedAt, title, unit]);

  const updateProgression = useCallback(async (blockKey: string, exerciseId: string, sourceSets: ProgressionSet[] | null) => {
    const exercise = catalog?.find((item) => item.id === exerciseId);
    if (!exercise) return;
    const history = sourceSets ?? await getLastExerciseSessionSets(db, exerciseId);
    const progression = buildSetProgressionPlan({
      sets: history,
      repMin: exercise.targetRepMin,
      repMax: exercise.targetRepMax,
      loadIncrement: unit === 'lb' ? Math.max(5, exercise.loadIncrement) : exercise.loadIncrement,
      jointFlag: jointProgressionHold,
    });
    setBlocks((current) => current.map((block) => block.key === blockKey ? { ...block, progression } : block));
  }, [catalog, db, jointProgressionHold, unit]);

  useEffect(() => {
    blocks.forEach((block) => {
      if (block.exerciseId && block.progression == null) void updateProgression(block.key, block.exerciseId, block.sourceSets);
    });
  }, [blocks, updateProgression]);

  const setExercise = (blockKey: string, exerciseId: string) => {
    setBlocks((current) => current.map((block) => block.key === blockKey ? { ...block, exerciseId, progression: null, sourceSets: null } : block));
    setExerciseQueries((current) => ({ ...current, [blockKey]: '' }));
    setExerciseBrowsers((current) => ({ ...current, [blockKey]: false }));
  };

  const updateSet = (blockKey: string, setKey: string, field: 'load' | 'reps' | 'rpe', value: string) => {
    setFormError(null);
    setBlocks((current) => current.map((block) => block.key === blockKey ? {
      ...block,
      sets: block.sets.map((set) => set.key === setKey ? { ...set, [field]: value } : set),
    } : block));
  };

  const addSet = (blockKey: string) => {
    setFormError(null);
    setBlocks((current) => current.map((block) => block.key === blockKey ? {
      ...block,
      sets: [...block.sets, newSet(latestValidWorkoutLoad(block.sets) ?? '')],
    } : block));
  };

  const fillBlankLoads = (blockKey: string) => {
    setFormError(null);
    setBlocks((current) => current.map((block) => {
      if (block.key !== blockKey) return block;
      const filled = fillBlankWorkoutLoads(block.sets);
      return filled.filledCount ? { ...block, sets: filled.sets } : block;
    }));
  };

  const applySetCue = (blockKey: string, cue: SetProgressionCue) => {
    setBlocks((current) => current.map((block) => block.key === blockKey ? {
      ...block,
      sets: block.sets.map((set, index) => index === cue.workingSetIndex ? {
        ...set,
        load: String(cue.loadValue),
        reps: String(cue.targetReps),
        rpe: '',
      } : set),
    } : block));
  };

  const addExercise = () => {
    const unused = catalog?.find((exercise) => !blocks.some((block) => block.exerciseId === exercise.id));
    if (!unused) return;
    setBlocks((current) => [...current, newBlock(unused.id)]);
  };

  const addCustomExercise = async () => {
    const name = customName.trim();
    if (!name) {
      setFormError('Give your custom exercise a name.');
      return;
    }
    setCustomSaving(true);
    setFormError(null);
    try {
      const exercise = await createCustomExercise(db, {
        name,
        movementPattern: `custom_${customMuscle}`,
        primaryMuscleGroup: customMuscle,
        secondaryMuscleGroups: customSecondaryMuscles,
        equipment: 'custom',
        targetRepMin: 8,
        targetRepMax: 12,
        loadIncrement: unit === 'kg' ? 2.5 : 5,
        notes: customNotes.trim() || undefined,
      });
      setCatalog((current) => [exercise, ...(current ?? [])]);
      setBlocks((current) => {
        const last = current.at(-1);
        if (last && last.sets.every(isRowEmpty)) {
          return current.map((block) => block.key === last.key ? { ...block, exerciseId: exercise.id, progression: null, sourceSets: null } : block);
        }
        return [...current, newBlock(exercise.id)];
      });
      setCustomName('');
      setCustomNotes('');
      setCustomSecondaryMuscles([]);
      setCustomOpen(false);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not add that exercise.');
    } finally {
      setCustomSaving(false);
    }
  };

  const submit = async () => {
    if (!catalog || submitLockRef.current) return;
    submitLockRef.current = true;
    let saved = false;
    setSaving(true);
    setFormError(null);
    try {
      const exercises = blocks.flatMap((block) => {
        const completedRows = block.sets.filter((set) => !isRowEmpty(set));
        if (completedRows.length === 0) return [];
        const exercise = catalog.find((item) => item.id === block.exerciseId);
        if (!exercise) throw new Error('Choose an exercise for every completed set.');
        const sets = completedRows.map((set, index) => {
          if (!set.load.trim() || !set.reps.trim()) {
            throw new Error(`${exercise.name}, set ${index + 1}: enter both load and reps.`);
          }
          return {
            id: set.id,
            loadValue: Number(set.load),
            reps: Number(set.reps),
            rpe: set.rpe.trim() ? Number(set.rpe) : null,
            loadUnit: unit,
            kind: 'working' as const,
          };
        });
        return [{ exercise, sets }];
      });
      if (exercises.length === 0) throw new Error('Complete at least one set before saving.');
      if (exercises.some((entry) => entry.sets.some((set) =>
        !Number.isFinite(set.loadValue)
        || set.loadValue < 0
        || !Number.isInteger(set.reps)
        || set.reps <= 0
        || (set.rpe != null && (!Number.isFinite(set.rpe) || set.rpe < 1 || set.rpe > 10))
      ))) {
        throw new Error('Use a non-negative load, whole-number reps, and optional RPE from 1–10.');
      }
      const startedAt = editWorkoutId && editStartedAt
        ? editStartedAt
        : planWorkoutId ? new Date().toISOString() : date ? localTimestampForDate(date) : new Date().toISOString();
      const id = editWorkoutId
        ? await updateWorkout(db, editWorkoutId, { id: workoutIdRef.current, title, startedAt, exercises })
        : planWorkoutId
        ? await completePlannedWorkout(db, planWorkoutId, { id: workoutIdRef.current, title, startedAt, exercises })
        : await saveWorkout(db, { id: workoutIdRef.current, title, startedAt, exercises });
      saved = true;
      if (process.env.EXPO_OS === 'web' && draftOwnerUserId) {
        globalThis.localStorage?.removeItem(workoutDraftStorageKey(draftOwnerUserId, draftContext));
      }
      router.replace({ pathname: '/workouts/[id]', params: { id } });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Please check the sets and try again.';
      setFormError(message);
      if (process.env.EXPO_OS !== 'web') Alert.alert('Workout not saved', message);
    } finally {
      if (!saved) submitLockRef.current = false;
      setSaving(false);
    }
  };

  if (!catalog && !loadError) return <Screen><StatePanel title="Preparing your exercise list" body="Loading the on-device catalog." loading /></Screen>;
  if (loadError) return <Screen><StatePanel title="Exercise list unavailable" body={loadError} actionLabel="Try again" onAction={() => void loadCatalog()} /></Screen>;

  const commonExercises = catalog?.slice(0, COMMON_EXERCISE_COUNT) ?? [];

  return (
    <Screen contentContainerStyle={styles.screenContent}>
      {date ? <Card style={{ backgroundColor: colors.surfaceMuted }}><AppText>Logging for <AppText style={{ fontWeight: '800' }}>{formatShortDate(`${date}T12:00:00`)}</AppText></AppText></Card> : null}
      {draftRecovered ? <Card style={{ backgroundColor: colors.successSoft, borderColor: colors.success }}><AppText style={{ color: colors.success, fontWeight: '800' }}>Recovered your unfinished workout</AppText><AppText style={{ color: colors.textMuted }}>Your exercise, set, rep, load, and RPE entries were restored from this account’s browser draft.</AppText></Card> : null}
      <View style={[styles.sessionFields, !compact && styles.sessionFieldsWide]}>
        <Field label="Session name" value={title} onChangeText={setTitle} returnKeyType="done" containerStyle={styles.flex} />
        <View style={styles.unitGroup}>
          <AppText style={styles.label}>Load unit</AppText>
          <View style={styles.pills}><Pill label="kg" active={unit === 'kg'} onPress={() => setUnit('kg')} /><Pill label="lb" active={unit === 'lb'} onPress={() => setUnit('lb')} /></View>
        </View>
      </View>

      {templateWorkoutId || planWorkoutId || editWorkoutId ? (
        <View style={[styles.templateBanner, { backgroundColor: colors.successSoft }]}>
          <AppText style={styles.suggestionTitle}>{editWorkoutId ? 'Editing completed workout' : planWorkoutId ? 'Planned session started' : 'Next session prepared'}</AppText>
          <AppText style={{ color: colors.textMuted }}>{editWorkoutId ? 'Changes update this calendar entry and its progression totals.' : 'Every load and rep starts exactly where this completed session left off. Green suggestions are optional and never overwrite your fields.'}</AppText>
        </View>
      ) : null}

      {jointProgressionHold ? (
        <Card style={{ backgroundColor: colors.warningSoft, borderColor: colors.warning }}>
          <AppText style={[styles.suggestionTitle, { color: colors.warning }]}>Progression suggestions are on hold</AppText>
          <AppText style={{ color: colors.textMuted }}>Your profile contains a joint or injury consideration. Previous sets remain available as a reference, but JIEN will not suggest adding load or reps.</AppText>
        </Card>
      ) : null}

      <Card style={styles.rpeGuide}>
        <View style={styles.rpeHeader}><View style={styles.flex}><AppText style={styles.suggestionTitle}>RPE, simply</AppText><AppText style={{ color: colors.textMuted }}>Rate how many good reps you had left. It is optional.</AppText></View></View>
        <AppText style={{ color: colors.textMuted }}>Estimate clean reps still possible with the same form, not pain or breathlessness.</AppText>
        <View style={styles.rpeScale}>
          <AppText style={styles.rpeItem}><AppText style={styles.rpeNumber}>6</AppText> · 4+ reps left</AppText>
          <AppText style={styles.rpeItem}><AppText style={styles.rpeNumber}>7</AppText> · 3 left</AppText>
          <AppText style={styles.rpeItem}><AppText style={styles.rpeNumber}>8</AppText> · 2 left</AppText>
          <AppText style={styles.rpeItem}><AppText style={styles.rpeNumber}>9</AppText> · 1 left</AppText>
          <AppText style={styles.rpeItem}><AppText style={styles.rpeNumber}>10</AppText> · 0 clean reps left</AppText>
        </View>
      </Card>

      {formError ? <View accessibilityRole="alert" style={[styles.errorBanner, { backgroundColor: colors.dangerSoft }]}><AppText style={{ color: colors.danger }}>{formError}</AppText></View> : null}

      {blocks.map((block, blockIndex) => {
        const selected = catalog?.find((exercise) => exercise.id === block.exerciseId);
        const query = exerciseQueries[block.key]?.trim().toLocaleLowerCase() ?? '';
        const browserOpen = exerciseBrowsers[block.key] ?? false;
        const results = query || browserOpen
          ? catalog?.filter((exercise) => !query || `${exercise.name} ${exercise.primaryMuscleGroup} ${exercise.secondaryMuscleGroups.join(' ')} ${exercise.equipment ?? ''}`.toLocaleLowerCase().includes(query)) ?? []
          : [];
        const loadFill = fillBlankWorkoutLoads(block.sets);
        const latestLoad = latestValidWorkoutLoad(block.sets);
        return (
          <Card key={block.key} style={styles.exerciseCard}>
            <View style={styles.blockHeader}>
              <View style={styles.flex}><AppText style={styles.blockNumber}>EXERCISE {blockIndex + 1}</AppText><AppText style={styles.exerciseName}>{selected?.name ?? 'Choose exercise'}</AppText></View>
              {blocks.length > 1 ? <Button label="Remove" onPress={() => setBlocks((current) => current.filter((item) => item.key !== block.key))} variant="quiet" /> : null}
            </View>

            <View style={styles.pickerSection}>
              <AppText style={styles.pickerLabel}>Common exercises</AppText>
              <View style={styles.catalog}>
                {commonExercises.map((exercise) => <Pill key={exercise.id} label={exercise.name} active={exercise.id === block.exerciseId} onPress={() => setExercise(block.key, exercise.id)} />)}
              </View>
              <View style={styles.exerciseSearchHeader}>
                <Field
                  accessibilityLabel={`Find exercise for exercise ${blockIndex + 1}`}
                  placeholder="Search by exercise, muscle, or equipment"
                  value={exerciseQueries[block.key] ?? ''}
                  onChangeText={(value) => setExerciseQueries((current) => ({ ...current, [block.key]: value }))}
                  containerStyle={styles.flex}
                />
                <Button label={browserOpen ? 'Close list' : `Browse all ${catalog?.length ?? 0}`} onPress={() => setExerciseBrowsers((current) => ({ ...current, [block.key]: !browserOpen }))} variant="secondary" />
              </View>
              {query || browserOpen ? (
                <ScrollView style={[styles.exerciseResultScroll, { borderColor: colors.border }]} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {results.length ? results.map((exercise) => (
                    <Pressable key={exercise.id} accessibilityRole="button" onPress={() => setExercise(block.key, exercise.id)} style={({ pressed }) => [styles.exerciseResult, { borderBottomColor: colors.border }, pressed && styles.pressed]}>
                      <View style={styles.flex}><AppText style={styles.resultName}>{exercise.name}</AppText><AppText style={{ color: colors.textMuted }}>{muscleGroupLabel(exercise.primaryMuscleGroup)} · {exercise.equipment ?? 'bodyweight'}</AppText></View>
                      <AppText style={{ color: exercise.id === block.exerciseId ? colors.success : colors.accent, fontWeight: '700' }}>{exercise.id === block.exerciseId ? 'Selected' : 'Choose'}</AppText>
                    </Pressable>
                  )) : <AppText style={[styles.noResult, { color: colors.textMuted }]}>No match. Add your own exercise below.</AppText>}
                </ScrollView>
              ) : null}
            </View>

            {selected ? <AppText style={[styles.range, { color: colors.textMuted }]}>{muscleGroupLabel(selected.primaryMuscleGroup)} primary{selected.secondaryMuscleGroups.length ? ` · ${selected.secondaryMuscleGroups.map(muscleGroupLabel).join(', ')} assist` : ''} · target {selected.targetRepMin}–{selected.targetRepMax} reps{selected.notes ? ` · ${selected.notes}` : ''}</AppText> : null}
            {block.progression ? (
              <View style={[styles.suggestion, { backgroundColor: block.progression.action === 'hold' ? colors.warningSoft : colors.successSoft }]}>
                <View style={styles.suggestionCopy}>
                  <AppText style={[styles.suggestionTitle, { color: block.progression.action === 'hold' ? colors.warning : colors.success }]}>{block.progression.action === 'hold' ? 'Repeat before increasing' : 'Next small win'}</AppText>
                  <AppText style={styles.suggestionText}>{block.progression.reason}</AppText>
                </View>
              </View>
            ) : null}

            {!compact ? <View style={styles.setTable}>
              <View style={styles.setLabels}>
                <AppText style={styles.setNo}>Set</AppText>
                <AppText style={styles.setInputLabel}>Load ({unit})</AppText>
                <AppText style={styles.setInputLabel}>Reps</AppText>
                <AppText style={styles.setInputLabel}>RPE</AppText>
                <View style={styles.removeColumn} />
              </View>
              {block.sets.map((set, setIndex) => (
                <View key={set.key} style={styles.setRowGroup}>
                  <View style={styles.setRow}>
                    <AppText style={styles.setNo}>{setIndex + 1}</AppText>
                    <Field accessibilityLabel={`Set ${setIndex + 1} load in ${unit}`} value={set.load} onChangeText={(value) => updateSet(block.key, set.key, 'load', value)} keyboardType="decimal-pad" style={styles.compactInput} containerStyle={styles.setField} />
                    <Field accessibilityLabel={`Set ${setIndex + 1} reps`} value={set.reps} onChangeText={(value) => updateSet(block.key, set.key, 'reps', value)} keyboardType="number-pad" style={styles.compactInput} containerStyle={styles.setField} />
                    <Field accessibilityLabel={`Set ${setIndex + 1} RPE`} value={set.rpe} placeholder="—" onChangeText={(value) => updateSet(block.key, set.key, 'rpe', value)} keyboardType="decimal-pad" style={styles.compactInput} containerStyle={styles.setField} />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove set ${setIndex + 1}`}
                      disabled={block.sets.length === 1}
                      onPress={() => setBlocks((current) => current.map((item) => item.key === block.key ? { ...item, sets: item.sets.filter((row) => row.key !== set.key) } : item))}
                      style={({ pressed }) => [styles.removeSet, { borderColor: colors.border }, pressed && styles.pressed, block.sets.length === 1 && styles.disabled]}
                    ><AppText style={{ color: colors.textMuted }}>×</AppText></Pressable>
                  </View>
                  {block.progression?.cues.find((cue) => cue.workingSetIndex === setIndex) ? (
                    <SetCueRow cue={block.progression.cues.find((cue) => cue.workingSetIndex === setIndex)!} onApply={(cue) => applySetCue(block.key, cue)} />
                  ) : null}
                </View>
              ))}
            </View> : (
              <View style={styles.mobileSetList}>
                {block.sets.map((set, setIndex) => (
                  <View key={set.key} style={[styles.mobileSetCard, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
                    <View style={styles.mobileSetHeader}><AppText style={styles.suggestionTitle}>Set {setIndex + 1}</AppText><Pressable accessibilityRole="button" accessibilityLabel={`Remove set ${setIndex + 1}`} disabled={block.sets.length === 1} onPress={() => setBlocks((current) => current.map((item) => item.key === block.key ? { ...item, sets: item.sets.filter((row) => row.key !== set.key) } : item))} style={({ pressed }) => [styles.mobileRemove, pressed && styles.pressed, block.sets.length === 1 && styles.disabled]}><AppText style={{ color: colors.textMuted }}>Remove</AppText></Pressable></View>
                    <View style={styles.mobileSetFields}>
                      <Field label={`Load (${unit})`} value={set.load} onChangeText={(value) => updateSet(block.key, set.key, 'load', value)} keyboardType="decimal-pad" containerStyle={styles.mobileSetField} />
                      <Field label="Reps" value={set.reps} onChangeText={(value) => updateSet(block.key, set.key, 'reps', value)} keyboardType="number-pad" containerStyle={styles.mobileSetField} />
                      <Field label="RPE" value={set.rpe} placeholder="optional" onChangeText={(value) => updateSet(block.key, set.key, 'rpe', value)} keyboardType="decimal-pad" containerStyle={styles.mobileSetField} />
                    </View>
                    {block.progression?.cues.find((cue) => cue.workingSetIndex === setIndex) ? (
                      <SetCueRow cue={block.progression.cues.find((cue) => cue.workingSetIndex === setIndex)!} onApply={(cue) => applySetCue(block.key, cue)} />
                    ) : null}
                  </View>
                ))}
              </View>
            )}
            <View style={styles.setActions}>
              <Button label="Add set" onPress={() => addSet(block.key)} variant="secondary" />
              {loadFill.filledCount > 0 ? <Button label={`Fill ${loadFill.filledCount} blank load${loadFill.filledCount === 1 ? '' : 's'}`} onPress={() => fillBlankLoads(block.key)} variant="quiet" /> : null}
              <AppText style={[styles.setActionNote, { color: colors.textMuted }]}>{latestLoad
                ? `A new set reuses ${latestLoad} ${unit}; reps and RPE stay blank.`
                : 'Enter one load to unlock quick fill. Existing loads are never overwritten.'}</AppText>
            </View>
          </Card>
        );
      })}

      <Button label="Add another exercise" onPress={addExercise} variant="secondary" disabled={!catalog?.some((exercise) => !blocks.some((block) => block.exerciseId === exercise.id))} />

      <Card>
        <View style={styles.customHeader}>
          <View style={styles.flex}><AppText style={styles.exerciseName}>Your own exercise</AppText><AppText style={{ color: colors.textMuted }}>Can’t find the movement you use? Save it once and it stays in your list.</AppText></View>
          <Button label={customOpen ? 'Close' : 'Add custom'} onPress={() => setCustomOpen((value) => !value)} variant="quiet" />
        </View>
        {customOpen ? (
          <View style={styles.customForm}>
            <Field label="Exercise name" placeholder="e.g. Cable high row" value={customName} onChangeText={setCustomName} autoFocus />
            <Field label="Short description (optional)" placeholder="Machine, grip, setup, or cue" value={customNotes} onChangeText={setCustomNotes} multiline />
            <View style={styles.customForm}>
              <View><AppText style={styles.label}>Primary muscle</AppText><AppText style={{ color: colors.textMuted }}>Gets one full working-set credit in the body-part dashboard.</AppText></View>
              {MUSCLE_GROUP_SECTIONS.map((section) => <View key={section} style={styles.muscleSection}><AppText style={[styles.muscleSectionLabel, { color: colors.textMuted }]}>{section}</AppText><View style={styles.searchResults}>{MUSCLE_GROUP_OPTIONS.filter((group) => group.section === section).map((group) => <Pill key={group.value} label={group.label} active={customMuscle === group.value} onPress={() => { setCustomMuscle(group.value); setCustomSecondaryMuscles((current) => current.filter((item) => item !== group.value)); }} />)}</View></View>)}
            </View>
            <View style={styles.customForm}>
              <View><AppText style={styles.label}>Secondary muscles (optional)</AppText><AppText style={{ color: colors.textMuted }}>Each selected assisting muscle gets half-set credit.</AppText></View>
              {MUSCLE_GROUP_SECTIONS.map((section) => <View key={section} style={styles.muscleSection}><AppText style={[styles.muscleSectionLabel, { color: colors.textMuted }]}>{section}</AppText><View style={styles.searchResults}>{MUSCLE_GROUP_OPTIONS.filter((group) => group.section === section && group.value !== customMuscle).map((group) => <Pill key={group.value} label={group.label} active={customSecondaryMuscles.includes(group.value)} onPress={() => setCustomSecondaryMuscles((current) => current.includes(group.value) ? current.filter((item) => item !== group.value) : [...current, group.value])} />)}</View></View>)}
            </View>
            <Button label="Save and use exercise" onPress={() => void addCustomExercise()} busy={customSaving} />
          </View>
        ) : null}
      </Card>

      <SectionHeading title="Finish" detail={editWorkoutId ? 'Removed sets are removed from progression totals; new sets are added to this same session.' : planWorkoutId ? 'Completing this session replaces the calendar plan with the work you actually did.' : 'Review exactly what will be saved to this device first.'} />
      <Card style={{ backgroundColor: draftSummary.needsAttentionCount ? colors.warningSoft : colors.surfaceMuted, borderColor: draftSummary.needsAttentionCount ? colors.warning : colors.border }}>
        <View style={styles.draftSummaryHeader}>
          <View style={styles.flex}>
            <AppText style={styles.suggestionTitle}>{draftSummary.needsAttentionCount
              ? `${draftSummary.needsAttentionCount} set row${draftSummary.needsAttentionCount === 1 ? '' : 's'} need attention`
              : draftSummary.completedSetCount ? 'Ready when you are' : 'Complete your first set'}</AppText>
            <AppText style={{ color: colors.textMuted }}>{draftSummary.needsAttentionCount
              ? 'Every started row needs a valid load and whole-number reps. RPE is optional from 1–10.'
              : `${draftSummary.blankSetCount} blank row${draftSummary.blankSetCount === 1 ? '' : 's'} will be ignored.`}</AppText>
          </View>
        </View>
        <View style={styles.draftSummaryMetrics}>
          <View style={styles.draftSummaryMetric}><AppText style={styles.draftSummaryValue}>{draftSummary.completedSetCount}</AppText><AppText style={{ color: colors.textMuted }}>sets ready</AppText></View>
          <View style={styles.draftSummaryMetric}><AppText style={styles.draftSummaryValue}>{formatDraftWork(draftSummary.work)}</AppText><AppText style={{ color: colors.textMuted }}>{unit}·reps work</AppText></View>
        </View>
      </Card>
      <Button label={editWorkoutId ? 'Save workout changes' : planWorkoutId ? 'Complete planned workout' : 'Save completed workout'} onPress={() => void submit()} busy={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { width: '100%', maxWidth: 980, alignSelf: 'center' },
  sessionFields: { gap: spacing.md },
  sessionFieldsWide: { flexDirection: 'row', alignItems: 'flex-end' },
  unitGroup: { gap: spacing.xs },
  label: { fontWeight: '700' },
  pills: { flexDirection: 'row', gap: spacing.xs },
  flex: { flex: 1 },
  errorBanner: { padding: spacing.md, borderRadius: radii.control },
  templateBanner: { padding: spacing.md, borderRadius: radii.control, gap: spacing.xxs },
  rpeGuide: { gap: spacing.sm },
  rpeHeader: { flexDirection: 'row', alignItems: 'center' },
  rpeScale: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rpeItem: { ...typography.label },
  rpeNumber: { fontWeight: '800' },
  exerciseCard: { paddingHorizontal: 0, overflow: 'hidden' },
  blockHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.sm },
  blockNumber: { ...typography.caption, fontWeight: '700', opacity: 0.65 },
  exerciseName: { ...typography.section, fontWeight: '700' },
  pickerSection: { gap: spacing.sm, paddingHorizontal: spacing.md },
  pickerLabel: { ...typography.label, fontWeight: '700' },
  catalog: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  exerciseSearchHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: spacing.sm },
  exerciseResultScroll: { maxHeight: 288, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control },
  exerciseResult: { minHeight: 58, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  resultName: { fontWeight: '700' },
  noResult: { padding: spacing.md },
  searchResults: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  muscleSection: { gap: spacing.xs },
  muscleSectionLabel: { ...typography.caption, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  range: { paddingHorizontal: spacing.md },
  suggestion: { marginHorizontal: spacing.md, padding: spacing.sm, borderRadius: radii.control, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  suggestionCopy: { flex: 1, gap: spacing.xxs },
  suggestionTitle: { ...typography.label, fontWeight: '700' },
  suggestionText: { ...typography.label },
  setTable: { paddingHorizontal: spacing.md, gap: spacing.xs },
  setLabels: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  setRowGroup: { gap: spacing.xxs },
  setRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  setNo: { flexBasis: 40, flexGrow: 0, flexShrink: 0, textAlign: 'center', ...typography.label, fontWeight: '700' },
  setInputLabel: { flex: 1, minWidth: 0, textAlign: 'center', ...typography.caption, fontWeight: '700', opacity: 0.7 },
  setField: { flex: 1, minWidth: 0 },
  compactInput: { textAlign: 'center', paddingHorizontal: spacing.xs },
  setCue: { marginLeft: 48, paddingLeft: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  setCueCopy: { flex: 1, ...typography.caption, fontWeight: '700' },
  removeColumn: { width: 44 },
  removeSet: { width: 44, minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, alignItems: 'center', justifyContent: 'center' },
  setActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
  setActionNote: { ...typography.caption, flexGrow: 1, flexBasis: 220 },
  draftSummaryHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  draftSummaryMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  draftSummaryMetric: { flexGrow: 1, flexBasis: 160 },
  draftSummaryValue: { ...typography.section, fontWeight: '800', fontVariant: ['tabular-nums'] },
  mobileSetList: { paddingHorizontal: spacing.md, gap: spacing.sm },
  mobileSetCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.sm, gap: spacing.sm },
  mobileSetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mobileSetFields: { flexDirection: 'row', gap: spacing.xs },
  mobileSetField: { flex: 1, minWidth: 0 },
  mobileRemove: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },
  customHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  customForm: { gap: spacing.md },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.35 },
});

function formatDraftWork(value: number): string {
  return (Math.round(value * 10) / 10).toLocaleString();
}

function blocksFromTemplate(template: WorkoutDetail): DraftExercise[] {
  const grouped = new Map<string, DraftExercise>();
  template.sets.filter((set) => set.kind === 'working').forEach((set) => {
    const block = grouped.get(set.exerciseId) ?? {
      key: Crypto.randomUUID(),
      exerciseId: set.exerciseId,
      sets: [],
      progression: null,
      sourceSets: [],
    };
    block.sets.push(newSet(String(set.loadValue), String(set.reps), set.rpe == null ? '' : String(set.rpe)));
    block.sourceSets?.push({
      loadValue: set.loadValue,
      loadUnit: set.loadUnit,
      reps: set.reps,
      rpe: set.rpe,
      kind: set.kind,
    });
    grouped.set(set.exerciseId, block);
  });
  return [...grouped.values()];
}

function blocksFromEdit(template: WorkoutDetail): DraftExercise[] {
  const grouped = new Map<string, DraftExercise>();
  template.sets.filter((set) => set.kind === 'working').forEach((set) => {
    const block = grouped.get(set.exerciseId) ?? {
      key: Crypto.randomUUID(), exerciseId: set.exerciseId, sets: [], progression: null, sourceSets: null,
    };
    block.sets.push(newSet(
      String(set.loadValue), String(set.reps), set.rpe == null ? '' : String(set.rpe), set.id,
    ));
    grouped.set(set.exerciseId, block);
  });
  return [...grouped.values()];
}

function blocksFromPlan(template: WorkoutDetail): DraftExercise[] {
  return template.plan?.exercises.map((exercise) => ({
    key: Crypto.randomUUID(),
    exerciseId: exercise.exerciseId,
    sets: exercise.sets.map((set) => newSet(
      set.loadValue == null ? '' : String(set.loadValue),
      set.reps == null ? '' : String(set.reps),
    )),
    progression: exercise.progression,
    sourceSets: exercise.sets.flatMap((set) => set.loadValue == null || set.reps == null ? [] : [{
      loadValue: set.loadValue,
      loadUnit: set.loadUnit,
      reps: set.reps,
      rpe: null,
      kind: 'working' as const,
    }]),
  })) ?? [];
}

function SetCueRow({ cue, onApply }: { cue: SetProgressionCue; onApply: (cue: SetProgressionCue) => void }) {
  const { colors } = useJienTheme();
  return (
    <View style={styles.setCue}>
      <AppText style={[styles.setCueCopy, { color: colors.success }]}>{cue.label}</AppText>
      <Button label="Use" onPress={() => onApply(cue)} variant="quiet" />
    </View>
  );
}
