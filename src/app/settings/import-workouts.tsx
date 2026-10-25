import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { importWorkoutHistory, listExercises, type Exercise, type WorkoutImportExerciseChoice, type WorkoutImportResult } from '@/lib/db';
import { autoMatchImportedExercises, importedExerciseSearchText, parseWorkoutCsv, WorkoutCsvError, type WorkoutImportPreview } from '@/lib/import/workout-csv';
import { spacing, typography, useJienTheme } from '@/theme';

export default function ImportWorkoutsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const loader = useCallback(() => listExercises(db), [db]);
  const { data: exercises, error: catalogueError, loading: catalogueLoading, reload } = useScreenData(loader);
  const [preview, setPreview] = useState<WorkoutImportPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, WorkoutImportExerciseChoice>>({});
  const [unmatchedNames, setUnmatchedNames] = useState<string[]>([]);
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<WorkoutImportResult | null>(null);

  const chooseFile = async () => {
    if (!exercises) return;
    setMessage(null);
    setResult(null);
    try {
      const selection = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (selection.canceled) return;
      const asset = selection.assets[0];
      if (!asset) return;
      if (asset.size != null && asset.size > 25_000_000) throw new WorkoutCsvError('This CSV is larger than 25 MB. Export workout history only, then try again.');
      const cachedFile = asset.file ? null : new ExpoFile(asset.uri);
      const text = asset.file ? await asset.file.text() : await cachedFile!.text();
      if (cachedFile && Platform.OS !== 'web') {
        try { cachedFile.delete(); } catch { /* The OS may already have released the temporary copy. */ }
      }
      const parsed = parseWorkoutCsv(text);
      const automatic = autoMatchImportedExercises(parsed.exerciseNames, exercises);
      const nextChoices: Record<string, WorkoutImportExerciseChoice> = {};
      const unmatched: string[] = [];
      for (const name of parsed.exerciseNames) {
        const exercise = exercises.find((candidate) => candidate.id === automatic[name]);
        if (exercise) nextChoices[name] = { kind: 'existing', exercise };
        else {
          unmatched.push(name);
          nextChoices[name] = { kind: 'create', name };
        }
      }
      setPreview(parsed);
      setChoices(nextChoices);
      setUnmatchedNames(unmatched);
      setSearches({});
      setConsented(false);
    } catch (cause) {
      setPreview(null);
      setMessage(cause instanceof WorkoutCsvError ? cause.message : 'JIEN could not read this CSV. Choose the original workout export and try again.');
    }
  };

  const performImport = async () => {
    if (!preview || !consented) return;
    setBusy(true);
    setMessage(null);
    try {
      const nextResult = await importWorkoutHistory(db, preview, choices);
      setResult(nextResult);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The import could not be completed. Nothing from this attempt was saved.');
    } finally {
      setBusy(false);
    }
  };

  if (catalogueLoading && !exercises) return <Screen><StatePanel title="Loading workout import" body="Reading the exercise catalogue on this device." loading /></Screen>;
  if (catalogueError) return <Screen><StatePanel title="Workout import is unavailable" body={catalogueError} actionLabel="Try again" onAction={() => void reload()} /></Screen>;

  return (
    <Screen>
      <ScreenHeading title="Import workout history" eyebrow="Hevy or Strong CSV" />
      <Card style={{ backgroundColor: colors.accentSoft, borderColor: colors.accent }}>
        <AppText style={styles.cardTitle}>Preview first, write second</AppText>
        <AppText style={{ color: colors.textMuted }}>JIEN reads the file on this device. Nothing is saved until you review the totals, resolve exercise names and confirm the import.</AppText>
        <Button label={preview ? 'Choose another CSV' : 'Choose workout CSV'} onPress={() => void chooseFile()} variant="secondary" />
      </Card>
      {message ? <StatePanel title="Import needs attention" body={message} actionLabel="Choose another CSV" onAction={() => void chooseFile()} /> : null}
      {preview ? <>
        <SectionHeading title="Preview" detail={`${preview.source === 'hevy' ? 'Hevy' : 'Strong'} format detected`} />
        <Card>
          <View style={styles.metrics}>
            <PreviewMetric label="Workouts" value={preview.workoutCount.toLocaleString()} />
            <PreviewMetric label="Sets" value={preview.setCount.toLocaleString()} />
            <PreviewMetric label="Date range" value={formatImportDateRange(preview.firstDate, preview.lastDate)} />
          </View>
        </Card>

        <SectionHeading title="Exercise matching" detail={unmatchedNames.length ? `${unmatchedNames.length} unmatched` : 'Every exercise matched'} />
        {unmatchedNames.length === 0 ? <Card><AppText>Every imported exercise matches the JIEN catalogue.</AppText></Card> : (
          <View style={styles.list}>
            {unmatchedNames.map((name) => (
              <ExerciseResolution
                key={name}
                importedName={name}
                exercises={exercises ?? []}
                choice={choices[name]}
                search={searches[name] ?? ''}
                onSearch={(value) => setSearches((current) => ({ ...current, [name]: value }))}
                onChoice={(choice) => setChoices((current) => ({ ...current, [name]: choice }))}
              />
            ))}
          </View>
        )}

        <SectionHeading title="Confirm" detail="Sensitive training history" />
        <Card>
          <AppText style={{ color: colors.textMuted }}>This import will save workout dates, exercise names, weights and reps locally, then queue them for your account sync if you are signed in.</AppText>
          <Pill label="I have the right to import this data" active={consented} onPress={() => setConsented((value) => !value)} />
          <Button label={`Import ${preview.workoutCount.toLocaleString()} workouts`} onPress={() => void performImport()} disabled={!consented || busy} busy={busy} />
        </Card>
      </> : null}
      {result ? <StatePanel
        title={result.importedWorkouts ? 'Workout history imported' : 'This file was already imported'}
        body={result.importedWorkouts
          ? `${result.importedWorkouts.toLocaleString()} workouts and ${result.importedSets.toLocaleString()} sets were saved. ${result.skippedWorkouts ? `${result.skippedWorkouts.toLocaleString()} duplicate workouts were skipped.` : ''}`
          : `All ${result.skippedWorkouts.toLocaleString()} workouts already exist on this device, so no duplicates were created.`}
        actionLabel="View workout history"
        onAction={() => router.replace('/train')}
      /> : null}
      <Button label="Back to settings" onPress={() => router.back()} variant="quiet" />
    </Screen>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  const { colors } = useJienTheme();
  return <View style={styles.metric}><AppText style={[styles.metricLabel, { color: colors.textMuted }]}>{label}</AppText><AppText style={styles.metricValue}>{value}</AppText></View>;
}

function ExerciseResolution({
  importedName,
  exercises,
  choice,
  search,
  onSearch,
  onChoice,
}: {
  importedName: string;
  exercises: Exercise[];
  choice: WorkoutImportExerciseChoice | undefined;
  search: string;
  onSearch: (value: string) => void;
  onChoice: (choice: WorkoutImportExerciseChoice) => void;
}) {
  const { colors } = useJienTheme();
  const normalizedTerms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = useMemo(() => normalizedTerms.length
    ? exercises.filter((exercise) => normalizedTerms.every((term) => exercise.name.toLowerCase().includes(term))).slice(0, 6)
    : [], [exercises, normalizedTerms]);
  return (
    <Card>
      <AppText style={styles.cardTitle}>{importedName}</AppText>
      <View style={styles.actions}>
        <Pill label="Create as custom" active={choice?.kind === 'create'} onPress={() => onChoice({ kind: 'create', name: importedName })} />
        <Pill label="Map to existing" active={choice?.kind === 'existing'} onPress={() => onSearch(importedExerciseSearchText(importedName))} />
      </View>
      {choice?.kind === 'existing' ? <AppText style={{ color: colors.success }}>Mapped to {choice.exercise.name}</AppText> : null}
      {search || choice?.kind === 'existing' ? <>
        <Field label={`Find a JIEN exercise for ${importedName}`} value={search} onChangeText={onSearch} placeholder="Search catalogue" />
        {matches.length ? <View style={styles.matchList}>{matches.map((exercise) => <Button key={exercise.id} label={`Use ${exercise.name}`} onPress={() => onChoice({ kind: 'existing', exercise })} variant="quiet" />)}</View> : search ? <AppText style={{ color: colors.textMuted }}>No catalogue matches. Keep this as a custom exercise or try another name.</AppText> : null}
      </> : null}
      {choice?.kind === 'create' ? <AppText style={{ color: colors.textMuted }}>Created with “other” muscle targets. Review its targets after import so progression can categorize it precisely.</AppText> : null}
    </Card>
  );
}

function formatImportDateRange(firstDate: string, lastDate: string): string {
  const formatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
  const first = new Date(`${firstDate}T12:00:00`);
  const last = new Date(`${lastDate}T12:00:00`);
  const firstLabel = formatter.format(first);
  const lastLabel = formatter.format(last);
  return first.getFullYear() === last.getFullYear()
    ? `${firstLabel} – ${lastLabel} (${first.getFullYear()})`
    : `${firstLabel} ${first.getFullYear()} – ${lastLabel} ${last.getFullYear()}`;
}

const styles = StyleSheet.create({
  cardTitle: { ...typography.bodyLarge, fontWeight: '800' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { flexGrow: 1, flexBasis: 150, minWidth: 130, gap: spacing.xxs },
  metricLabel: { ...typography.caption, fontWeight: '700' },
  metricValue: { ...typography.section, fontWeight: '800', fontVariant: ['tabular-nums'] },
  list: { gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  matchList: { alignItems: 'flex-start', gap: spacing.xxs },
});
