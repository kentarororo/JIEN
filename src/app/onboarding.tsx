import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, ChoiceCard, Field, Pill, ProgressBar, Screen, StatePanel } from '@/components/ui';
import {
  getUserProfile,
  getLatestBodyMeasurement,
  saveUserProfile,
  type FitnessGoal,
  type LoadUnit,
  type TrainingExperience,
} from '@/lib/db';
import { spacing, typography, useJienTheme } from '@/theme';

const TOTAL_STEPS = 9;
const GOALS: Array<{ value: FitnessGoal; title: string; body: string }> = [
  { value: 'composition', title: 'Change my body composition', body: 'Build muscle, reduce fat, or both—without chasing maxes.' },
  { value: 'strength', title: 'Get sustainably stronger', body: 'Progress load and reps while keeping joint risk in view.' },
  { value: 'both', title: 'Both composition and strength', body: 'Balance visible change with repeatable performance.' },
  { value: 'general_wellness', title: 'Feel and function better', body: 'Use training and food as part of broader wellbeing.' },
];
const EXPERIENCE: Array<{ value: TrainingExperience; title: string; body: string }> = [
  { value: 'beginner', title: 'New or returning', body: 'Less than a year of consistent training.' },
  { value: 'intermediate', title: 'Consistent', body: 'Roughly one to three years of structured training.' },
  { value: 'advanced', title: 'Experienced', body: 'Several years of deliberate, consistent training.' },
];
const EQUIPMENT = [
  ['machines', 'Machines'],
  ['cables', 'Cables'],
  ['dumbbells', 'Dumbbells'],
  ['barbells', 'Barbells'],
  ['bodyweight', 'Bodyweight'],
] as const;
const DIET = [
  ['flexible, meals vary day to day', 'Flexible and varied', 'Meals change often; practical estimates matter.'],
  ['macro-aware without a rigid meal plan', 'Macro-aware', 'I track targets without following a fixed menu.'],
  ['mostly structured and repeatable', 'Mostly structured', 'Meals and portions are usually predictable.'],
  ['plant-forward or vegetarian', 'Plant-forward', 'Most meals center plants or exclude meat.'],
] as const;

export default function OnboardingScreen() {
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState<FitnessGoal | null>(null);
  const [experience, setExperience] = useState<TrainingExperience | null>(null);
  const [heightCm, setHeightCm] = useState('');
  const [bodyWeightKg, setBodyWeightKg] = useState('');
  const [bodyFatPercent, setBodyFatPercent] = useState('');
  const [bodyFatIsEstimated, setBodyFatIsEstimated] = useState(true);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [jointNotes, setJointNotes] = useState('');
  const [dietPattern, setDietPattern] = useState('');
  const [loadUnit, setLoadUnit] = useState<LoadUnit>('kg');
  const [aiConsent, setAiConsent] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(edit === '1');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadExisting = useCallback(async () => {
    if (edit !== '1') return;
    setLoading(true);
    setLoadError(null);
    try {
      const [profile, measurement] = await Promise.all([getUserProfile(db), getLatestBodyMeasurement(db)]);
      if (profile) {
        setGoal(profile.goals[0] ?? null);
        setExperience(profile.trainingExperience);
        setEquipment(profile.availableEquipment);
        setJointNotes(profile.injuryFlags.join('\n'));
        setDietPattern(profile.typicalDietPattern);
        setLoadUnit(profile.preferredLoadUnit);
        setAiConsent(profile.aiDataConsent);
      }
      if (measurement) {
        setHeightCm(String(measurement.heightCm));
        setBodyWeightKg(String(measurement.bodyWeightKg));
        setBodyFatPercent(measurement.bodyFatPercent == null ? '' : String(measurement.bodyFatPercent));
        setBodyFatIsEstimated(measurement.bodyFatIsEstimated ?? true);
      }
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not load your profile.');
    } finally {
      setLoading(false);
    }
  }, [db, edit]);

  useEffect(() => { void loadExisting(); }, [loadExisting]);

  const canContinue = useMemo(() => {
    if (step === 0) return goal != null;
    if (step === 1) return experience != null;
    if (step === 2) {
      const height = Number(heightCm);
      const weight = Number(bodyWeightKg);
      const bodyFat = bodyFatPercent.trim() ? Number(bodyFatPercent) : null;
      return height >= 100 && height <= 250 && weight >= 25 && weight <= 400
        && (bodyFat == null || (bodyFat >= 2 && bodyFat <= 70));
    }
    if (step === 3) return equipment.length > 0;
    if (step === 5) return dietPattern.length > 0;
    if (step === 7) return aiConsent != null;
    return true;
  }, [aiConsent, bodyFatPercent, bodyWeightKg, dietPattern, equipment.length, experience, goal, heightCm, step]);

  const toggleEquipment = (value: string) => {
    setEquipment((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  const finish = async () => {
    if (!goal || !experience || !dietPattern || aiConsent == null) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveUserProfile(db, {
        goals: [goal],
        trainingExperience: experience,
        availableEquipment: equipment,
        injuryFlags: jointNotes.trim() ? [jointNotes.trim()] : [],
        typicalDietPattern: dietPattern,
        preferredLoadUnit: loadUnit,
        aiDataConsent: aiConsent,
      }, {
        heightCm: Number(heightCm),
        bodyWeightKg: Number(bodyWeightKg),
        bodyFatPercent: bodyFatPercent.trim() ? Number(bodyFatPercent) : null,
        bodyFatIsEstimated: bodyFatPercent.trim() ? bodyFatIsEstimated : null,
      });
      router.replace('/(tabs)/today');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Please try again.';
      setSaveError(message);
      if (Platform.OS !== 'web') Alert.alert('Profile not saved', message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Screen><StatePanel title="Loading your profile" body="Reading your answers from this device." loading /></Screen>;
  if (loadError) return <Screen><StatePanel title="Profile unavailable" body={loadError} actionLabel="Try again" onAction={() => void loadExisting()} /></Screen>;

  const headings = [
    ['What are you working toward?', 'This sets the emphasis. It never creates a max-effort path.'],
    ['How familiar is structured training?', 'We’ll use this to calibrate explanations, not judge ability.'],
    ['Set a starting body baseline', 'Height and weight anchor long-term trends. Body fat is optional and can be an estimate.'],
    ['What can you usually train with?', 'Choose everything that is realistically available.'],
    ['Anything your training should respect?', 'Optional. Note joints, injuries, or movements you currently avoid.'],
    ['Which description fits how you eat?', 'This keeps food logging practical for your real routine.'],
    ['Which load unit feels natural?', 'You can still record either unit later.'],
    ['May JIEN use context when you ask for AI guidance?', 'AI is optional. Manual tracking and progression work without it.'],
    ['Does this foundation feel right?', 'Your answers stay on this device first and can be changed later.'],
  ] as const;

  return (
    <Screen contentContainerStyle={styles.screen}>
      <View style={styles.topline}>
        <AppText style={[styles.brand, { color: colors.accent }]}>JIEN</AppText>
        <AppText style={{ color: colors.textMuted }}>Step {step + 1} of {TOTAL_STEPS}</AppText>
      </View>
      <ProgressBar value={(step + 1) / TOTAL_STEPS} />
      <View style={styles.heading}>
        <AppText accessibilityRole="header" style={styles.question}>{headings[step]![0]}</AppText>
        <AppText style={[styles.explanation, { color: colors.textMuted }]}>{headings[step]![1]}</AppText>
      </View>

      <View style={styles.answers}>
        {saveError ? <Card style={{ backgroundColor: colors.dangerSoft }}><AppText style={{ color: colors.danger }}>{saveError}</AppText></Card> : null}
        {step === 0 ? GOALS.map((item) => <ChoiceCard key={item.value} {...item} selected={goal === item.value} onPress={() => setGoal(item.value)} />) : null}
        {step === 1 ? EXPERIENCE.map((item) => <ChoiceCard key={item.value} {...item} selected={experience === item.value} onPress={() => setExperience(item.value)} />) : null}
        {step === 2 ? (
          <>
            <View style={styles.measurementRow}>
              <Field label="Height (cm)" value={heightCm} onChangeText={setHeightCm} keyboardType="decimal-pad" placeholder="175" containerStyle={styles.measurementField} />
              <Field label="Weight (kg)" value={bodyWeightKg} onChangeText={setBodyWeightKg} keyboardType="decimal-pad" placeholder="72.5" containerStyle={styles.measurementField} />
            </View>
            <Field label="Body fat % (optional)" value={bodyFatPercent} onChangeText={setBodyFatPercent} keyboardType="decimal-pad" placeholder="18" hint="A rough estimate is useful for trends; you can leave this blank." />
            {bodyFatPercent.trim() ? <View style={styles.measurementRow}><Pill label="Estimated" active={bodyFatIsEstimated} onPress={() => setBodyFatIsEstimated(true)} /><Pill label="Measured" active={!bodyFatIsEstimated} onPress={() => setBodyFatIsEstimated(false)} /></View> : null}
            <Card style={{ backgroundColor: colors.accentSoft }}><AppText>These are treated as sensitive wellness data and remain on this device first.</AppText></Card>
          </>
        ) : null}
        {step === 3 ? EQUIPMENT.map(([value, title]) => <ChoiceCard key={value} title={title} selected={equipment.includes(value)} onPress={() => toggleEquipment(value)} />) : null}
        {step === 4 ? (
          <>
            <Field label="Joint or movement considerations" value={jointNotes} onChangeText={setJointNotes} multiline numberOfLines={5} textAlignVertical="top" placeholder="For example: right wrist—avoid loaded extension" style={styles.multiline} />
            <Card style={{ backgroundColor: colors.accentSoft }}><AppText>This is treated as sensitive wellness data. Leave it blank if there’s nothing relevant.</AppText></Card>
          </>
        ) : null}
        {step === 5 ? DIET.map(([value, title, body]) => <ChoiceCard key={value} title={title} body={body} selected={dietPattern === value} onPress={() => setDietPattern(value)} />) : null}
        {step === 6 ? (
          <><ChoiceCard title="Kilograms" body="Use kg as the default display and entry unit." selected={loadUnit === 'kg'} onPress={() => setLoadUnit('kg')} /><ChoiceCard title="Pounds" body="Use lb as the default display and entry unit." selected={loadUnit === 'lb'} onPress={() => setLoadUnit('lb')} /></>
        ) : null}
        {step === 7 ? (
          <>
            <Card>
              <AppText style={styles.consentTitle}>What “allow” means</AppText>
              <AppText style={{ color: colors.textMuted }}>When you actively use an AI feature, JIEN may send the relevant profile and recent logs through its secured server to generate a response. It is not required for manual tracking, and you can turn it off later.</AppText>
              <AppText style={[styles.draft, { color: colors.warning }]}>CONSENT COPY — REVIEW BEFORE RELEASE</AppText>
            </Card>
            <ChoiceCard title="Keep AI context off" body="Continue with all offline tracking features." selected={aiConsent === false} onPress={() => setAiConsent(false)} />
            <ChoiceCard title="Allow contextual AI" body="Record explicit consent for future AI features." selected={aiConsent === true} onPress={() => setAiConsent(true)} />
          </>
        ) : null}
        {step === 8 ? (
          <Card>
            <Summary label="Goal" value={GOALS.find((item) => item.value === goal)?.title ?? '—'} />
            <Summary label="Experience" value={EXPERIENCE.find((item) => item.value === experience)?.title ?? '—'} />
            <Summary label="Body baseline" value={`${heightCm} cm · ${bodyWeightKg} kg${bodyFatPercent.trim() ? ` · ${bodyFatPercent}% ${bodyFatIsEstimated ? 'estimated' : 'measured'} body fat` : ''}`} />
            <Summary label="Equipment" value={equipment.map((value) => EQUIPMENT.find(([key]) => key === value)?.[1] ?? value).join(', ')} />
            <Summary label="Joint notes" value={jointNotes.trim() || 'None added'} />
            <Summary label="Diet" value={DIET.find(([value]) => value === dietPattern)?.[1] ?? '—'} />
            <Summary label="Default load" value={loadUnit} />
            <Summary label="AI context" value={aiConsent ? 'Allowed' : 'Off'} />
          </Card>
        ) : null}
      </View>

      <View style={styles.navigation}>
        {step > 0 ? <Button label="Back" onPress={() => setStep((current) => current - 1)} variant="quiet" disabled={saving} /> : edit === '1' ? <Button label="Cancel" onPress={() => router.back()} variant="quiet" /> : <View />}
        <Button label={step === TOTAL_STEPS - 1 ? 'Finish setup' : 'Continue'} onPress={() => step === TOTAL_STEPS - 1 ? void finish() : setStep((current) => current + 1)} disabled={!canContinue} busy={saving} />
      </View>
    </Screen>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  const { colors } = useJienTheme();
  return <View style={styles.summary}><AppText style={{ color: colors.textMuted }}>{label}</AppText><AppText style={styles.summaryValue}>{value}</AppText></View>;
}

const styles = StyleSheet.create({
  screen: { width: '100%', maxWidth: 680, alignSelf: 'center', flexGrow: 1 },
  topline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { ...typography.bodyLarge, fontWeight: '800', letterSpacing: 1.2 },
  heading: { gap: spacing.xs, paddingTop: spacing.md },
  question: { ...typography.title, fontWeight: '700', letterSpacing: -0.4 },
  explanation: { ...typography.bodyLarge },
  answers: { gap: spacing.sm, flex: 1 },
  multiline: { minHeight: 132, paddingTop: spacing.md },
  consentTitle: { ...typography.bodyLarge, fontWeight: '700' },
  draft: { ...typography.caption, fontWeight: '800', letterSpacing: 0.5 },
  navigation: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md },
  summary: { gap: spacing.xxs, paddingVertical: spacing.xs },
  summaryValue: { fontWeight: '700' },
  measurementRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  measurementField: { flex: 1, minWidth: 180 },
});
