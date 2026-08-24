import { useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { exerciseTargetsNeedReview, isStarterExerciseId, listExercises, updateExerciseTargets } from '@/lib/db';
import type { Exercise } from '@/lib/db/types';
import { MUSCLE_GROUP_OPTIONS, MUSCLE_GROUP_SECTIONS, muscleGroupLabel, normalizeMuscleGroupKey } from '@/lib/progression';
import { radii, spacing, typography, useJienTheme } from '@/theme';

type CatalogFilter = 'all' | 'review' | 'custom' | 'jien';

export default function ExerciseLibraryScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const [query, setQuery] = useState('');
  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [primaryMuscle, setPrimaryMuscle] = useState('chest');
  const [secondaryMuscles, setSecondaryMuscles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedExerciseId, setSavedExerciseId] = useState<string | null>(null);
  const loader = useCallback(() => listExercises(db), [db]);
  const { data, error, loading, reload } = useScreenData(loader);
  const exercises = data ?? [];
  const editingExercise = exercises.find((exercise) => exercise.id === editingId) ?? null;
  const filteredExercises = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return exercises.filter((exercise) => {
      const starter = isStarterExerciseId(exercise.id);
      if (catalogFilter === 'review' && !exerciseTargetsNeedReview(exercise)) return false;
      if (catalogFilter === 'custom' && starter) return false;
      if (catalogFilter === 'jien' && !starter) return false;
      if (!term) return true;
      const searchable = [
        exercise.name,
        exercise.equipment ?? 'bodyweight',
        muscleGroupLabel(exercise.primaryMuscleGroup),
        ...exercise.secondaryMuscleGroups.map(muscleGroupLabel),
      ].join(' ').toLocaleLowerCase();
      return searchable.includes(term);
    });
  }, [catalogFilter, exercises, query]);
  const customCount = exercises.filter((exercise) => !isStarterExerciseId(exercise.id)).length;
  const reviewCount = exercises.filter(exerciseTargetsNeedReview).length;

  const beginEditing = (exercise: Exercise) => {
    const normalizedPrimary = normalizeMuscleGroupKey(exercise.primaryMuscleGroup);
    setEditingId(exercise.id);
    setPrimaryMuscle(normalizedPrimary);
    setSecondaryMuscles([...new Set(exercise.secondaryMuscleGroups.map(normalizeMuscleGroupKey))]
      .filter((group) => group !== normalizedPrimary));
    setFormError(null);
    setSavedExerciseId(null);
  };

  const saveTargets = async () => {
    if (!editingExercise) return;
    setSaving(true);
    setFormError(null);
    try {
      await updateExerciseTargets(db, editingExercise.id, {
        primaryMuscleGroup: primaryMuscle,
        secondaryMuscleGroups: secondaryMuscles,
      });
      setSavedExerciseId(editingExercise.id);
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'The muscle targets could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen contentContainerStyle={styles.content}>
      <ScreenHeading
        title="Exercise targets"
        action={<Button label="Done" onPress={() => router.back()} variant="quiet" />}
      />
      <Card style={[styles.guidance, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
        <AppText style={styles.guidanceTitle}>Set muscle targets</AppText>
        <AppText style={{ color: colors.textMuted }}>
          Primary targets count as one working set; assisting targets count as half. Changes apply to future logs only.
        </AppText>
      </Card>

      <Card style={{ backgroundColor: colors.surfaceMuted }}>
        <Field
          label="Find an exercise"
          value={query}
          onChangeText={setQuery}
          placeholder="Name, equipment, or muscle…"
          returnKeyType="search"
        />
        <View style={styles.filters}>
          <Pill label={`All ${exercises.length}`} active={catalogFilter === 'all'} onPress={() => setCatalogFilter('all')} />
          <Pill label={`Check tags ${reviewCount}`} active={catalogFilter === 'review'} onPress={() => setCatalogFilter('review')} />
          <Pill label={`Custom ${customCount}`} active={catalogFilter === 'custom'} onPress={() => setCatalogFilter('custom')} />
          <Pill label={`JIEN ${exercises.length - customCount}`} active={catalogFilter === 'jien'} onPress={() => setCatalogFilter('jien')} />
        </View>
      </Card>

      {editingExercise ? (
        <Card accessibilityLabel={`Editing targets for ${editingExercise.name}`} style={[styles.editor, { borderColor: colors.accent }]}>
          <View style={styles.editorHeader}>
            <View style={styles.flex}>
              <AppText style={[styles.kicker, { color: colors.accent }]}>EDITING</AppText>
              <AppText style={styles.editorTitle}>{editingExercise.name}</AppText>
              <AppText style={{ color: colors.textMuted }}>{isStarterExerciseId(editingExercise.id) ? 'Built-in' : 'Custom'} · {humanizeEquipment(editingExercise.equipment)}</AppText>
            </View>
            <Button label="Close" onPress={() => setEditingId(null)} variant="quiet" />
          </View>

          <TargetPicker
            label="Primary target"
            detail="Counts as 1.0 working set"
            selected={(group) => primaryMuscle === group}
            onSelect={(group) => {
              setPrimaryMuscle(group);
              setSecondaryMuscles((current) => current.filter((item) => item !== group));
              setSavedExerciseId(null);
            }}
          />
          <TargetPicker
            label="Assisting targets"
            detail="Each counts as 0.5 working set"
            selected={(group) => secondaryMuscles.includes(group)}
            excluded={primaryMuscle}
            onSelect={(group) => {
              setSecondaryMuscles((current) => current.includes(group)
                ? current.filter((item) => item !== group)
                : [...current, group]);
              setSavedExerciseId(null);
            }}
          />
          {formError ? <AppText accessibilityLiveRegion="polite" style={{ color: colors.danger }}>{formError}</AppText> : null}
          {savedExerciseId === editingExercise.id ? <AppText accessibilityLiveRegion="polite" style={{ color: colors.success, fontWeight: '700' }}>Targets saved for future workouts.</AppText> : null}
          <Button label="Save muscle targets" onPress={() => void saveTargets()} busy={saving} />
        </Card>
      ) : null}

      <SectionHeading title="Exercises" detail={`${filteredExercises.length} result${filteredExercises.length === 1 ? '' : 's'} · choose one to edit`} />
      {loading && !data ? <StatePanel title="Opening exercise catalog" body="Reading your on-device exercise list." loading /> : null}
      {error ? <StatePanel title="Exercise catalog is unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /> : null}
      {!loading && !error && filteredExercises.length === 0 ? <StatePanel title="No matching exercises" body="Try another name, muscle, or catalog filter." actionLabel="Show all" onAction={() => { setQuery(''); setCatalogFilter('all'); }} /> : null}
      <View style={styles.exerciseGrid}>
        {filteredExercises.map((exercise) => {
          const selected = exercise.id === editingId;
          const needsReview = exerciseTargetsNeedReview(exercise);
          const primary = muscleGroupLabel(exercise.primaryMuscleGroup);
          return (
            <Pressable
              key={exercise.id}
              accessibilityRole="button"
              accessibilityLabel={`Review ${exercise.name} muscle targets`}
              onPress={() => beginEditing(exercise)}
              style={({ pressed }) => [styles.exercisePressable, pressed && styles.pressed]}
            >
              <Card style={[styles.exerciseCard, needsReview && { borderColor: colors.warning }, selected && { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
                <View style={styles.exerciseHeader}>
                  <View style={styles.flex}>
                    <AppText style={styles.exerciseName}>{exercise.name}</AppText>
                    <AppText style={{ color: colors.textMuted }}>{isStarterExerciseId(exercise.id) ? 'Built-in' : 'Custom'} · {humanizeEquipment(exercise.equipment)} · {exercise.targetRepMin}–{exercise.targetRepMax} reps</AppText>
                  </View>
                  <AppText style={{ color: needsReview ? colors.warning : colors.accent, fontWeight: '700' }}>{selected ? 'Editing' : needsReview ? 'Check tags' : 'Edit'}</AppText>
                </View>
                <View style={styles.targetSummary}>
                  <Pill label={`${primary} · primary`} active />
                  {exercise.secondaryMuscleGroups.map((group) => <Pill key={group} label={`${muscleGroupLabel(group)} · assist`} />)}
                </View>
              </Card>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

function TargetPicker({
  label,
  detail,
  selected,
  onSelect,
  excluded,
}: {
  label: string;
  detail: string;
  selected: (group: string) => boolean;
  onSelect: (group: string) => void;
  excluded?: string;
}) {
  const { colors } = useJienTheme();
  return (
    <View style={styles.targetPicker}>
      <View>
        <AppText style={styles.targetPickerTitle}>{label}</AppText>
        <AppText style={{ color: colors.textMuted }}>{detail}</AppText>
      </View>
      {MUSCLE_GROUP_SECTIONS.map((section) => (
        <View key={section} style={styles.muscleSection}>
          <AppText style={[styles.muscleSectionLabel, { color: colors.textMuted }]}>{section}</AppText>
          <View style={styles.filters}>
            {MUSCLE_GROUP_OPTIONS
              .filter((option) => option.section === section && option.value !== excluded)
              .map((option) => <Pill key={option.value} label={option.label} active={selected(option.value)} onPress={() => onSelect(option.value)} />)}
          </View>
        </View>
      ))}
    </View>
  );
}

function humanizeEquipment(value: string | null | undefined): string {
  if (!value) return 'Bodyweight';
  return value.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 1040, alignSelf: 'center' },
  flex: { flex: 1 },
  guidance: { padding: spacing.lg },
  guidanceTitle: { ...typography.bodyLarge, fontWeight: '800' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  editor: { padding: spacing.lg, gap: spacing.lg },
  editorHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  kicker: { ...typography.caption, fontWeight: '800', letterSpacing: 0.6 },
  editorTitle: { ...typography.section, fontWeight: '800' },
  targetPicker: { gap: spacing.sm },
  targetPickerTitle: { ...typography.bodyLarge, fontWeight: '700' },
  muscleSection: { gap: spacing.xs },
  muscleSectionLabel: { ...typography.caption, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  exerciseGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  exercisePressable: { width: '100%', maxWidth: 512, flexGrow: 1, flexShrink: 1, flexBasis: 420, minWidth: 0 },
  exerciseCard: { minHeight: 128, height: '100%', justifyContent: 'space-between' },
  exerciseHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  exerciseName: { ...typography.bodyLarge, fontWeight: '700' },
  targetSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pressed: { opacity: 0.68, transform: [{ scale: 0.995 }] },
});
