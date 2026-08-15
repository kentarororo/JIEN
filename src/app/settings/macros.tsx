import { useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Field, Screen, StatePanel } from '@/components/ui';
import { ensureStartingNutritionTarget, getNutritionTarget, saveNutritionTarget } from '@/lib/db';
import { spacing, useJienTheme } from '@/theme';

export default function MacroTargetScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fibre, setFibre] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const target = await getNutritionTarget(db) ?? await ensureStartingNutritionTarget(db);
      if (target) {
        setCalories(String(target.caloriesKcal));
        setProtein(String(target.proteinG));
        setCarbs(String(target.carbohydrateG));
        setFat(String(target.fatG));
        setFibre(String(target.fibreG));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load macro targets.');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const values = { caloriesKcal: Number(calories), proteinG: Number(protein), carbohydrateG: Number(carbs), fatG: Number(fat), fibreG: Number(fibre || 0) };
      if (Object.values(values).some((value) => !Number.isFinite(value) || value < 0) || values.caloriesKcal === 0) {
        throw new Error('Enter a positive calorie target and non-negative macro values.');
      }
      await saveNutritionTarget(db, values);
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
      <Card><AppText style={{ color: colors.textMuted }}>JIEN creates a rough starting estimate from your onboarding weight and goal. These values are editable, changes apply from today without rewriting past logs, and the estimate is not medical advice.</AppText></Card>
      {error ? <Card style={{ backgroundColor: colors.dangerSoft, borderColor: colors.danger }}><AppText accessibilityRole="alert" style={{ color: colors.danger }}>{error}</AppText></Card> : null}
      <Field label="Daily calories" value={calories} onChangeText={setCalories} keyboardType="decimal-pad" placeholder="2200" />
      <View style={styles.twoCol}><View style={styles.flex}><Field label="Protein (g)" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" placeholder="160" /></View><View style={styles.flex}><Field label="Carbs (g)" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" placeholder="240" /></View></View>
      <View style={styles.twoCol}><View style={styles.flex}><Field label="Fat (g)" value={fat} onChangeText={setFat} keyboardType="decimal-pad" placeholder="70" /></View><View style={styles.flex}><Field label="Fibre (g)" value={fibre} onChangeText={setFibre} keyboardType="decimal-pad" placeholder="30" /></View></View>
      <Button label="Save targets" onPress={() => void submit()} busy={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({ twoCol: { flexDirection: 'row', gap: spacing.sm }, flex: { flex: 1 } });
