import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, ProgressBar, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { getDailyNutrition } from '@/lib/db';
import { formatTime } from '@/lib/time';
import { spacing, typography, useJienTheme } from '@/theme';

function Macro({ label, value, target, color }: { label: string; value: number; target?: number; color?: string }) {
  return (
    <View style={styles.macro}>
      <View style={styles.row}><AppText>{label}</AppText><AppText style={styles.value}>{Math.round(value)}{target ? ` / ${Math.round(target)}` : ''} g</AppText></View>
      <ProgressBar value={target ? value / target : 0} color={color} />
    </View>
  );
}

export default function FoodScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const loader = useCallback(() => getDailyNutrition(db), [db]);
  const { data, error, loading, reload } = useScreenData(loader);

  return (
    <Screen>
      <ScreenHeading title="Food" eyebrow="Today" action={<Button label="Add" onPress={() => router.push('/meals/new')} />} />
      {loading && !data ? <StatePanel title="Loading meals" body="Reading today’s local log." loading /> : null}
      {error ? <StatePanel title="Meals are unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /> : null}
      {data ? (
        <>
          <Card>
            <View style={styles.calorieLine}>
              <View><AppText style={[styles.kicker, { color: colors.textMuted }]}>CALORIES</AppText><AppText style={styles.calories}>{Math.round(data.totals.caloriesKcal).toLocaleString()}</AppText></View>
              <AppText style={{ color: colors.textMuted }}>{data.target ? `of ${Math.round(data.target.caloriesKcal).toLocaleString()} kcal` : 'No target set'}</AppText>
            </View>
            <ProgressBar value={data.target ? data.totals.caloriesKcal / data.target.caloriesKcal : 0} />
            <Macro label="Protein" value={data.totals.proteinG} target={data.target?.proteinG} color={colors.success} />
            <Macro label="Carbs" value={data.totals.carbohydrateG} target={data.target?.carbohydrateG} color={colors.wood} />
            <Macro label="Fat" value={data.totals.fatG} target={data.target?.fatG} color={colors.warning} />
            <Button label={data.target ? 'Edit macro targets' : 'Set macro targets'} onPress={() => router.push('/settings/macros')} variant="secondary" />
          </Card>

          <SectionHeading title="Meals" detail={`${data.meals.length} logged`} />
          {data.meals.length === 0 ? <StatePanel title="No meals logged" body="Add the food and portions you know. Exact is useful, but consistent estimates count too." actionLabel="Log a meal" onAction={() => router.push('/meals/new')} /> : null}
          <View style={styles.list}>
            {data.meals.map((meal) => (
              <Card key={meal.id}>
                <View style={styles.row}><View style={styles.flex}><AppText style={styles.mealName}>{meal.name}</AppText><AppText style={{ color: colors.textMuted }}>{meal.type ?? 'meal'} · {formatTime(meal.eatenAt)}</AppText></View><AppText style={styles.value}>{Math.round(meal.caloriesKcal)} kcal</AppText></View>
                <AppText style={{ color: colors.textMuted }}>P {Math.round(meal.proteinG)} · C {Math.round(meal.carbohydrateG)} · F {Math.round(meal.fatG)}</AppText>
              </Card>
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  calorieLine: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md },
  kicker: { ...typography.caption, fontWeight: '700', letterSpacing: 0.7 },
  calories: { ...typography.display, fontWeight: '700' },
  macro: { gap: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  value: { fontWeight: '700' },
  flex: { flex: 1 },
  list: { gap: spacing.sm },
  mealName: { ...typography.bodyLarge, fontWeight: '700' },
});
