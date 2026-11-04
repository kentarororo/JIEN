import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Field } from '@/components/ui';
import { saveMeal } from '@/lib/db';
import { useSQLiteContext } from '@/lib/db/database-context';
import { localTimestampForDate } from '@/lib/time';
import { spacing, useJienTheme } from '@/theme';

export function QuickMacros({ date, onSaved }: { date: string; onSaved: (message: string) => void }) {
  const db = useSQLiteContext();
  const { colors } = useJienTheme();
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const required = [calories, protein].map((value) => Number(value));
  const optional = [carbs, fat].map((value) => value.trim() ? Number(value) : 0);
  const valid = calories.trim() !== '' && protein.trim() !== ''
    && [...required, ...optional].every((value) => Number.isFinite(value) && value >= 0);
  const submit = async () => {
    if (lock.current || !valid) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      await saveMeal(db, {
        name: 'Quick macros', type: 'other', eatenAt: localTimestampForDate(date),
        items: [{
          name: 'Quick macros', quantity: 1, unit: 'entry', caloriesKcal: required[0]!,
          proteinG: required[1]!, carbohydrateG: optional[0]!, fatG: optional[1]!,
          fibreG: null, source: 'manual', confidence: null,
        }],
      });
      setCalories(''); setProtein(''); setCarbs(''); setFat('');
      onSaved('Quick macros added.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Quick macros could not be added. Try again.');
    } finally { lock.current = false; setBusy(false); }
  };
  return <Card>
    <View>
      <AppText style={styles.title}>Quick macros</AppText>
      <AppText style={{ color: colors.textMuted }}>Enter calories and protein. Carbs and fat are optional.</AppText>
    </View>
    <View style={styles.fields}>
      <Field label="kcal" accessibilityLabel="Quick calories" value={calories} onChangeText={setCalories} keyboardType="decimal-pad" containerStyle={styles.field} />
      <Field label="Protein" accessibilityLabel="Quick protein" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" containerStyle={styles.field} />
      <Field label="Carbs" accessibilityLabel="Quick carbs" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" containerStyle={styles.field} />
      <Field label="Fat" accessibilityLabel="Quick fat" value={fat} onChangeText={setFat} keyboardType="decimal-pad" containerStyle={styles.field} />
      <View style={styles.add}><Button label="Add macros" onPress={() => void submit()} disabled={!valid} busy={busy} /></View>
    </View>
    {error ? <AppText accessibilityRole="alert" style={{ color: colors.danger }}>{error}</AppText> : null}
  </Card>;
}

const styles = StyleSheet.create({
  title: { fontWeight: '700' },
  fields: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: spacing.xs },
  field: { flexGrow: 1, flexBasis: 92, minWidth: 82 },
  add: { flexGrow: 1, minWidth: 130 },
});
