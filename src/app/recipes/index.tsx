import { useSQLiteContext } from '@/lib/db/database-context';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Field, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import {
  cacheFoodCatalogItems,
  calculateRecipePerServing,
  listRecipes,
  removeRecipe,
  saveRecipe,
  searchFoodDatabase,
  searchLocalFoodCatalog,
  type FoodCatalogItem,
  type Recipe,
} from '@/lib/db';
import { spacing, typography, useJienTheme } from '@/theme';

type IngredientDraft = {
  key: string;
  food: FoodCatalogItem;
  quantity: string;
};

type RecipeDraft = {
  id: string | null;
  name: string;
  servings: string;
  ingredients: IngredientDraft[];
};

export default function RecipesScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodCatalogItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const loader = useCallback(() => listRecipes(db), [db]);
  const { data, error, loading, reload } = useScreenData(loader);
  const recipes = data ?? [];
  const preview = useMemo(() => {
    if (!draft) return null;
    try {
      return calculateRecipePerServing(Number(draft.servings), draft.ingredients.map((item) => ({
        food: item.food,
        quantity: Number(item.quantity),
      })));
    } catch {
      return null;
    }
  }, [draft]);

  const beginCreate = () => {
    setDraft({ id: null, name: '', servings: '1', ingredients: [] });
    setFormError(null);
    setMessage(null);
  };

  const beginEdit = (recipe: Recipe) => {
    setDraft({
      id: recipe.id,
      name: recipe.name,
      servings: String(recipe.servings),
      ingredients: recipe.ingredients.map((ingredient) => ({
        key: ingredient.id,
        food: ingredient.food,
        quantity: String(ingredient.quantity),
      })),
    });
    setFormError(null);
    setMessage(null);
  };

  const search = async () => {
    if (query.trim().length < 2) {
      setFormError('Enter at least two characters to search ingredients.');
      return;
    }
    setSearching(true);
    setFormError(null);
    try {
      const local = await searchLocalFoodCatalog(db, query, 12);
      const online = await searchFoodDatabase(query).catch(() => []);
      const merged = [...local, ...online].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 16);
      setResults(merged);
      await cacheFoodCatalogItems(db, online);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Ingredient search is unavailable.');
    } finally {
      setSearching(false);
    }
  };

  const addIngredient = (food: FoodCatalogItem) => {
    if (!draft) return;
    setDraft({ ...draft, ingredients: [...draft.ingredients, { key: `${Date.now()}-${draft.ingredients.length}`, food, quantity: '1' }] });
    setQuery('');
    setResults([]);
  };

  const addManualIngredient = () => addIngredient({
    id: `manual-${Date.now()}`,
    name: '',
    brand: null,
    servingQuantity: 1,
    servingUnit: 'serving',
    caloriesKcal: 0,
    proteinG: 0,
    carbohydrateG: 0,
    fatG: 0,
    fibreG: null,
    source: 'custom',
    sourceRef: null,
    barcode: null,
    confidence: null,
  });

  const updateIngredient = (key: string, values: Partial<FoodCatalogItem> & { quantity?: string }) => {
    if (!draft) return;
    setDraft({
      ...draft,
      ingredients: draft.ingredients.map((ingredient) => ingredient.key === key
        ? { ...ingredient, quantity: values.quantity ?? ingredient.quantity, food: { ...ingredient.food, ...values } }
        : ingredient),
    });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setFormError(null);
    try {
      const recipe = await saveRecipe(db, {
        id: draft.id,
        name: draft.name,
        servings: Number(draft.servings),
        ingredients: draft.ingredients.map((ingredient) => ({ food: ingredient.food, quantity: Number(ingredient.quantity) })),
      });
      setDraft(null);
      setMessage(`${recipe.name} saved locally and queued for sync. Past food logs were not changed.`);
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'This recipe could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (recipe: Recipe) => {
    if (removing || !await confirmRemove(recipe.name)) return;
    setRemoving(recipe.id);
    setFormError(null);
    try {
      await removeRecipe(db, recipe.id);
      if (draft?.id === recipe.id) setDraft(null);
      setMessage(`${recipe.name} removed. Past food logs were not changed.`);
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'This recipe could not be removed.');
    } finally {
      setRemoving(null);
    }
  };

  return <Screen contentContainerStyle={styles.content}>
    <ScreenHeading eyebrow="My foods" title="Recipes" action={<View style={styles.actions}><Button label="Create recipe" onPress={beginCreate} /><Button label="Done" onPress={() => router.back()} variant="quiet" /></View>} />
    {message ? <Card style={{ backgroundColor: colors.successSoft }}><AppText accessibilityLiveRegion="polite">{message}</AppText></Card> : null}
    {formError ? <Card style={{ backgroundColor: colors.dangerSoft }}><AppText accessibilityRole="alert" style={{ color: colors.danger }}>{formError}</AppText></Card> : null}
    {draft ? <Card style={{ borderColor: colors.accent }}>
      <AppText style={styles.title}>{draft.id ? 'Edit recipe' : 'Create recipe'}</AppText>
      <AppText style={{ color: colors.textMuted }}>Ingredients are copied as nutrition snapshots. Later food edits do not change this recipe until you edit it.</AppText>
      <View style={styles.grid}><Field label="Recipe name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} containerStyle={styles.wide} /><Field label="Total servings" value={draft.servings} onChangeText={(servings) => setDraft({ ...draft, servings })} keyboardType="decimal-pad" containerStyle={styles.field} /></View>
      <SectionHeading title="Ingredients" detail={`${draft.ingredients.length} added`} />
      <View style={styles.searchRow}><View style={styles.flex}><Field label="Find an ingredient" value={query} onChangeText={setQuery} placeholder="Private food or food database" returnKeyType="search" onSubmitEditing={() => void search()} /></View><Button label="Search" onPress={() => void search()} busy={searching} variant="secondary" /><Button label="Add manually" onPress={addManualIngredient} variant="quiet" /></View>
      {results.length ? <View style={styles.list}>{results.map((food) => <Card key={food.id} style={{ backgroundColor: colors.surfaceMuted }}><View style={styles.row}><View style={styles.flex}><AppText style={styles.itemName}>{food.name}</AppText><AppText style={{ color: colors.textMuted }}>{food.caloriesKcal} kcal · {food.servingQuantity} {food.servingUnit}</AppText></View><Button label={`Add ${food.name}`} onPress={() => addIngredient(food)} variant="secondary" /></View></Card>)}</View> : null}
      {!draft.ingredients.length ? <StatePanel title="No ingredients yet" body="Search your saved and cached foods, search the online database, or add an ingredient manually." /> : null}
      <View style={styles.list}>{draft.ingredients.map((ingredient, index) => <Card key={ingredient.key}>
        <View style={styles.row}><AppText style={styles.itemName}>Ingredient {index + 1}</AppText><Button label={`Remove ingredient ${index + 1}`} onPress={() => setDraft({ ...draft, ingredients: draft.ingredients.filter((item) => item.key !== ingredient.key) })} variant="danger" /></View>
        <View style={styles.grid}>
          <Field label="Name" value={ingredient.food.name} onChangeText={(name) => updateIngredient(ingredient.key, { name })} containerStyle={styles.wide} />
          <Field label="Number of servings" value={ingredient.quantity} onChangeText={(quantity) => updateIngredient(ingredient.key, { quantity })} keyboardType="decimal-pad" containerStyle={styles.field} />
          <Field label="Serving quantity" value={String(ingredient.food.servingQuantity)} onChangeText={(value) => updateIngredient(ingredient.key, { servingQuantity: Number(value) })} keyboardType="decimal-pad" containerStyle={styles.field} />
          <Field label="Serving unit" value={ingredient.food.servingUnit} onChangeText={(servingUnit) => updateIngredient(ingredient.key, { servingUnit })} containerStyle={styles.field} />
          {(['caloriesKcal', 'proteinG', 'carbohydrateG', 'fatG', 'fibreG'] as const).map((field) => <Field key={field} label={macroLabel(field)} value={String(ingredient.food[field] ?? 0)} onChangeText={(value) => updateIngredient(ingredient.key, { [field]: Number(value) })} keyboardType="decimal-pad" containerStyle={styles.field} />)}
        </View>
      </Card>)}</View>
      {preview ? <Card style={{ backgroundColor: colors.accentSoft }}><AppText style={styles.itemName}>Per serving</AppText><AppText>{format(preview.caloriesKcal)} kcal · P {format(preview.proteinG)} g · C {format(preview.carbohydrateG)} g · F {format(preview.fatG)} g</AppText></Card> : null}
      <View style={styles.actions}><Button label={draft.id ? 'Save recipe changes' : 'Save recipe'} onPress={() => void save()} busy={saving} /><Button label="Cancel" onPress={() => setDraft(null)} variant="quiet" /></View>
    </Card> : null}
    <SectionHeading title="Saved recipes" detail={`${recipes.length} recipe${recipes.length === 1 ? '' : 's'}`} />
    {loading && !data ? <StatePanel title="Loading recipes" body="Reading private recipes from this device." loading /> : null}
    {error ? <StatePanel title="Recipes are unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /> : null}
    {!loading && !error && !recipes.length ? <StatePanel title="No recipes yet" body="Build a recipe once, then log any number of servings from Add food." actionLabel="Create recipe" onAction={beginCreate} /> : null}
    <View style={styles.list}>{recipes.map((recipe) => <Card key={recipe.id}><View style={styles.row}><View style={styles.flex}><AppText style={styles.itemName}>{recipe.name}</AppText><AppText style={{ color: colors.textMuted }}>Recipe · {recipe.ingredients.length} ingredients · {recipe.servings} servings</AppText><AppText>{format(recipe.perServing.caloriesKcal)} kcal · P {format(recipe.perServing.proteinG)} g per serving</AppText></View><View style={styles.actions}><Button label={`Edit ${recipe.name}`} onPress={() => beginEdit(recipe)} variant="secondary" /><Button label={`Remove ${recipe.name}`} onPress={() => void remove(recipe)} busy={removing === recipe.id} variant="danger" /></View></View></Card>)}</View>
  </Screen>;
}

function macroLabel(field: 'caloriesKcal' | 'proteinG' | 'carbohydrateG' | 'fatG' | 'fibreG'): string {
  return ({ caloriesKcal: 'Calories', proteinG: 'Protein (g)', carbohydrateG: 'Carbs (g)', fatG: 'Fat (g)', fibreG: 'Fibre (g)' })[field];
}

function format(value: number): string { return String(Math.round(value * 100) / 100); }

function confirmRemove(name: string): Promise<boolean> {
  const message = 'The recipe will leave My foods and Add food search. Past food logs will not change.';
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm(`Remove ${name}?\n\n${message}`));
  return new Promise((resolve) => Alert.alert(`Remove ${name}?`, message, [
    { text: 'Keep recipe', style: 'cancel', onPress: () => resolve(false) },
    { text: 'Remove recipe', style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 920, alignSelf: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  searchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'flex-end' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flex: { flex: 1, minWidth: 220 },
  field: { flexGrow: 1, flexBasis: 150, minWidth: 130 },
  wide: { flexGrow: 2, flexBasis: 300, minWidth: 220 },
  list: { gap: spacing.sm },
  title: { ...typography.section, fontWeight: '800' },
  itemName: { ...typography.bodyLarge, fontWeight: '700' },
});
