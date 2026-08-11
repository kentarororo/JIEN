import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, SectionHeading } from '@/components/ui';
import { saveMeal, type MealType } from '@/lib/db';
import { reconcileMealGapNotification } from '@/lib/notifications';
import { spacing, typography, useJienTheme } from '@/theme';

type DraftFood = {
  key: string;
  name: string;
  quantity: string;
  unit: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
};

const emptyFood = (): DraftFood => ({ key: Crypto.randomUUID(), name: '', quantity: '1', unit: 'serving', calories: '', protein: '', carbs: '', fat: '' });
const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];

export default function NewMealScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const now = new Date();
  const inferred: MealType = now.getHours() < 11 ? 'breakfast' : now.getHours() < 15 ? 'lunch' : now.getHours() < 19 ? 'dinner' : 'snack';
  const [name, setName] = useState('Meal');
  const [type, setType] = useState<MealType>(inferred);
  const [foods, setFoods] = useState<DraftFood[]>([emptyFood()]);
  const [saving, setSaving] = useState(false);

  const update = (key: string, field: keyof Omit<DraftFood, 'key'>, value: string) => {
    setFoods((current) => current.map((food) => food.key === key ? { ...food, [field]: value } : food));
  };

  const submit = async () => {
    setSaving(true);
    try {
      const items = foods.map((food) => ({
        name: food.name,
        quantity: Number(food.quantity),
        unit: food.unit,
        caloriesKcal: Number(food.calories),
        proteinG: Number(food.protein),
        carbohydrateG: Number(food.carbs),
        fatG: Number(food.fat),
      }));
      if (items.some((item) => [item.quantity, item.caloriesKcal, item.proteinG, item.carbohydrateG, item.fatG].some((value) => !Number.isFinite(value)))) {
        throw new Error('Enter a valid portion and macro estimate for every food.');
      }
      await saveMeal(db, { name, type, eatenAt: new Date().toISOString(), items });
      await reconcileMealGapNotification(db);
      router.back();
    } catch (cause) {
      Alert.alert('Meal not saved', cause instanceof Error ? cause.message : 'Please check the meal and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Field label="Meal name" value={name} onChangeText={setName} placeholder="Dinner" />
      <View style={styles.typeWrap}>{MEAL_TYPES.map((mealType) => <Pill key={mealType} label={mealType[0]!.toUpperCase() + mealType.slice(1)} active={type === mealType} onPress={() => setType(mealType)} />)}</View>
      <AppText style={{ color: colors.textMuted }}>Use the estimate you have. Consistent logging matters more than false precision.</AppText>

      {foods.map((food, index) => (
        <Card key={food.key}>
          <View style={styles.header}><AppText style={styles.foodTitle}>Food {index + 1}</AppText>{foods.length > 1 ? <Button label="Remove" onPress={() => setFoods((current) => current.filter((item) => item.key !== food.key))} variant="quiet" /> : null}</View>
          <Field label="Food" value={food.name} onChangeText={(value) => update(food.key, 'name', value)} placeholder="Chicken rice" />
          <View style={styles.twoCol}>
            <View style={styles.flex}><Field label="Quantity" value={food.quantity} onChangeText={(value) => update(food.key, 'quantity', value)} keyboardType="decimal-pad" /></View>
            <View style={styles.flex}><Field label="Unit" value={food.unit} onChangeText={(value) => update(food.key, 'unit', value)} placeholder="serving" /></View>
          </View>
          <View style={styles.twoCol}>
            <View style={styles.flex}><Field label="Calories" value={food.calories} onChangeText={(value) => update(food.key, 'calories', value)} keyboardType="decimal-pad" placeholder="kcal" /></View>
            <View style={styles.flex}><Field label="Protein" value={food.protein} onChangeText={(value) => update(food.key, 'protein', value)} keyboardType="decimal-pad" placeholder="g" /></View>
          </View>
          <View style={styles.twoCol}>
            <View style={styles.flex}><Field label="Carbs" value={food.carbs} onChangeText={(value) => update(food.key, 'carbs', value)} keyboardType="decimal-pad" placeholder="g" /></View>
            <View style={styles.flex}><Field label="Fat" value={food.fat} onChangeText={(value) => update(food.key, 'fat', value)} keyboardType="decimal-pad" placeholder="g" /></View>
          </View>
        </Card>
      ))}
      <Button label="Add another food" onPress={() => setFoods((current) => [...current, emptyFood()])} variant="secondary" />
      <SectionHeading title="Finish" detail="Saved locally, even without a connection" />
      <Button label="Save meal" onPress={() => void submit()} busy={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  typeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  foodTitle: { ...typography.section, fontWeight: '700' },
  twoCol: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
