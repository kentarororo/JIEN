import type { MealDraftFood, MealDraftType } from '../meal-draft.ts';
import { historicalDateKey, shiftLocalDateKey, toLocalDateKey } from '../time.ts';

export type RepeatMealSnapshot = {
  name: string;
  type: MealDraftType | null;
  items: Array<{
    name: string;
    quantity: number;
    unit: string;
    caloriesKcal: number;
    proteinG: number;
    carbohydrateG: number;
    fatG: number;
    fibreG: number | null;
  }>;
};

export type RepeatMealTarget = {
  date: string;
  today: string;
  yesterday: string;
  viewedDate: string | null;
};

export function resolveRepeatMealTarget(
  viewedFoodDate: string | undefined,
  today = toLocalDateKey(),
  backfillDate?: string,
): RepeatMealTarget {
  const viewedDate = viewedFoodDate ? historicalDateKey(viewedFoodDate, today) : today;
  const requestedBackfillDate = backfillDate ? historicalDateKey(backfillDate, today) : today;
  return {
    date: backfillDate && requestedBackfillDate === backfillDate ? requestedBackfillDate : today,
    today,
    yesterday: shiftLocalDateKey(today, -1),
    viewedDate: viewedFoodDate && viewedDate === viewedFoodDate && viewedDate !== today && viewedDate !== shiftLocalDateKey(today, -1)
      ? viewedDate
      : null,
  };
}

export function buildRepeatMealDraft(
  meal: RepeatMealSnapshot,
  defaultType: MealDraftType,
  createKey: () => string,
): { name: string; type: MealDraftType; foods: MealDraftFood[] } {
  return {
    name: meal.name.trim() || 'Meal',
    type: meal.type ?? defaultType,
    foods: meal.items.map((item) => ({
      key: createKey(),
      catalogId: null,
      name: item.name,
      quantity: formatNumber(item.quantity),
      unit: item.unit,
      calories: formatNumber(item.caloriesKcal),
      protein: formatNumber(item.proteinG),
      carbs: formatNumber(item.carbohydrateG),
      fat: formatNumber(item.fatG),
      fibre: item.fibreG == null ? '' : formatNumber(item.fibreG),
      source: 'manual',
      sourceLabel: 'Copied from saved meal',
      confidence: null,
      referenceQuantity: item.quantity,
      referenceUnit: item.unit,
      referenceMacros: {
        caloriesKcal: item.caloriesKcal,
        proteinG: item.proteinG,
        carbohydrateG: item.carbohydrateG,
        fatG: item.fatG,
        fibreG: item.fibreG ?? 0,
      },
    })),
  };
}

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}
