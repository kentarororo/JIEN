import { localTimestampForDate } from '../time.ts';
import type { MealType, SaveMealInput } from '../db/types.ts';

export type FoodCopyRow = {
  mealId: string;
  mealName: string;
  mealType: MealType | null;
  eatenAt: string;
  itemId: string;
  sortOrder: number;
  name: string;
  quantity: number;
  unit: string;
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fibreG: number | null;
};

/** Convert immutable history snapshots into new manual logs without retaining provider/AI claims. */
export function buildFoodCopyMeals(
  rows: FoodCopyRow[],
  targetDate: string,
  now = new Date(),
): SaveMealInput[] {
  const groups = new Map<string, FoodCopyRow[]>();
  for (const row of rows) groups.set(row.mealId, [...(groups.get(row.mealId) ?? []), row]);
  return [...groups.values()].map((mealRows) => {
    const first = mealRows[0]!;
    const sourceClock = new Date(first.eatenAt);
    let eatenAt = localTimestampForDate(targetDate, sourceClock);
    if (new Date(eatenAt).getTime() > now.getTime()) eatenAt = localTimestampForDate(targetDate, now);
    return {
      name: first.mealName,
      type: first.mealType ?? 'other',
      eatenAt,
      items: mealRows
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder || left.itemId.localeCompare(right.itemId))
        .map((row) => ({
          name: row.name,
          quantity: row.quantity,
          unit: row.unit,
          caloriesKcal: row.caloriesKcal,
          proteinG: row.proteinG,
          carbohydrateG: row.carbohydrateG,
          fatG: row.fatG,
          fibreG: row.fibreG,
          source: 'manual',
          confidence: null,
        })),
    };
  });
}
