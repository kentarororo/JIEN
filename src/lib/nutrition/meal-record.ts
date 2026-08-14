import { toLocalDateKey } from '../time.ts';

export type EditableMealItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fibreG: number | null;
};

export type MealMacroTotals = {
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fibreG: number;
};

export type ValidatedMealEdit = {
  name: string;
  eatenAt: string;
  eatenOn: string;
  items: EditableMealItem[];
  totals: MealMacroTotals;
};

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function mealDateQueryKey(value: string): string {
  const match = DATE_KEY.exec(value);
  if (!match) throw new Error('Choose a valid meal date in YYYY-MM-DD format.');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  if (toLocalDateKey(date) !== value) throw new Error('Choose a valid meal date.');
  return value;
}

export function localMealTimestamp(dateKey: string, clock: string): string {
  mealDateQueryKey(dateKey);
  const time = CLOCK.exec(clock);
  if (!time) throw new Error('Choose a valid meal time in HH:MM format.');
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day, Number(time[1]), Number(time[2]), 0, 0);
  if (toLocalDateKey(date) !== dateKey) throw new Error('Choose a valid meal date.');
  return date.toISOString();
}

export function calculateMealTotals(items: EditableMealItem[]): MealMacroTotals {
  return items.reduce<MealMacroTotals>((totals, item) => ({
    caloriesKcal: totals.caloriesKcal + item.caloriesKcal,
    proteinG: totals.proteinG + item.proteinG,
    carbohydrateG: totals.carbohydrateG + item.carbohydrateG,
    fatG: totals.fatG + item.fatG,
    fibreG: totals.fibreG + (item.fibreG ?? 0),
  }), { caloriesKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0, fibreG: 0 });
}

export function validateMealEdit(
  input: { name: string; eatenAt: string; items: EditableMealItem[] },
  nowMs = Date.now(),
): ValidatedMealEdit {
  const name = input.name.trim();
  if (!name) throw new Error('Give this meal a name.');
  const eatenAt = new Date(input.eatenAt);
  if (!Number.isFinite(eatenAt.getTime()) || eatenAt.getTime() > nowMs + 60_000) {
    throw new Error('Logged meals must use today or an earlier time.');
  }
  if (input.items.length === 0) throw new Error('A saved meal needs at least one food item.');
  const seen = new Set<string>();
  const items = input.items.map((item) => {
    const normalized = {
      ...item,
      name: item.name.trim(),
      unit: item.unit.trim(),
      fibreG: item.fibreG == null ? null : item.fibreG,
    };
    if (!normalized.id || seen.has(normalized.id)) throw new Error('Meal items must be unique.');
    seen.add(normalized.id);
    const values = [
      normalized.caloriesKcal,
      normalized.proteinG,
      normalized.carbohydrateG,
      normalized.fatG,
      ...(normalized.fibreG == null ? [] : [normalized.fibreG]),
    ];
    if (
      !normalized.name
      || !normalized.unit
      || !Number.isFinite(normalized.quantity)
      || normalized.quantity <= 0
      || values.some((value) => !Number.isFinite(value) || value < 0)
    ) {
      throw new Error('Food names, portions, and macros must be valid non-negative values.');
    }
    return normalized;
  });
  return {
    name,
    eatenAt: eatenAt.toISOString(),
    eatenOn: toLocalDateKey(eatenAt),
    items,
    totals: calculateMealTotals(items),
  };
}

export function tombstonePayload<T extends Record<string, unknown>>(
  record: T,
  deletedAt: string,
): T & { client_updated_at: string; deleted_at: string } {
  return { ...record, client_updated_at: deletedAt, deleted_at: deletedAt };
}

export function activeRecordPredicate(alias: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid query alias.');
  return `${alias}.deleted_at IS NULL`;
}
