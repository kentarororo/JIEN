export type ServingMacros = {
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fibreG: number;
};

type UnitDefinition = { dimension: 'mass' | 'volume' | 'count'; factor: number; label: string };

const UNIT_ALIASES: Record<string, UnitDefinition> = {
  g: { dimension: 'mass', factor: 1, label: 'g' },
  gram: { dimension: 'mass', factor: 1, label: 'g' },
  grams: { dimension: 'mass', factor: 1, label: 'g' },
  kg: { dimension: 'mass', factor: 1000, label: 'kg' },
  kilogram: { dimension: 'mass', factor: 1000, label: 'kg' },
  kilograms: { dimension: 'mass', factor: 1000, label: 'kg' },
  oz: { dimension: 'mass', factor: 28.349523125, label: 'oz' },
  ounce: { dimension: 'mass', factor: 28.349523125, label: 'oz' },
  ounces: { dimension: 'mass', factor: 28.349523125, label: 'oz' },
  lb: { dimension: 'mass', factor: 453.59237, label: 'lb' },
  lbs: { dimension: 'mass', factor: 453.59237, label: 'lb' },
  ml: { dimension: 'volume', factor: 1, label: 'ml' },
  millilitre: { dimension: 'volume', factor: 1, label: 'ml' },
  millilitres: { dimension: 'volume', factor: 1, label: 'ml' },
  l: { dimension: 'volume', factor: 1000, label: 'l' },
  litre: { dimension: 'volume', factor: 1000, label: 'l' },
  litres: { dimension: 'volume', factor: 1000, label: 'l' },
  tsp: { dimension: 'volume', factor: 4.92892159375, label: 'tsp' },
  teaspoon: { dimension: 'volume', factor: 4.92892159375, label: 'tsp' },
  tbsp: { dimension: 'volume', factor: 14.78676478125, label: 'tbsp' },
  tablespoon: { dimension: 'volume', factor: 14.78676478125, label: 'tbsp' },
  cup: { dimension: 'volume', factor: 236.5882365, label: 'cup' },
  cups: { dimension: 'volume', factor: 236.5882365, label: 'cup' },
  serving: { dimension: 'count', factor: 1, label: 'serving' },
  servings: { dimension: 'count', factor: 1, label: 'serving' },
  item: { dimension: 'count', factor: 1, label: 'item' },
  items: { dimension: 'count', factor: 1, label: 'item' },
  piece: { dimension: 'count', factor: 1, label: 'piece' },
  pieces: { dimension: 'count', factor: 1, label: 'piece' },
};

function unitDefinition(value: string): UnitDefinition {
  const normalized = value.trim().toLocaleLowerCase();
  return UNIT_ALIASES[normalized] ?? { dimension: 'count', factor: 1, label: value.trim() || 'serving' };
}

export function servingUnitOptions(value: string): string[] {
  const definition = unitDefinition(value);
  if (definition.dimension === 'mass') return ['g', 'oz', 'kg', 'lb'];
  if (definition.dimension === 'volume') return ['ml', 'l', 'cup', 'tbsp', 'tsp'];
  return Array.from(new Set([definition.label, 'serving', 'item']));
}

export function convertServingQuantity(quantity: number, fromUnit: string, toUnit: string): number | null {
  const from = unitDefinition(fromUnit);
  const to = unitDefinition(toUnit);
  if (!Number.isFinite(quantity) || from.dimension !== to.dimension) return null;
  return (quantity * from.factor) / to.factor;
}

export function servingScale(
  quantity: number,
  unit: string,
  referenceQuantity: number,
  referenceUnit: string,
): number | null {
  if (!Number.isFinite(quantity) || quantity < 0 || referenceQuantity <= 0) return null;
  const current = unitDefinition(unit);
  const reference = unitDefinition(referenceUnit);
  if (current.dimension !== reference.dimension) return null;
  return (quantity * current.factor) / (referenceQuantity * reference.factor);
}

export function scaleServingMacros(macros: ServingMacros, scale: number): ServingMacros {
  return {
    caloriesKcal: macros.caloriesKcal * scale,
    proteinG: macros.proteinG * scale,
    carbohydrateG: macros.carbohydrateG * scale,
    fatG: macros.fatG * scale,
    fibreG: macros.fibreG * scale,
  };
}
