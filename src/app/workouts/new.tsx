import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, SectionHeading, StatePanel } from '@/components/ui';
import {
  createCustomExercise,
  getExerciseHistory,
  getUserProfile,
  listExercises,
  saveWorkout,
  type Exercise,
  type LoadUnit,
} from '@/lib/db';
import { suggestDoubleProgression, type ProgressionSuggestion } from '@/lib/progression';
import { radii, spacing, typography, useJienTheme } from '@/theme';

type DraftSet = { key: string; load: string; reps: string; rpe: string };
type DraftExercise = {
  key: string;
  exerciseId: string;
  sets: DraftSet[];
  suggestion: ProgressionSuggestion | null;
};

const COMMON_EXERCISE_COUNT = 8;
const MUSCLE_GROUPS = ['chest', 'back', 'quadriceps', 'hamstrings', 'glutes', 'shoulders', 'arms', 'core'];
const newSet = (load = '', reps = '', rpe = ''): DraftSet => ({ key: Crypto.randomUUID(), load, reps, rpe });
const newBlock = (exerciseId: string): DraftExercise => ({
  key: Crypto.randomUUID(),
  exerciseId,
  sets: [newSet(), newSet(), newSet()],
  suggestion: null,
});
const isRowEmpty = (set: DraftSet) => !set.load.trim() && !set.reps.trim() && !set.rpe.trim();

export default function NewWorkoutScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
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
  const [saving, setSaving] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customNotes, setCustomNotes] = useState('');
  const [customMuscle, setCustomMuscle] = useState(MUSCLE_GROUPS[0]!);
  const [customSaving, setCustomSaving] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoadError(null);
    try {
      const [exercises, profile] = await Promise.all([listExercises(db), getUserProfile(db)]);
      setCatalog(exercises);
      if (profile) setUnit(profile.preferredLoadUnit);
      setBlocks((current) => current.length ? current : [newBlock(exercises[0]?.id ?? '')]);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not load exercises.');
    }
  }, [db]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const updateSuggestion = useCallback(async (blockKey: string, exerciseId: string) => {
    const exercise = catalog?.find((item) => item.id === exerciseId);
    if (!exercise) return;
    const history = await getExerciseHistory(db, exerciseId, 3);
    const suggestion = suggestDoubleProgression({
      sets: history,
      repMin: exercise.targetRepMin,
      repMax: exercise.targetRepMax,
      loadIncrement: exercise.loadIncrement,
    });
    setBlocks((current) => current.map((block) => block.key === blockKey ? { ...block, suggestion } : block));
  }, [catalog, db]);

  useEffect(() => {
    blocks.forEach((block) => {
      if (block.exerciseId && block.suggestion == null) void updateSuggestion(block.key, block.exerciseId);
    });
  }, [blocks, updateSuggestion]);

  const setExercise = (blockKey: string, exerciseId: string) => {
    setBlocks((current) => current.map((block) => block.key === blockKey ? { ...block, exerciseId, suggestion: null } : block));
    setExerciseQueries((current) => ({ ...current, [blockKey]: '' }));
  };

  const updateSet = (blockKey: string, setKey: string, field: 'load' | 'reps' | 'rpe', value: string) => {
    setFormError(null);
    setBlocks((current) => current.map((block) => block.key === blockKey ? {
      ...block,
      sets: block.sets.map((set) => set.key === setKey ? { ...set, [field]: value } : set),
    } : block));
  };

  const applySuggestion = (blockKey: string) => {
    setBlocks((current) => current.map((block) => {
      if (block.key !== blockKey || !block.suggestion || block.suggestion.action === 'start' || block.suggestion.action === 'hold') return block;
      const suggestion = block.suggestion;
      const targetReps = suggestion.targetReps.map(String);
      return {
        ...block,
        sets: block.sets.map((set, index) => ({
          ...set,
          load: String(suggestion.loadValue),
          reps: targetReps[index] ?? set.reps,
        })),
      };
    }));
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
          return current.map((block) => block.key === last.key ? { ...block, exerciseId: exercise.id, suggestion: null } : block);
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

      {formError ? <View accessibilityRole="alert" style={[styles.errorBanner, { backgroundColor: colors.dangerSoft }]}><AppText style={{ color: colors.danger }}>{formError}</AppText></View> : null}

      {blocks.map((block, blockIndex) => {
        const selected = catalog?.find((exercise) => exercise.id === block.exerciseId);
        const query = exerciseQueries[block.key]?.trim().toLocaleLowerCase() ?? '';
        const results = query
          ? catalog?.filter((exercise) => `${exercise.name} ${exercise.primaryMuscleGroup} ${exercise.equipment ?? ''}`.toLocaleLowerCase().includes(query)).slice(0, 12) ?? []
          : [];
        return (
          <Card key={block.key} style={styles.exerciseCard}>
            <View style={styles.blockHeader}>
              <View style={styles.flex}><AppText style={styles.blockNumber}>EXERCISE {blockIndex + 1}</AppText><AppText style={styles.exerciseName}>{selected?.name ?? 'Choose exercise'}</AppText></View>
              {blocks.length > 1 ? <Button label="Remove" onPress={() => setBlocks((current) => current.filter((item) => item.key !== block.key))} variant="quiet" /> : null}
            </View>

            <View style={styles.pickerSection}>
              <AppText style={styles.pickerLabel}>Common exercises</AppText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catalog}>
                {commonExercises.map((exercise) => <Pill key={exercise.id} label={exercise.name} active={exercise.id === block.exerciseId} onPress={() => setExercise(block.key, exercise.id)} />)}
              </ScrollView>
              <Field
                accessibilityLabel={`Find exercise for exercise ${blockIndex + 1}`}
                placeholder="Search all exercises"
                value={exerciseQueries[block.key] ?? ''}
                onChangeText={(value) => setExerciseQueries((current) => ({ ...current, [block.key]: value }))}
              />
              {query ? (
                <View style={styles.searchResults}>
                  {results.length ? results.map((exercise) => <Pill key={exercise.id} label={exercise.name} active={exercise.id === block.exerciseId} onPress={() => setExercise(block.key, exercise.id)} />) : <AppText style={{ color: colors.textMuted }}>No match. Add your own exercise below.</AppText>}
                </View>
              ) : null}
            </View>

            {selected ? <AppText style={[styles.range, { color: colors.textMuted }]}>{selected.primaryMuscleGroup.replaceAll('_', ' ')} · target {selected.targetRepMin}–{selected.targetRepMax} reps{selected.notes ? ` · ${selected.notes}` : ''}</AppText> : null}
            {block.suggestion ? (
              <View style={[styles.suggestion, { backgroundColor: colors.successSoft }]}>
                <View style={styles.suggestionCopy}><AppText style={styles.suggestionTitle}>Next small win</AppText><AppText style={styles.suggestionText}>{block.suggestion.reason}</AppText></View>
                {block.suggestion.action === 'add_reps' || block.suggestion.action === 'add_load' ? <Button label="Apply" onPress={() => applySuggestion(block.key)} variant="quiet" /> : null}
              </View>
            ) : null}

            <View style={styles.setTable}>
              <View style={styles.setLabels}>
                <AppText style={styles.setNo}>Set</AppText>
                <AppText style={styles.setInputLabel}>Load ({unit})</AppText>
                <AppText style={styles.setInputLabel}>Reps</AppText>
                <AppText style={styles.setInputLabel}>RPE</AppText>
                <View style={styles.removeColumn} />
              </View>
              {block.sets.map((set, setIndex) => (
                <View key={set.key} style={styles.setRow}>
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
              ))}
            </View>
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
  exerciseCard: { paddingHorizontal: 0, overflow: 'hidden' },
  blockHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.sm },
  blockNumber: { ...typography.caption, fontWeight: '700', opacity: 0.65 },
  exerciseName: { ...typography.section, fontWeight: '700' },
  pickerSection: { gap: spacing.sm, paddingHorizontal: spacing.md },
  pickerLabel: { ...typography.label, fontWeight: '700' },
  catalog: { gap: spacing.xs, paddingRight: spacing.md },
  searchResults: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  range: { paddingHorizontal: spacing.md },
  suggestion: { marginHorizontal: spacing.md, padding: spacing.sm, borderRadius: radii.control, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  suggestionCopy: { flex: 1, gap: spacing.xxs },
  suggestionTitle: { ...typography.label, fontWeight: '700' },
  suggestionText: { ...typography.label },
  setTable: { paddingHorizontal: spacing.md, gap: spacing.xs },
  setLabels: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  setRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  setNo: { flexBasis: 40, flexGrow: 0, flexShrink: 0, textAlign: 'center', ...typography.label, fontWeight: '700' },
  setInputLabel: { flex: 1, minWidth: 0, textAlign: 'center', ...typography.caption, fontWeight: '700', opacity: 0.7 },
  setField: { flex: 1, minWidth: 0 },
  compactInput: { textAlign: 'center', paddingHorizontal: spacing.xs },
  removeColumn: { width: 44 },
  removeSet: { width: 44, minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, alignItems: 'center', justifyContent: 'center' },
  setActions: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md },
  customHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  customForm: { gap: spacing.md },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.35 },
});
