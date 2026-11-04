import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { withExclusiveTransaction } from './exclusive-transaction';
import { enqueueUpsert } from './sync-queue';
import type { FoodCatalogItem, MacroTotals } from './types';

export type RecipeIngredientInput = {
  food: FoodCatalogItem;
  quantity: number;
};

export type RecipeIngredient = RecipeIngredientInput & { id: string; sortOrder: number };

export type Recipe = {
  id: string;
  name: string;
  servings: number;
  ingredients: RecipeIngredient[];
  perServing: MacroTotals;
};

export type SaveRecipeInput = {
  id?: string | null;
  name: string;
  servings: number;
  ingredients: RecipeIngredientInput[];
};

type RecipeRow = {
  id: string;
  name: string;
  servings: number;
  created_at: string;
  client_updated_at: string;
};

type IngredientRow = {
  id: string;
  recipe_id: string;
  sort_order: number;
  name: string;
  quantity: number;
  serving_quantity: number;
  serving_unit: string;
  calories_kcal: number;
  protein_g: number;
  carbohydrate_g: number;
  fat_g: number;
  fibre_g: number | null;
  source: FoodCatalogItem['source'];
  source_ref: string | null;
};

export function calculateRecipePerServing(
  servings: number,
  ingredients: RecipeIngredientInput[],
): MacroTotals {
  if (!Number.isFinite(servings) || servings <= 0) throw new Error('Enter a positive number of recipe servings.');
  if (!ingredients.length) throw new Error('Add at least one ingredient.');
  const totals = ingredients.reduce<MacroTotals>((sum, ingredient) => {
    if (!Number.isFinite(ingredient.quantity) || ingredient.quantity <= 0) {
      throw new Error('Every ingredient needs a positive portion.');
    }
    validateIngredientFood(ingredient.food);
    return {
      caloriesKcal: sum.caloriesKcal + ingredient.food.caloriesKcal * ingredient.quantity,
      proteinG: sum.proteinG + ingredient.food.proteinG * ingredient.quantity,
      carbohydrateG: sum.carbohydrateG + ingredient.food.carbohydrateG * ingredient.quantity,
      fatG: sum.fatG + ingredient.food.fatG * ingredient.quantity,
      fibreG: sum.fibreG + (ingredient.food.fibreG ?? 0) * ingredient.quantity,
    };
  }, { caloriesKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0, fibreG: 0 });
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, round(value / servings)])) as MacroTotals;
}

export async function listRecipes(db: SQLiteDatabase, query = ''): Promise<Recipe[]> {
  const clean = query.trim();
  if (clean.length === 1) return [];
  const rows = await db.getAllAsync<RecipeRow>(
    `SELECT id, name, servings, created_at, client_updated_at FROM recipes
     WHERE deleted_at IS NULL ${clean ? 'AND name LIKE ? COLLATE NOCASE' : ''}
     ORDER BY created_at DESC, id DESC`,
    clean ? [`%${clean}%`] : [],
  );
  if (!rows.length) return [];
  const placeholders = rows.map(() => '?').join(',');
  const ingredients = await db.getAllAsync<IngredientRow>(
    `SELECT id, recipe_id, sort_order, name, quantity, serving_quantity, serving_unit,
      calories_kcal, protein_g, carbohydrate_g, fat_g, fibre_g, source, source_ref
     FROM recipe_ingredients WHERE deleted_at IS NULL AND recipe_id IN (${placeholders})
     ORDER BY recipe_id, sort_order`,
    rows.map((row) => row.id),
  );
  return rows.map((row) => mapRecipe(row, ingredients.filter((ingredient) => ingredient.recipe_id === row.id)));
}

export async function getRecipe(db: SQLiteDatabase, id: string): Promise<Recipe | null> {
  return (await listRecipes(db)).find((recipe) => recipe.id === id) ?? null;
}

export async function searchRecipesAsFoods(db: SQLiteDatabase, query: string, limit = 8): Promise<FoodCatalogItem[]> {
  const recipes = await listRecipes(db, query);
  return recipes.slice(0, limit).map(recipeToCatalogItem);
}

export function recipeToCatalogItem(recipe: Recipe): FoodCatalogItem {
  return {
    id: `recipe-${recipe.id}`,
    name: recipe.name,
    brand: 'Recipe',
    servingQuantity: 1,
    servingUnit: 'serving',
    ...recipe.perServing,
    source: 'recipe',
    sourceRef: recipe.id,
    barcode: null,
    confidence: null,
  };
}

export async function saveRecipe(db: SQLiteDatabase, input: SaveRecipeInput): Promise<Recipe> {
  const name = input.name.trim();
  if (!name || name.length > 160) throw new Error('Enter a recipe name up to 160 characters.');
  calculateRecipePerServing(input.servings, input.ingredients);
  const id = input.id ?? Crypto.randomUUID();
  await withExclusiveTransaction(db, async (tx) => {
    const existing = await tx.getFirstAsync<RecipeRow>(
      'SELECT id, name, servings, created_at, client_updated_at FROM recipes WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    if (input.id && !existing) throw new Error('This recipe could not be found.');
    const now = new Date(Math.max(Date.now(), (Date.parse(existing?.client_updated_at ?? '') || 0) + 1)).toISOString();
    const recipePayload = {
      id,
      name,
      servings: input.servings,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      client_updated_at: now,
      deleted_at: null,
    };
    await tx.runAsync(
      `INSERT INTO recipes (id, name, servings, created_at, updated_at, client_updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, servings=excluded.servings,
         updated_at=excluded.updated_at, client_updated_at=excluded.client_updated_at, deleted_at=NULL`,
      [id, name, input.servings, recipePayload.created_at, now, now],
    );
    await enqueueUpsert(tx, 'recipes', id, recipePayload);

    const oldRows = await tx.getAllAsync<IngredientRow & { created_at: string }>(
      `SELECT *, created_at FROM recipe_ingredients WHERE recipe_id = ? AND deleted_at IS NULL`, [id]);
    for (const old of oldRows) {
      await tx.runAsync('UPDATE recipe_ingredients SET deleted_at=?, updated_at=?, client_updated_at=? WHERE id=?', [now, now, now, old.id]);
      await enqueueUpsert(tx, 'recipe_ingredients', old.id, ingredientPayload(old, old.created_at, now, now));
    }
    for (const [sortOrder, ingredient] of input.ingredients.entries()) {
      const ingredientId = Crypto.randomUUID();
      const row: IngredientRow = {
        id: ingredientId,
        recipe_id: id,
        sort_order: sortOrder,
        name: ingredient.food.name,
        quantity: ingredient.quantity,
        serving_quantity: ingredient.food.servingQuantity,
        serving_unit: ingredient.food.servingUnit,
        calories_kcal: ingredient.food.caloriesKcal,
        protein_g: ingredient.food.proteinG,
        carbohydrate_g: ingredient.food.carbohydrateG,
        fat_g: ingredient.food.fatG,
        fibre_g: ingredient.food.fibreG,
        source: ingredient.food.source,
        source_ref: ingredient.food.sourceRef ?? ingredient.food.id,
      };
      await tx.runAsync(
        `INSERT INTO recipe_ingredients (id, recipe_id, sort_order, name, quantity,
          serving_quantity, serving_unit, calories_kcal, protein_g, carbohydrate_g,
          fat_g, fibre_g, source, source_ref, created_at, updated_at, client_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.id, id, row.sort_order, row.name, row.quantity, row.serving_quantity,
          row.serving_unit, row.calories_kcal, row.protein_g, row.carbohydrate_g,
          row.fat_g, row.fibre_g, row.source, row.source_ref, now, now, now],
      );
      await enqueueUpsert(tx, 'recipe_ingredients', row.id, ingredientPayload(row, now, now, null));
    }
  });
  return (await getRecipe(db, id))!;
}

export async function removeRecipe(db: SQLiteDatabase, id: string): Promise<void> {
  await withExclusiveTransaction(db, async (tx) => {
    const recipe = await tx.getFirstAsync<RecipeRow>('SELECT id, name, servings, created_at, client_updated_at FROM recipes WHERE id=? AND deleted_at IS NULL', [id]);
    if (!recipe) throw new Error('This recipe could not be found.');
    const now = new Date(Math.max(Date.now(), (Date.parse(recipe.client_updated_at) || 0) + 1)).toISOString();
    const ingredients = await tx.getAllAsync<IngredientRow & { created_at: string }>('SELECT *, created_at FROM recipe_ingredients WHERE recipe_id=? AND deleted_at IS NULL', [id]);
    for (const ingredient of ingredients) {
      await tx.runAsync('UPDATE recipe_ingredients SET deleted_at=?, updated_at=?, client_updated_at=? WHERE id=?', [now, now, now, ingredient.id]);
      await enqueueUpsert(tx, 'recipe_ingredients', ingredient.id, ingredientPayload(ingredient, ingredient.created_at, now, now));
    }
    await tx.runAsync('UPDATE recipes SET deleted_at=?, updated_at=?, client_updated_at=? WHERE id=?', [now, now, now, id]);
    await enqueueUpsert(tx, 'recipes', id, { id, name: recipe.name, servings: recipe.servings, created_at: recipe.created_at, updated_at: now, client_updated_at: now, deleted_at: now });
  });
}

function mapRecipe(row: RecipeRow, rows: IngredientRow[]): Recipe {
  const ingredients = rows.map((ingredient) => ({
    id: ingredient.id,
    sortOrder: ingredient.sort_order,
    quantity: ingredient.quantity,
    food: {
      id: ingredient.source_ref ?? ingredient.id,
      name: ingredient.name,
      brand: null,
      servingQuantity: ingredient.serving_quantity,
      servingUnit: ingredient.serving_unit,
      caloriesKcal: ingredient.calories_kcal,
      proteinG: ingredient.protein_g,
      carbohydrateG: ingredient.carbohydrate_g,
      fatG: ingredient.fat_g,
      fibreG: ingredient.fibre_g,
      source: ingredient.source,
      sourceRef: ingredient.source_ref,
      barcode: null,
      confidence: null,
    },
  }));
  return { id: row.id, name: row.name, servings: row.servings, ingredients, perServing: calculateRecipePerServing(row.servings, ingredients) };
}

function ingredientPayload(row: IngredientRow, createdAt: string, updatedAt: string, deletedAt: string | null) {
  return {
    id: row.id, recipe_id: row.recipe_id, sort_order: row.sort_order, name: row.name,
    quantity: row.quantity, serving_quantity: row.serving_quantity, serving_unit: row.serving_unit,
    calories_kcal: row.calories_kcal, protein_g: row.protein_g,
    carbohydrate_g: row.carbohydrate_g, fat_g: row.fat_g, fibre_g: row.fibre_g,
    source: row.source, source_ref: row.source_ref, created_at: createdAt,
    updated_at: updatedAt, client_updated_at: updatedAt, deleted_at: deletedAt,
  };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validateIngredientFood(food: FoodCatalogItem): void {
  if (!food.name.trim() || food.name.trim().length > 160) throw new Error('Every ingredient needs a name.');
  if (!food.servingUnit.trim() || food.servingUnit.trim().length > 48) throw new Error('Every ingredient needs a serving unit.');
  const values = [food.servingQuantity, food.caloriesKcal, food.proteinG, food.carbohydrateG, food.fatG, food.fibreG ?? 0];
  if (values.some((value) => !Number.isFinite(value) || value < 0) || food.servingQuantity <= 0) {
    throw new Error('Every ingredient needs a valid serving and non-negative nutrition.');
  }
}
