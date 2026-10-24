import { useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Field, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { listPrivateFoods, listRecipes, removePrivateFood, savePrivateFood, type FoodCatalogItem } from '@/lib/db';
import { spacing, typography, useJienTheme } from '@/theme';

type FoodDraft = {
  id: string | null;
  name: string;
  brand: string;
  barcode: string;
  servingQuantity: string;
  servingUnit: string;
  caloriesKcal: string;
  proteinG: string;
  carbohydrateG: string;
  fatG: string;
  fibreG: string;
};

const emptyDraft = (): FoodDraft => ({
  id: null,
  name: '',
  brand: '',
  barcode: '',
  servingQuantity: '1',
  servingUnit: 'serving',
  caloriesKcal: '',
  proteinG: '',
  carbohydrateG: '',
  fatG: '',
  fibreG: '',
});

export default function MyFoodsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<FoodDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const loader = useCallback(async () => {
    const [foods, recipes] = await Promise.all([listPrivateFoods(db, query), listRecipes(db, query)]);
    return { foods, recipes };
  }, [db, query]);
  const { data, error, loading, reload } = useScreenData(loader);
  const foods = data?.foods ?? [];
  const recipes = data?.recipes ?? [];

  const beginCreate = () => {
    setDraft(emptyDraft());
    setFormError(null);
    setMessage(null);
    setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 0);
  };

  const beginEdit = (food: FoodCatalogItem) => {
    setDraft(toDraft(food));
    setFormError(null);
    setMessage(null);
    setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 0);
  };

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const saved = await savePrivateFood(db, {
        id: draft.id,
        name: draft.name,
        brand: draft.brand,
        barcode: draft.barcode,
        servingQuantity: Number(draft.servingQuantity),
        servingUnit: draft.servingUnit,
        caloriesKcal: Number(draft.caloriesKcal),
        proteinG: Number(draft.proteinG),
        carbohydrateG: Number(draft.carbohydrateG),
        fatG: Number(draft.fatG),
        fibreG: draft.fibreG.trim() ? Number(draft.fibreG) : null,
      });
      setDraft(null);
      setMessage(`${saved.name} saved. Past meal entries were not changed.`);
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'This saved food could not be updated.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (food: FoodCatalogItem) => {
    if (removingId || !await confirmRemoval(food)) return;
    setRemovingId(food.id);
    setFormError(null);
    setMessage(null);
    try {
      await removePrivateFood(db, food.id);
      if (draft?.id === food.id) setDraft(null);
      setMessage(food.isShared
        ? `${food.name} removed. Community withdrawal is queued; past meal entries were not changed.`
        : `${food.name} removed. Past meal entries were not changed.`);
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'This saved food could not be removed.');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Screen scrollViewRef={scrollRef} contentContainerStyle={styles.content}>
      <ScreenHeading
        title="My foods"
        eyebrow="Saved food library"
        action={<View style={styles.actions}><Button label="Manage recipes" onPress={() => router.push('/recipes' as never)} variant="secondary" /><Button label="Create saved food" onPress={beginCreate} variant="secondary" /><Button label="Done" onPress={() => router.back()} variant="quiet" /></View>}
      />
      <Card style={{ backgroundColor: colors.surfaceMuted }}>
        <Field
          label="Search saved foods"
          value={query}
          onChangeText={setQuery}
          placeholder="Name, brand, or exact barcode"
          returnKeyType="search"
        />
        {query ? <Button label="Clear search" onPress={() => setQuery('')} variant="quiet" /> : null}
      </Card>

      {draft ? (
        <Card accessibilityLabel={draft.id ? `Editing ${draft.name}` : 'Creating a saved food'} style={[styles.editor, { borderColor: colors.accent }]}>
          <View style={styles.editorHeader}>
            <View style={styles.flex}>
              <AppText style={[styles.kicker, { color: colors.accent }]}>{draft.id ? 'EDIT SAVED FOOD' : 'NEW SAVED FOOD'}</AppText>
              <AppText style={styles.editorTitle}>{draft.id ? draft.name || 'Saved food' : 'Create saved food'}</AppText>
              <AppText style={{ color: colors.textMuted }}>Changes affect future selections only. Past meal entries keep their saved values.</AppText>
            </View>
            <Button label="Close editor" onPress={() => setDraft(null)} variant="quiet" disabled={saving} />
          </View>
          <View style={styles.fieldGrid}>
            <Field label="Food name" value={draft.name} onChangeText={(value) => setDraft({ ...draft, name: value })} maxLength={160} containerStyle={styles.wideField} />
            <Field label="Brand (optional)" value={draft.brand} onChangeText={(value) => setDraft({ ...draft, brand: value })} maxLength={160} containerStyle={styles.wideField} />
            <Field label="Serving quantity" value={draft.servingQuantity} onChangeText={(value) => setDraft({ ...draft, servingQuantity: value })} keyboardType="decimal-pad" containerStyle={styles.field} />
            <Field label="Serving unit" value={draft.servingUnit} onChangeText={(value) => setDraft({ ...draft, servingUnit: value })} maxLength={48} containerStyle={styles.field} />
            <Field label="Calories" value={draft.caloriesKcal} onChangeText={(value) => setDraft({ ...draft, caloriesKcal: value })} keyboardType="decimal-pad" containerStyle={styles.field} />
            <Field label="Protein (g)" value={draft.proteinG} onChangeText={(value) => setDraft({ ...draft, proteinG: value })} keyboardType="decimal-pad" containerStyle={styles.field} />
            <Field label="Carbs (g)" value={draft.carbohydrateG} onChangeText={(value) => setDraft({ ...draft, carbohydrateG: value })} keyboardType="decimal-pad" containerStyle={styles.field} />
            <Field label="Fat (g)" value={draft.fatG} onChangeText={(value) => setDraft({ ...draft, fatG: value })} keyboardType="decimal-pad" containerStyle={styles.field} />
            <Field label="Fibre (g, optional)" value={draft.fibreG} onChangeText={(value) => setDraft({ ...draft, fibreG: value })} keyboardType="decimal-pad" containerStyle={styles.field} />
            <Field label="Product barcode (optional)" value={draft.barcode} onChangeText={(value) => setDraft({ ...draft, barcode: value })} inputMode="numeric" maxLength={32} containerStyle={styles.wideField} />
          </View>
          {formError ? <AppText accessibilityRole="alert" style={{ color: colors.danger }}>{formError}</AppText> : null}
          <View style={styles.actions}>
            <Button label={draft.id ? 'Save food changes' : 'Save food'} onPress={() => void save()} busy={saving} />
            <Button label="Cancel" onPress={() => setDraft(null)} variant="quiet" disabled={saving} />
          </View>
        </Card>
      ) : null}

      {message ? <Card style={{ backgroundColor: colors.successSoft, borderColor: colors.success }}><AppText accessibilityLiveRegion="polite" style={{ color: colors.success }}>{message}</AppText></Card> : null}
      {!draft && formError ? <Card style={{ backgroundColor: colors.dangerSoft, borderColor: colors.danger }}><AppText accessibilityRole="alert" style={{ color: colors.danger }}>{formError}</AppText></Card> : null}

      <SectionHeading title="Recipes" detail={`${recipes.length} result${recipes.length === 1 ? '' : 's'}`} />
      {!loading && !error && recipes.length === 0 && !query ? <StatePanel title="No recipes yet" body="Build a recipe once, then log servings from Add food." actionLabel="Create recipe" onAction={() => router.push('/recipes' as never)} /> : null}
      <View style={styles.list}>{recipes.map((recipe) => <Card key={recipe.id}><View style={styles.foodHeader}><View style={styles.flex}><AppText style={styles.foodName}>{recipe.name}</AppText><AppText style={{ color: colors.textMuted }}>Recipe · {recipe.ingredients.length} ingredients · {formatNumber(recipe.perServing.caloriesKcal)} kcal per serving</AppText></View><Button label={`Edit ${recipe.name}`} onPress={() => router.push('/recipes' as never)} variant="secondary" /></View></Card>)}</View>

      <SectionHeading title="Saved foods" detail={loading && data ? 'Updating local results…' : `${foods.length} result${foods.length === 1 ? '' : 's'} · newest first`} />
      {loading && !data ? <StatePanel title="Loading saved foods" body="Reading your private food library from this device." loading /> : null}
      {error ? <StatePanel title="Saved foods are unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /> : null}
      {!loading && !error && foods.length === 0 && !query ? <StatePanel title="No saved foods yet" body="Create a reusable food here, or save one while adding food to a day." actionLabel="Create a saved food" onAction={beginCreate} /> : null}
      {!loading && !error && foods.length === 0 && query ? <StatePanel title="No matching saved foods" body="Search by food name, brand, or the complete barcode." actionLabel="Clear search" onAction={() => setQuery('')} /> : null}
      <View style={styles.list}>
        {foods.map((food) => (
          <Card key={food.id} accessibilityLabel={`${food.name}${food.brand ? `, ${food.brand}` : ''}, ${formatNumber(food.servingQuantity)} ${food.servingUnit}`}>
            <View style={styles.foodHeader}>
              <View style={styles.flex}>
                <AppText style={styles.foodName}>{food.name}</AppText>
                <AppText style={{ color: colors.textMuted }}>{food.brand || 'No brand'} · {formatNumber(food.servingQuantity)} {food.servingUnit}</AppText>
                <AppText style={{ color: colors.textMuted }}>{formatNumber(food.caloriesKcal)} kcal · P {formatNumber(food.proteinG)} g · C {formatNumber(food.carbohydrateG)} g · F {formatNumber(food.fatG)} g</AppText>
                {food.isShared ? <AppText style={{ color: colors.warning }}>Shared with community · unverified</AppText> : null}
              </View>
              <View style={styles.actions}>
                <Button label="Edit" accessibilityLabel={`Edit ${food.name}`} onPress={() => beginEdit(food)} variant="secondary" />
                <Button label="Remove" accessibilityLabel={`Remove ${food.name}`} onPress={() => void remove(food)} busy={removingId === food.id} variant="danger" />
              </View>
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}

function toDraft(food: FoodCatalogItem): FoodDraft {
  return {
    id: food.id,
    name: food.name,
    brand: food.brand ?? '',
    barcode: food.barcode ?? '',
    servingQuantity: formatNumber(food.servingQuantity),
    servingUnit: food.servingUnit,
    caloriesKcal: formatNumber(food.caloriesKcal),
    proteinG: formatNumber(food.proteinG),
    carbohydrateG: formatNumber(food.carbohydrateG),
    fatG: formatNumber(food.fatG),
    fibreG: food.fibreG == null ? '' : formatNumber(food.fibreG),
  };
}

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function confirmRemoval(food: FoodCatalogItem): Promise<boolean> {
  const message = food.isShared
    ? 'The food will leave My foods and community search after sync. Past meal entries will not change.'
    : 'The food will leave My foods and Add food search. Past meal entries will not change.';
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm(`Remove ${food.name}?\n\n${message}`));
  return new Promise((resolve) => {
    Alert.alert(
      `Remove ${food.name}?`,
      message,
      [
        { text: 'Keep food', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Remove food', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 920, alignSelf: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  editor: { gap: spacing.lg },
  editorHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: spacing.md },
  kicker: { ...typography.caption, fontWeight: '800', letterSpacing: 0.6 },
  editorTitle: { ...typography.section, fontWeight: '800' },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  field: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 140 },
  wideField: { flexGrow: 1, flexShrink: 1, flexBasis: 320, minWidth: 220 },
  list: { gap: spacing.sm },
  foodHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  foodName: { ...typography.bodyLarge, fontWeight: '700' },
  flex: { flex: 1, minWidth: 220 },
});
