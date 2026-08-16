import { useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Field, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { ensureStartingNutritionTarget, getAdaptiveNutritionHistory, getNutritionTarget, saveNutritionTarget } from '@/lib/db';
import { evaluateAdaptiveNutritionTarget, type AdaptiveNutritionHistoryDay } from '@/lib/nutrition/adaptive-targets';
import { spacing, typography, useJienTheme } from '@/theme';

export default function MacroTargetScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fibre, setFibre] = useState('');
  const [desiredWeightChange, setDesiredWeightChange] = useState('0');
  const [history, setHistory] = useState<AdaptiveNutritionHistoryDay[]>([]);
  const [baselineCalories, setBaselineCalories] = useState(0);
  const [baselineProtein, setBaselineProtein] = useState(0);
  const [adaptiveApplied, setAdaptiveApplied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [target, adaptiveHistory] = await Promise.all([
        getNutritionTarget(db).then((current) => current ?? ensureStartingNutritionTarget(db)),
        getAdaptiveNutritionHistory(db),
      ]);
      setHistory(adaptiveHistory);
      if (target) {
        setCalories(String(target.caloriesKcal));
        setProtein(String(target.proteinG));
        setCarbs(String(target.carbohydrateG));
        setFat(String(target.fatG));
        setFibre(String(target.fibreG));
        setDesiredWeightChange(String(target.desiredWeeklyWeightChangePercent));
        setBaselineCalories(target.caloriesKcal);
        setBaselineProtein(target.proteinG);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load macro targets.');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { void load(); }, [load]);

  const adaptive = useMemo(() => {
    const desired = Number(desiredWeightChange);
    if (baselineCalories <= 0 || baselineProtein <= 0 || !Number.isFinite(desired) || desired < -1 || desired > 1) return null;
    return evaluateAdaptiveNutritionTarget({
      currentCaloriesKcal: baselineCalories,
      currentProteinTargetG: baselineProtein,
      desiredWeeklyWeightChangePercent: desired,
      history,
    });
  }, [baselineCalories, baselineProtein, desiredWeightChange, history]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const values = {
        caloriesKcal: Number(calories),
        proteinG: Number(protein),
        carbohydrateG: Number(carbs),
        fatG: Number(fat),
        fibreG: Number(fibre || 0),
        desiredWeeklyWeightChangePercent: Number(desiredWeightChange),
      };
      const macros = [values.caloriesKcal, values.proteinG, values.carbohydrateG, values.fatG, values.fibreG];
      if (macros.some((value) => !Number.isFinite(value) || value < 0) || values.caloriesKcal === 0) {
        throw new Error('Enter a positive calorie target and non-negative macro values.');
      }
      if (!Number.isFinite(values.desiredWeeklyWeightChangePercent)
        || values.desiredWeeklyWeightChangePercent < -1
        || values.desiredWeeklyWeightChangePercent > 1) {
        throw new Error('Desired weekly weight change must be between -1% and 1%.');
      }
      await saveNutritionTarget(db, values, adaptiveApplied && adaptive ? {
        source: 'adaptive',
        rationale: `Accepted ${adaptive.recommendation.adjustmentKcal > 0 ? '+' : ''}${adaptive.recommendation.adjustmentKcal} kcal review suggestion from ${adaptive.dataSufficiency.completeWeeks} qualifying weeks.`,
      } : { source: 'manual' });
      router.replace('/food');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Please check the values and try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Screen><StatePanel title="Loading targets" body="Checking your current local targets." loading /></Screen>;

  return (
    <Screen>
      <ScreenHeading eyebrow="Nutrition settings" title="Targets you control." />
      <Card><AppText style={{ color: colors.textMuted }}>JIEN creates a rough starting estimate from your onboarding weight and goal. These values are editable, changes apply from today without rewriting past logs, and the estimate is not medical advice.</AppText></Card>
      {error ? <Card style={{ backgroundColor: colors.dangerSoft, borderColor: colors.danger }}><AppText accessibilityRole="alert" style={{ color: colors.danger }}>{error}</AppText></Card> : null}
      <Field label="Daily calories" value={calories} onChangeText={(value) => { setCalories(value); setAdaptiveApplied(false); }} keyboardType="decimal-pad" placeholder="2200" />
      <View style={styles.twoCol}><View style={styles.flex}><Field label="Protein (g)" value={protein} onChangeText={(value) => { setProtein(value); setAdaptiveApplied(false); }} keyboardType="decimal-pad" placeholder="160" /></View><View style={styles.flex}><Field label="Carbs (g)" value={carbs} onChangeText={(value) => { setCarbs(value); setAdaptiveApplied(false); }} keyboardType="decimal-pad" placeholder="240" /></View></View>
      <View style={styles.twoCol}><View style={styles.flex}><Field label="Fat (g)" value={fat} onChangeText={(value) => { setFat(value); setAdaptiveApplied(false); }} keyboardType="decimal-pad" placeholder="70" /></View><View style={styles.flex}><Field label="Fibre (g)" value={fibre} onChangeText={(value) => { setFibre(value); setAdaptiveApplied(false); }} keyboardType="decimal-pad" placeholder="30" /></View></View>

      <SectionHeading title="Adaptive trend" detail="Optional, deterministic, and review-only" />
      <Field
        label="Desired weekly weight trend (%)"
        value={desiredWeightChange}
        onChangeText={(value) => { setDesiredWeightChange(value); setAdaptiveApplied(false); }}
        keyboardType="numbers-and-punctuation"
        placeholder="0"
        hint="You choose the direction: negative trends lower, positive trends higher, and 0 maintains. Allowed range: -1 to +1."
      />
      {adaptive ? (
        <Card style={{ backgroundColor: adaptive.action === 'recommend_adjustment' ? colors.accentSoft : colors.surface }}>
          <AppText style={styles.adaptiveTitle}>{adaptiveTitle(adaptive.action, adaptive.confidence)}</AppText>
          <AppText style={{ color: colors.textMuted }}>{adaptiveCopy(adaptive)}</AppText>
          <AppText style={{ color: colors.textMuted }}>
            Coverage: {adaptive.dataSufficiency.weightDays} weight · {adaptive.dataSufficiency.calorieDays} calorie · {adaptive.dataSufficiency.proteinDays} protein days
          </AppText>
          {adaptive.action === 'recommend_adjustment' ? (
            <>
              <AppText style={styles.adaptiveMetric}>{adaptive.recommendation.suggestedCaloriesKcal} kcal</AppText>
              <AppText style={{ color: colors.textMuted }}>{adaptive.recommendation.adjustmentKcal > 0 ? '+' : ''}{adaptive.recommendation.adjustmentKcal} kcal/day; capped conservatively. Nothing changes until you use the suggestion and save.</AppText>
              <Button label={adaptiveApplied ? 'Suggestion added to form' : 'Use suggested calories'} disabled={adaptiveApplied} onPress={() => { setCalories(String(adaptive.recommendation.suggestedCaloriesKcal)); setAdaptiveApplied(true); }} variant="secondary" />
            </>
          ) : null}
        </Card>
      ) : <StatePanel title="Choose a valid trend" body="Enter a number from -1 to +1 before JIEN evaluates your logged history." />}
      <Button label="Save targets" onPress={() => void submit()} busy={saving} />
    </Screen>
  );
}

function adaptiveTitle(action: 'hold' | 'recommend_adjustment', confidence: string): string {
  if (action === 'recommend_adjustment') return `Review a ${confidence}-confidence adjustment`;
  return confidence === 'insufficient' ? 'Keep collecting consistent history' : 'No calorie change suggested';
}

function adaptiveCopy(evaluation: ReturnType<typeof evaluateAdaptiveNutritionTarget>): string {
  if (evaluation.confidence === 'insufficient') {
    return 'JIEN waits for at least three qualifying weeks before suggesting a change. Missing days are treated as missing—not as zero intake.';
  }
  const trend = evaluation.trend.smoothedWeeklyWeightChangePercent;
  if (evaluation.recommendation.reason === 'weight_trend_unstable') return 'The smoothed and recent directions do not agree yet, so the current target stays in place.';
  if (evaluation.recommendation.reason === 'within_desired_range') return `The smoothed trend${trend == null ? '' : ` (${trend > 0 ? '+' : ''}${trend.toFixed(2)}%/week)`} is within the chosen range.`;
  return `The logged weight trend${trend == null ? '' : ` (${trend > 0 ? '+' : ''}${trend.toFixed(2)}%/week)`} has remained outside the range you selected.`;
}

const styles = StyleSheet.create({
  twoCol: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flex: { flex: 1, minWidth: 150 },
  adaptiveTitle: { ...typography.bodyLarge, fontWeight: '800' },
  adaptiveMetric: { ...typography.title, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
