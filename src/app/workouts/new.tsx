import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, SectionHeading, StatePanel } from '@/components/ui';
import { getExerciseHistory, listExercises, saveWorkout, type Exercise, type LoadUnit } from '@/lib/db';
import { suggestDoubleProgression } from '@/lib/progression';
import { radii, spacing, typography, useJienTheme } from '@/theme';

type DraftSet = { key: string; load: string; reps: string; rpe: string };
type DraftExercise = { key: string; exerciseId: string; sets: DraftSet[]; suggestion: string | null };

const newSet = (load = '', reps = ''): DraftSet => ({ key: Crypto.randomUUID(), load, reps, rpe: '' });

export default function NewWorkoutScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const [catalog, setCatalog] = useState<Exercise[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('Training session');
  const [unit, setUnit] = useState<LoadUnit>('kg');
  const [blocks, setBlocks] = useState<DraftExercise[]>([]);
  const [saving, setSaving] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoadError(null);
    try {
      const exercises = await listExercises(db);
      setCatalog(exercises);
      setBlocks((current) => current.length ? current : [{ key: Crypto.randomUUID(), exerciseId: exercises[0]?.id ?? '', sets: [newSet(), newSet(), newSet()], suggestion: null }]);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not load exercises.');
    }
  }, [db]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const updateSuggestion = useCallback(async (blockKey: string, exerciseId: string) => {
    const exercise = catalog?.find((item) => item.id === exerciseId);
    if (!exercise) return;
    const history = await getExerciseHistory(db, exerciseId, 3);
    const suggestion = suggestDoubleProgression({ sets: history, repMin: exercise.targetRepMin, repMax: exercise.targetRepMax, loadIncrement: exercise.loadIncrement });
    setBlocks((current) => current.map((block) => block.key === blockKey ? { ...block, suggestion: suggestion.reason } : block));
  }, [catalog, db]);

  useEffect(() => {
    blocks.forEach((block) => {
      if (block.exerciseId && block.suggestion == null) void updateSuggestion(block.key, block.exerciseId);
    });
  }, [blocks, updateSuggestion]);

  const setExercise = (blockKey: string, exerciseId: string) => {
    setBlocks((current) => current.map((block) => block.key === blockKey ? { ...block, exerciseId, suggestion: null } : block));
  };
  const updateSet = (blockKey: string, setKey: string, field: 'load' | 'reps' | 'rpe', value: string) => {
    setBlocks((current) => current.map((block) => block.key === blockKey ? { ...block, sets: block.sets.map((set) => set.key === setKey ? { ...set, [field]: value } : set) } : block));
  };
  const addExercise = () => {
    const unused = catalog?.find((exercise) => !blocks.some((block) => block.exerciseId === exercise.id));
    if (!unused) return;
    setBlocks((current) => [...current, { key: Crypto.randomUUID(), exerciseId: unused.id, sets: [newSet(), newSet(), newSet()], suggestion: null }]);
  };

  const submit = async () => {
    if (!catalog) return;
    setSaving(true);
    try {
      const exercises = blocks.map((block) => {
        const exercise = catalog.find((item) => item.id === block.exerciseId);
        if (!exercise) throw new Error('Choose an exercise for every section.');
        return {
          exercise,
          sets: block.sets.map((set) => ({
            loadValue: Number(set.load),
            reps: Number(set.reps),
            rpe: set.rpe.trim() ? Number(set.rpe) : null,
            loadUnit: unit,
            kind: 'working' as const,
          })),
        };
      });
      if (exercises.some((entry) => entry.sets.some((set) => !Number.isFinite(set.loadValue) || !Number.isFinite(set.reps) || (set.rpe != null && (!Number.isFinite(set.rpe) || set.rpe < 1 || set.rpe > 10))))) {
        throw new Error('Enter a valid load, reps, and optional RPE from 1–10 for every set.');
      }
      const id = await saveWorkout(db, { title, startedAt: new Date().toISOString(), exercises });
      router.replace({ pathname: '/workouts/[id]', params: { id } });
    } catch (cause) {
      Alert.alert('Workout not saved', cause instanceof Error ? cause.message : 'Please check the sets and try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!catalog && !loadError) return <Screen><StatePanel title="Preparing your exercise list" body="Loading the on-device catalog." loading /></Screen>;
  if (loadError) return <Screen><StatePanel title="Exercise list unavailable" body={loadError} actionLabel="Try again" onAction={() => void loadCatalog()} /></Screen>;

  return (
    <Screen>
      <Field label="Session name" value={title} onChangeText={setTitle} returnKeyType="done" />
      <View style={styles.unitRow}><AppText style={styles.label}>Load unit</AppText><View style={styles.pills}><Pill label="kg" active={unit === 'kg'} onPress={() => setUnit('kg')} /><Pill label="lb" active={unit === 'lb'} onPress={() => setUnit('lb')} /></View></View>

      {blocks.map((block, blockIndex) => {
        const selected = catalog?.find((exercise) => exercise.id === block.exerciseId);
        return (
          <Card key={block.key} style={styles.exerciseCard}>
            <View style={styles.blockHeader}><View style={styles.flex}><AppText style={styles.blockNumber}>EXERCISE {blockIndex + 1}</AppText><AppText style={styles.exerciseName}>{selected?.name ?? 'Choose exercise'}</AppText></View>{blocks.length > 1 ? <Button label="Remove" onPress={() => setBlocks((current) => current.filter((item) => item.key !== block.key))} variant="quiet" /> : null}</View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catalog}>
              {catalog?.map((exercise) => <Pill key={exercise.id} label={exercise.name} active={exercise.id === block.exerciseId} onPress={() => setExercise(block.key, exercise.id)} />)}
            </ScrollView>
            {selected ? <AppText style={[styles.range, { color: colors.textMuted }]}>{selected.primaryMuscleGroup.replaceAll('_', ' ')} · target {selected.targetRepMin}–{selected.targetRepMax} reps</AppText> : null}
            {block.suggestion ? <View style={[styles.suggestion, { backgroundColor: colors.successSoft }]}><AppText style={styles.suggestionText}>{block.suggestion}</AppText></View> : null}
            <View style={styles.setLabels}><AppText style={styles.setNo}>Set</AppText><AppText style={styles.setInput}>Load</AppText><AppText style={styles.setInput}>Reps</AppText><AppText style={styles.setInput}>RPE</AppText></View>
            {block.sets.map((set, setIndex) => (
              <View key={set.key} style={styles.setRow}>
                <AppText style={styles.setNo}>{setIndex + 1}</AppText>
                <Field accessibilityLabel={`Set ${setIndex + 1} load`} label="" value={set.load} onChangeText={(value) => updateSet(block.key, set.key, 'load', value)} keyboardType="decimal-pad" style={styles.compactInput} />
                <Field accessibilityLabel={`Set ${setIndex + 1} reps`} label="" value={set.reps} onChangeText={(value) => updateSet(block.key, set.key, 'reps', value)} keyboardType="number-pad" style={styles.compactInput} />
                <Field accessibilityLabel={`Set ${setIndex + 1} RPE`} label="" value={set.rpe} placeholder="—" onChangeText={(value) => updateSet(block.key, set.key, 'rpe', value)} keyboardType="decimal-pad" style={styles.compactInput} />
              </View>
            ))}
            <View style={styles.setActions}><Button label="Add set" onPress={() => setBlocks((current) => current.map((item) => item.key === block.key ? { ...item, sets: [...item.sets, newSet()] } : item))} variant="secondary" />{block.sets.length > 1 ? <Button label="Remove last" onPress={() => setBlocks((current) => current.map((item) => item.key === block.key ? { ...item, sets: item.sets.slice(0, -1) } : item))} variant="quiet" /> : null}</View>
          </Card>
        );
      })}
      <Button label="Add another exercise" onPress={addExercise} variant="secondary" disabled={!catalog?.some((exercise) => !blocks.some((block) => block.exerciseId === exercise.id))} />
      <SectionHeading title="Finish" detail="Saved to this device first; sync happens separately" />
      <Button label="Save completed workout" onPress={() => void submit()} busy={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  unitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontWeight: '700' },
  pills: { flexDirection: 'row', gap: spacing.xs },
  exerciseCard: { paddingHorizontal: 0, overflow: 'hidden' },
  blockHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.sm },
  flex: { flex: 1 },
  blockNumber: { ...typography.caption, fontWeight: '700', opacity: 0.65 },
  exerciseName: { ...typography.section, fontWeight: '700' },
  catalog: { gap: spacing.xs, paddingHorizontal: spacing.md },
  range: { paddingHorizontal: spacing.md },
  suggestion: { marginHorizontal: spacing.md, padding: spacing.sm, borderRadius: radii.control },
  suggestionText: { ...typography.label },
  setLabels: { flexDirection: 'row', paddingHorizontal: spacing.md, gap: spacing.xs, alignItems: 'center' },
  setRow: { flexDirection: 'row', paddingHorizontal: spacing.md, gap: spacing.xs, alignItems: 'center' },
  setNo: { width: 36, textAlign: 'center', ...typography.label, fontWeight: '700' },
  setInput: { flex: 1, textAlign: 'center', ...typography.label, opacity: 0.7 },
  compactInput: { textAlign: 'center', paddingHorizontal: spacing.xs },
  setActions: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md },
});
