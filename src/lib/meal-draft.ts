export type MealDraftType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';

export type MealDraftFood = {
  key: string;
  catalogId: string | null;
  name: string;
  quantity: string;
  unit: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  fibre: string;
  source: 'manual' | 'ai_photo' | 'imported';
  sourceLabel: string | null;
  confidence: number | null;
  referenceQuantity: number;
  referenceUnit: string;
  referenceMacros: {
    caloriesKcal: number;
    proteinG: number;
    carbohydrateG: number;
    fatG: number;
    fibreG: number;
  };
};

export type MealDraftPhotoAnalysis = {
  requestId: string;
  description: string;
  itemKeys: string[];
};

export type MealDraftSnapshot = {
  version: 1;
  ownerUserId: string;
  context: string;
  name: string;
  type: MealDraftType;
  foods: MealDraftFood[];
  appliedPhotoRequestIds: string[];
  photoAnalyses: MealDraftPhotoAnalysis[];
  updatedAt: string;
};

export type MealDraftSummary = {
  completedFoodCount: number;
  needsAttentionCount: number;
  blankFoodCount: number;
  totals: {
    caloriesKcal: number;
    proteinG: number;
    carbohydrateG: number;
    fatG: number;
    fibreG: number;
  };
};

const TYPES = new Set<MealDraftType>(['breakfast', 'lunch', 'dinner', 'snack', 'other']);
const SOURCES = new Set<MealDraftFood['source']>(['manual', 'ai_photo', 'imported']);

export function mealDraftStorageKey(ownerUserId: string, context: string): string {
  return `jien:meal-draft:v1:${encodeURIComponent(ownerUserId)}:${encodeURIComponent(context)}`;
}

export function mealDraftContext(dateKey: string, photoJob?: string, templateMealId?: string): string {
  const job = boundedString(photoJob, 120);
  if (job) return `photo:${job}`;
  const template = boundedString(templateMealId, 120);
  return template ? `repeat:${template}:date:${dateKey}` : `date:${dateKey}`;
}

export function mealDraftHasContent(
  draft: Pick<MealDraftSnapshot, 'name' | 'type' | 'foods' | 'photoAnalyses'>,
  initialType: MealDraftType,
): boolean {
  return draft.name.trim() !== 'Meal'
    || draft.type !== initialType
    || draft.photoAnalyses.length > 0
    || draft.foods.some((food) => Boolean(
      food.name.trim()
      || food.calories.trim()
      || food.protein.trim()
      || food.carbs.trim()
      || food.fat.trim(),
    ));
}

export function isBlankMealDraftFood(food: MealDraftFood): boolean {
  return !food.name.trim()
    && !food.calories.trim()
    && !food.protein.trim()
    && !food.carbs.trim()
    && !food.fat.trim();
}

export function summarizeMealDraft(foods: MealDraftFood[]): MealDraftSummary {
  const summary: MealDraftSummary = {
    completedFoodCount: 0,
    needsAttentionCount: 0,
    blankFoodCount: 0,
    totals: { caloriesKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0, fibreG: 0 },
  };
  for (const food of foods) {
    if (isBlankMealDraftFood(food)) {
      summary.blankFoodCount += 1;
      continue;
    }
    const quantity = Number(food.quantity);
    const caloriesKcal = Number(food.calories);
    const proteinG = Number(food.protein);
    const carbohydrateG = Number(food.carbs);
    const fatG = Number(food.fat);
    const fibreG = food.fibre.trim() ? Number(food.fibre) : 0;
    const valid = food.name.trim().length > 0
      && food.quantity.trim().length > 0
      && food.calories.trim().length > 0
      && food.protein.trim().length > 0
      && food.carbs.trim().length > 0
      && food.fat.trim().length > 0
      && Number.isFinite(quantity)
      && quantity > 0
      && [caloriesKcal, proteinG, carbohydrateG, fatG, fibreG]
        .every((value) => Number.isFinite(value) && value >= 0);
    if (!valid) {
      summary.needsAttentionCount += 1;
      continue;
    }
    summary.completedFoodCount += 1;
    summary.totals.caloriesKcal += caloriesKcal;
    summary.totals.proteinG += proteinG;
    summary.totals.carbohydrateG += carbohydrateG;
    summary.totals.fatG += fatG;
    summary.totals.fibreG += fibreG;
  }
  return summary;
}

export function parseMealDraft(
  serialized: string,
  expectedOwnerUserId: string,
  expectedContext: string,
): MealDraftSnapshot | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value)
      || value.version !== 1
      || value.ownerUserId !== expectedOwnerUserId
      || value.context !== expectedContext
      || !isBoundedString(value.ownerUserId, 1, 160)
      || !isBoundedString(value.context, 1, 180)
      || !isBoundedString(value.name, 0, 120)
      || typeof value.type !== 'string'
      || !TYPES.has(value.type as MealDraftType)
      || !Array.isArray(value.foods)
      || value.foods.length < 1
      || value.foods.length > 30
      || !Array.isArray(value.appliedPhotoRequestIds)
      || value.appliedPhotoRequestIds.length > 20
      || !Array.isArray(value.photoAnalyses)
      || value.photoAnalyses.length > 10
      || !isBoundedString(value.updatedAt, 1, 40)
      || !Number.isFinite(Date.parse(value.updatedAt))) return null;

    const foods = value.foods.map(parseFood);
    if (foods.some((food) => food == null)) return null;
    const appliedPhotoRequestIds = parseStringList(value.appliedPhotoRequestIds, 120);
    if (!appliedPhotoRequestIds) return null;
    const photoAnalyses = value.photoAnalyses.map(parsePhotoAnalysis);
    if (photoAnalyses.some((analysis) => analysis == null)) return null;

    const foodKeys = new Set((foods as MealDraftFood[]).map((food) => food.key));
    const activePhotoAnalyses = (photoAnalyses as MealDraftPhotoAnalysis[])
      .map((analysis) => ({ ...analysis, itemKeys: analysis.itemKeys.filter((key) => foodKeys.has(key)) }))
      .filter((analysis) => analysis.itemKeys.length > 0);

    return {
      version: 1,
      ownerUserId: value.ownerUserId,
      context: value.context,
      name: value.name,
      type: value.type as MealDraftType,
      foods: foods as MealDraftFood[],
      appliedPhotoRequestIds,
      photoAnalyses: activePhotoAnalyses,
      updatedAt: value.updatedAt,
    };
  } catch {
    return null;
  }
}

function parseFood(value: unknown): MealDraftFood | null {
  if (!isRecord(value)
    || !isBoundedString(value.key, 1, 100)
    || !(value.catalogId === null || isBoundedString(value.catalogId, 1, 200))
    || !isBoundedString(value.name, 0, 180)
    || !isBoundedString(value.quantity, 0, 40)
    || !isBoundedString(value.unit, 1, 40)
    || !isBoundedString(value.calories, 0, 40)
    || !isBoundedString(value.protein, 0, 40)
    || !isBoundedString(value.carbs, 0, 40)
    || !isBoundedString(value.fat, 0, 40)
    || !isBoundedString(value.fibre, 0, 40)
    || typeof value.source !== 'string'
    || !SOURCES.has(value.source as MealDraftFood['source'])
    || !(value.sourceLabel === null || isBoundedString(value.sourceLabel, 0, 120))
    || !(value.confidence === null || isFiniteRange(value.confidence, 0, 1))
    || !isFiniteRange(value.referenceQuantity, 0.000001, 1_000_000)
    || !isBoundedString(value.referenceUnit, 1, 40)
    || !isRecord(value.referenceMacros)) return null;

  const macros = value.referenceMacros;
  if (!isFiniteRange(macros.caloriesKcal, 0, 1_000_000)
    || !isFiniteRange(macros.proteinG, 0, 1_000_000)
    || !isFiniteRange(macros.carbohydrateG, 0, 1_000_000)
    || !isFiniteRange(macros.fatG, 0, 1_000_000)
    || !isFiniteRange(macros.fibreG, 0, 1_000_000)) return null;

  return value as MealDraftFood;
}

function parsePhotoAnalysis(value: unknown): MealDraftPhotoAnalysis | null {
  if (!isRecord(value)
    || !isBoundedString(value.requestId, 1, 120)
    || !isBoundedString(value.description, 0, 500)
    || !Array.isArray(value.itemKeys)
    || value.itemKeys.length > 30) return null;
  const itemKeys = parseStringList(value.itemKeys, 100);
  return itemKeys ? { requestId: value.requestId, description: value.description, itemKeys } : null;
}

function parseStringList(value: unknown[], maximumLength: number): string[] | null {
  if (!value.every((item) => isBoundedString(item, 1, maximumLength))) return null;
  return [...new Set(value as string[])];
}

function boundedString(value: unknown, maximumLength: number): string | null {
  return typeof value === 'string' && value.length <= maximumLength ? value : null;
}

function isBoundedString(value: unknown, minimumLength: number, maximumLength: number): value is string {
  return typeof value === 'string' && value.length >= minimumLength && value.length <= maximumLength;
}

function isFiniteRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
