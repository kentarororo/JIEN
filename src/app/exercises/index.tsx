import { useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { exerciseTargetsNeedReview, isStarterExerciseId, listExercises, updateExerciseTargets } from '@/lib/db';
import type { Exercise } from '@/lib/db/types';
import { MUSCLE_GROUP_OPTIONS, MUSCLE_GROUP_SECTIONS, muscleGroupLabel, normalizeMuscleGroupKey } from '@/lib/progression';
import { EXERCISE_EQUIPMENT_FILTERS, exerciseEquipmentLabel, filterExerciseCatalog, type ExerciseEquipmentFilter, type ExerciseMuscleSection } from '@/lib/training/exercise-catalog';
import { radii, spacing, typography, useJienTheme } from '@/theme';

type CatalogFilter = 'all' | 'review' | 'custom' | 'jien';

export default function ExerciseLibraryScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [query, setQuery] = useState('');
  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>('all');
  const [muscleSection, setMuscleSection] = useState<ExerciseMuscleSection | null>(null);
  const [equipmentFilter, setEquipmentFilter] = useState<ExerciseEquipmentFilter | null>(null);
  const [catalogLimit, setCatalogLimit] = useState(24);
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
  const exerciseNameCounts = useMemo(() => exercises.reduce((counts, exercise) => {
    const key = normalizedExerciseName(exercise.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()), [exercises]);
  const needsCatalogReview = useCallback((exercise: Exercise) => exerciseTargetsNeedReview(exercise)
    || (exerciseNameCounts.get(normalizedExerciseName(exercise.name)) ?? 0) > 1, [exerciseNameCounts]);
  const filteredExercises = useMemo(() => {
    const sourceFiltered = exercises.filter((exercise) => {
      const starter = isStarterExerciseId(exercise.id);
      if (catalogFilter === 'review' && !needsCatalogReview(exercise)) return false;
      if (catalogFilter === 'custom' && starter) return false;
      if (catalogFilter === 'jien' && !starter) return false;
      return true;
    });
    return filterExerciseCatalog(sourceFiltered, { query, muscleSection, equipment: equipmentFilter });
  }, [catalogFilter, equipmentFilter, exercises, muscleSection, needsCatalogReview, query]);
  const visibleExercises = filteredExercises.slice(0, catalogLimit);
  const customCount = exercises.filter((exercise) => !isStarterExerciseId(exercise.id)).length;
  const reviewCount = exercises.filter(needsCatalogReview).length;
  useEffect(() => setCatalogLimit(24), [catalogFilter, equipmentFilter, muscleSection, query]);

  const beginEditing = (exercise: Exercise) => {
    const normalizedPrimary = normalizeMuscleGroupKey(exercise.primaryMuscleGroup);
    setEditingId(exercise.id);
    setPrimaryMuscle(normalizedPrimary);
    setSecondaryMuscles([...new Set(exercise.secondaryMuscleGroups.map(normalizeMuscleGroupKey))]
      .filter((group) => group !== normalizedPrimary));
    setFormError(null);
    setSavedExerciseId(null);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
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
    <Screen scrollViewRef={scrollRef} contentContainerStyle={styles.content}>
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
          placeholder="Try bench, quadriceps, or dumbbell…"
          returnKeyType="search"
        />
        <View style={styles.filters}>
          <Pill label={`All ${exercises.length}`} active={catalogFilter === 'all'} onPress={() => setCatalogFilter('all')} />
          <Pill label={`Review ${reviewCount}`} active={catalogFilter === 'review'} onPress={() => setCatalogFilter('review')} />
          <Pill label={`Custom ${customCount}`} active={catalogFilter === 'custom'} onPress={() => setCatalogFilter('custom')} />
          <Pill label={`JIEN ${exercises.length - customCount}`} active={catalogFilter === 'jien'} onPress={() => setCatalogFilter('jien')} />
        </View>
        <View style={styles.quickFilterGroup}>
          <AppText style={[styles.quickFilterLabel, { color: colors.textMuted }]}>Muscle area</AppText>
          <View style={styles.filters}>
            <Pill label="All" active={muscleSection == null} onPress={() => setMuscleSection(null)} />
            {MUSCLE_GROUP_SECTIONS.map((section) => <Pill key={section} label={section} active={muscleSection === section} onPress={() => setMuscleSection(section)} />)}
          </View>
        </View>
        <View style={styles.quickFilterGroup}>
          <AppText style={[styles.quickFilterLabel, { color: colors.textMuted }]}>Equipment</AppText>
          <View style={styles.filters}>
            <Pill label="All" active={equipmentFilter == null} onPress={() => setEquipmentFilter(null)} />
            {EXERCISE_EQUIPMENT_FILTERS.map((option) => <Pill key={option.value} label={option.label} active={equipmentFilter === option.value} onPress={() => setEquipmentFilter(option.value)} />)}
          </View>
        </View>
        {query.trim() || muscleSection || equipmentFilter ? <Button label="Clear search and filters" onPress={() => { setQuery(''); setMuscleSection(null); setEquipmentFilter(null); }} variant="quiet" /> : null}
      </Card>

      {editingExercise ? (
        <Card accessibilityLabel={`Editing targets for ${editingExercise.name}`} style={[styles.editor, { borderColor: colors.accent }]}>
          <View style={styles.editorHeader}>
            <View style={styles.flex}>
              <AppText style={[styles.kicker, { color: colors.accent }]}>EDITING</AppText>
              <AppText style={styles.editorTitle}>{editingExercise.name}</AppText>
              <AppText style={{ color: colors.textMuted }}>{isStarterExerciseId(editingExercise.id) ? 'Built-in' : 'Custom'} · {exerciseEquipmentLabel(editingExercise.equipment)}</AppText>
            </View>
            <View style={styles.editorActions}>
              <Button label="Save" onPress={() => void saveTargets()} busy={saving} variant="secondary" />
              <Button label="Close" onPress={() => setEditingId(null)} variant="quiet" />
            </View>
          </View>

          <TargetPicker
            key={`${editingExercise.id}-primary`}
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
            key={`${editingExercise.id}-assisting`}
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
      {!loading && !error && filteredExercises.length === 0 ? <StatePanel title="No matching exercises" body="Try another name, muscle area, equipment type, or catalog filter." actionLabel="Show all" onAction={() => { setQuery(''); setCatalogFilter('all'); setMuscleSection(null); setEquipmentFilter(null); }} /> : null}
      <View style={styles.exerciseGrid}>
        {visibleExercises.map((exercise) => {
          const selected = exercise.id === editingId;
          const duplicateName = (exerciseNameCounts.get(normalizedExerciseName(exercise.name)) ?? 0) > 1;
          const needsReview = needsCatalogReview(exercise);
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
                    <AppText style={{ color: colors.textMuted }}>{isStarterExerciseId(exercise.id) ? 'Built-in' : 'Custom'} · {exerciseEquipmentLabel(exercise.equipment)} · {exercise.targetRepMin}–{exercise.targetRepMax} reps</AppText>
                  </View>
                  <AppText style={{ color: needsReview ? colors.warning : colors.accent, fontWeight: '700' }}>{selected ? 'Editing' : duplicateName ? 'Duplicate name' : needsReview ? 'Check tags' : 'Edit'}</AppText>
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
      {visibleExercises.length < filteredExercises.length ? <Button label={`Show ${Math.min(24, filteredExercises.length - visibleExercises.length)} more`} onPress={() => setCatalogLimit((count) => count + 24)} variant="secondary" /> : null}
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
  const [activeSection, setActiveSection] = useState(() => MUSCLE_GROUP_OPTIONS.find((option) => selected(option.value))?.section ?? MUSCLE_GROUP_SECTIONS[0]);
  const selectedLabels = MUSCLE_GROUP_OPTIONS.filter((option) => option.value !== excluded && selected(option.value)).map((option) => option.label);
  return (
    <View style={styles.targetPicker}>
      <View>
        <AppText style={styles.targetPickerTitle}>{label}</AppText>
        <AppText style={{ color: colors.textMuted }}>{detail}</AppText>
        <AppText style={[styles.selectionSummary, { color: colors.textMuted }]}>{selectedLabels.length ? `Selected: ${selectedLabels.join(', ')}` : 'None selected'}</AppText>
      </View>
      <View style={styles.filters}>
        {MUSCLE_GROUP_SECTIONS.map((section) => <Pill key={section} label={section} active={activeSection === section} onPress={() => setActiveSection(section)} />)}
      </View>
      <View style={styles.muscleSection}>
        <AppText style={[styles.muscleSectionLabel, { color: colors.textMuted }]}>{activeSection}</AppText>
        <View style={styles.filters}>
          {MUSCLE_GROUP_OPTIONS
            .filter((option) => option.section === activeSection && option.value !== excluded)
            .map((option) => <Pill key={option.value} label={option.label} active={selected(option.value)} onPress={() => onSelect(option.value)} />)}
        </View>
      </View>
    </View>
  );
}

function normalizedExerciseName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 1040, alignSelf: 'center' },
  flex: { flex: 1 },
  guidance: { padding: spacing.lg },
  guidanceTitle: { ...typography.bodyLarge, fontWeight: '800' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  quickFilterGroup: { gap: spacing.xs },
  quickFilterLabel: { ...typography.caption, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  editor: { padding: spacing.lg, gap: spacing.lg },
  editorHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  editorActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  kicker: { ...typography.caption, fontWeight: '800', letterSpacing: 0.6 },
  editorTitle: { ...typography.section, fontWeight: '800' },
  targetPicker: { gap: spacing.sm },
  targetPickerTitle: { ...typography.bodyLarge, fontWeight: '700' },
  selectionSummary: { ...typography.label, marginTop: spacing.xxs },
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
