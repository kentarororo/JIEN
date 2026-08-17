type MealContextRow = { id: string; eaten_on: string };
type FoodContextRow = {
  meal_id: string;
  calories_kcal: number | string | null;
  protein_g: number | string | null;
  carbohydrate_g: number | string | null;
  fat_g: number | string | null;
};
type TargetContextRow = {
  calories_kcal: number | string;
  protein_g: number | string;
  carbohydrate_g: number | string;
  fat_g: number | string;
} | null;

type MacroTotals = {
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
};

export function summarizeLoggedNutrition(
  meals: MealContextRow[],
  foods: FoodContextRow[],
  target: TargetContextRow,
) {
  const mealDates = new Map(meals.map((meal) => [meal.id, meal.eaten_on]));
  const days = new Map<string, MacroTotals & { mealCount: number }>();
  for (const meal of meals) {
    const current = days.get(meal.eaten_on) ?? { ...emptyTotals(), mealCount: 0 };
    current.mealCount += 1;
    days.set(meal.eaten_on, current);
  }
  for (const food of foods) {
    const eatenOn = mealDates.get(food.meal_id);
    if (!eatenOn) continue;
    const current = days.get(eatenOn) ?? { ...emptyTotals(), mealCount: 0 };
    current.caloriesKcal += numeric(food.calories_kcal);
    current.proteinG += numeric(food.protein_g);
    current.carbohydrateG += numeric(food.carbohydrate_g);
    current.fatG += numeric(food.fat_g);
    days.set(eatenOn, current);
  }

  const loggedDays = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({
    date,
    mealCount: values.mealCount,
    ...roundedTotals(values),
  }));
  const totals = loggedDays.reduce((sum, day) => ({
    caloriesKcal: sum.caloriesKcal + day.caloriesKcal,
    proteinG: sum.proteinG + day.proteinG,
    carbohydrateG: sum.carbohydrateG + day.carbohydrateG,
    fatG: sum.fatG + day.fatG,
  }), emptyTotals());
  const divisor = loggedDays.length || 1;

  return {
    daysLogged: loggedDays.length,
    mealCount: meals.length,
    loggedDays,
    loggedDayAverages: roundedTotals({
      caloriesKcal: totals.caloriesKcal / divisor,
      proteinG: totals.proteinG / divisor,
      carbohydrateG: totals.carbohydrateG / divisor,
      fatG: totals.fatG / divisor,
    }),
    totals: roundedTotals(totals),
    currentTarget: target ? roundedTotals({
      caloriesKcal: numeric(target.calories_kcal),
      proteinG: numeric(target.protein_g),
      carbohydrateG: numeric(target.carbohydrate_g),
      fatG: numeric(target.fat_g),
    }) : null,
  };
}

function emptyTotals(): MacroTotals {
  return { caloriesKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 };
}

function numeric(value: number | string | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function roundedTotals(value: MacroTotals): MacroTotals {
  return {
    caloriesKcal: round(value.caloriesKcal),
    proteinG: round(value.proteinG),
    carbohydrateG: round(value.carbohydrateG),
    fatG: round(value.fatG),
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
