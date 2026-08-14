import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, SectionHeading, StatePanel } from '@/components/ui';
import {
  createCustomExercise,
  getLastExerciseSessionSets,
  getWorkoutDetail,
  getUserProfile,
  listExercises,
  saveWorkout,
  type Exercise,
  type LoadUnit,
  type WorkoutDetail,
} from '@/lib/db';
import {
  buildSetProgressionPlan,
  type ProgressionSet,
  type SetProgressionCue,
  type SetProgressionPlan,
} from '@/lib/progression';
import { radii, spacing, typography, useJienTheme } from '@/theme';

type DraftSet = { key: string; load: string; reps: string; rpe: string };
type DraftExercise = {
  key: string;
  exerciseId: string;
  sets: DraftSet[];
  progression: SetProgressionPlan | null;
  sourceSets: ProgressionSet[] | null;
};

const COMMON_EXERCISE_COUNT = 12;
const MUSCLE_GROUPS = ['chest', 'back', 'quadriceps', 'hamstrings', 'glutes', 'shoulders', 'arms', 'core'];
const newSet = (load = '', reps = '', rpe = ''): DraftSet => ({ key: Crypto.randomUUID(), load, reps, rpe });
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
  const { templateWorkoutId } = useLocalSearchParams<{ templateWorkoutId?: string }>();
  const { width } = useWindowDimensions();
  const compact = width < 520;
  const { colors } = useJienTheme();
  const [catalog, setCatalog] = useState<Exercise[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [title, setTitle] = useState('Training session');
  const [unit, setUnit] = useState<LoadUnit>('kg');
  const [blocks, setBlocks] = useState<DraftExercise[]>([]);
  const [exerciseQueries, setExerciseQueries] = useState<Record<string, string>>({});
  const [exerciseBrowsers, setExerciseBrowsers] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customNotes, setCustomNotes] = useState('');
  const [customMuscle, setCustomMuscle] = useState(MUSCLE_GROUPS[0]!);
  const [customSaving, setCustomSaving] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoadError(null);
    try {
      const [exercises, profile, template] = await Promise.all([
        listExercises(db),
        getUserProfile(db),
        templateWorkoutId ? getWorkoutDetail(db, templateWorkoutId) : Promise.resolve(null),
      ]);
      setCatalog(exercises);
      if (template?.sets[0]) setUnit(template.sets[0].loadUnit);
      else if (profile) setUnit(profile.preferredLoadUnit);
      if (template) {
        setTitle(template.title);
        setBlocks(blocksFromTemplate(template));
      } else {
        setBlocks((current) => current.length ? current : [newBlock(exercises[0]?.id ?? '')]);
      }
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not load exercises.');
    }
  }, [db, templateWorkoutId]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const updateProgression = useCallback(async (blockKey: string, exerciseId: string, sourceSets: ProgressionSet[] | null) => {
    const exercise = catalog?.find((item) => item.id === exerciseId);
    if (!exercise) return;
    const history = sourceSets ?? await getLastExerciseSessionSets(db, exerciseId);
    const progression = buildSetProgressionPlan({
      sets: history,
      repMin: exercise.targetRepMin,
      repMax: exercise.targetRepMax,
      loadIncrement: unit === 'lb' ? Math.max(5, exercise.loadIncrement) : exercise.loadIncrement,
    });
    setBlocks((current) => current.map((block) => block.key === blockKey ? { ...block, progression } : block));
  }, [catalog, db, unit]);

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
      setCustomOpen(false);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not add that exercise.');
    } finally {
      setCustomSaving(false);
    }
  };

  const submit = async () => {
    if (!catalog) return;
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
      const id = await saveWorkout(db, { title, startedAt: new Date().toISOString(), exercises });
      router.replace({ pathname: '/workouts/[id]', params: { id } });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Please check the sets and try again.';
      setFormError(message);
      if (process.env.EXPO_OS !== 'web') Alert.alert('Workout not saved', message);
    } finally {
      setSaving(false);
    }
  };

  if (!catalog && !loadError) return <Screen><StatePanel title="Preparing your exercise list" body="Loading the on-device catalog." loading /></Screen>;
  if (loadError) return <Screen><StatePanel title="Exercise list unavailable" body={loadError} actionLabel="Try again" onAction={() => void loadCatalog()} /></Screen>;

  const commonExercises = catalog?.slice(0, COMMON_EXERCISE_COUNT) ?? [];

  return (
    <Screen contentContainerStyle={styles.screenContent}>
      <View style={[styles.sessionFields, !compact && styles.sessionFieldsWide]}>
        <Field label="Session name" value={title} onChangeText={setTitle} returnKeyType="done" containerStyle={styles.flex} />
        <View style={styles.unitGroup}>
          <AppText style={styles.label}>Load unit</AppText>
          <View style={styles.pills}><Pill label="kg" active={unit === 'kg'} onPress={() => setUnit('kg')} /><Pill label="lb" active={unit === 'lb'} onPress={() => setUnit('lb')} /></View>
        </View>
      </View>

      {templateWorkoutId ? (
        <View style={[styles.templateBanner, { backgroundColor: colors.successSoft }]}>
          <AppText style={styles.suggestionTitle}>Next session prepared</AppText>
          <AppText style={{ color: colors.textMuted }}>Every load and rep starts exactly where this completed session left off. Green suggestions are optional and never overwrite your fields.</AppText>
        </View>
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
          ? catalog?.filter((exercise) => !query || `${exercise.name} ${exercise.primaryMuscleGroup} ${exercise.equipment ?? ''}`.toLocaleLowerCase().includes(query)) ?? []
          : [];
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
                      <View style={styles.flex}><AppText style={styles.resultName}>{exercise.name}</AppText><AppText style={{ color: colors.textMuted }}>{exercise.primaryMuscleGroup.replaceAll('_', ' ')} · {exercise.equipment ?? 'bodyweight'}</AppText></View>
                      <AppText style={{ color: exercise.id === block.exerciseId ? colors.success : colors.accent, fontWeight: '700' }}>{exercise.id === block.exerciseId ? 'Selected' : 'Choose'}</AppText>
                    </Pressable>
                  )) : <AppText style={[styles.noResult, { color: colors.textMuted }]}>No match. Add your own exercise below.</AppText>}
                </ScrollView>
              ) : null}
            </View>

            {selected ? <AppText style={[styles.range, { color: colors.textMuted }]}>{selected.primaryMuscleGroup.replaceAll('_', ' ')} · target {selected.targetRepMin}–{selected.targetRepMax} reps{selected.notes ? ` · ${selected.notes}` : ''}</AppText> : null}
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
            <View style={styles.setActions}><Button label="Add set" onPress={() => setBlocks((current) => current.map((item) => item.key === block.key ? { ...item, sets: [...item.sets, newSet()] } : item))} variant="secondary" /></View>
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
            <View style={styles.customForm}><AppText style={styles.label}>Primary area</AppText><View style={styles.searchResults}>{MUSCLE_GROUPS.map((group) => <Pill key={group} label={group} active={customMuscle === group} onPress={() => setCustomMuscle(group)} />)}</View></View>
            <Button label="Save and use exercise" onPress={() => void addCustomExercise()} busy={customSaving} />
          </View>
        ) : null}
      </Card>

      <SectionHeading title="Finish" detail="Blank rows are ignored. Your completed sets save to this device first." />
      <Button label="Save completed workout" onPress={() => void submit()} busy={saving} />
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
  setActions: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md },
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
    block.sets.push(newSet(String(set.loadValue), String(set.reps)));
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

function SetCueRow({ cue, onApply }: { cue: SetProgressionCue; onApply: (cue: SetProgressionCue) => void }) {
  const { colors } = useJienTheme();
  return (
    <View style={styles.setCue}>
      <AppText style={[styles.setCueCopy, { color: colors.success }]}>{cue.label}</AppText>
      <Button label="Use" onPress={() => onApply(cue)} variant="quiet" />
    </View>
  );
}
