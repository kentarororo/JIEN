import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from '@/lib/db/database-context';
import { AppText, Button, Card, Field, Pill, Screen, ScreenHeading, StatePanel } from '@/components/ui';
import {
  changeDailyFoodPortion, markFoodCatalogItemUsed, removeDailyFoodItem, saveMeal, searchLocalFoodCatalog,
  type DailyFoodItem, type FoodCatalogItem,
} from '@/lib/db';
import { localTimestampForDate } from '@/lib/time';
import { convertServingQuantity, multipliedPortion, PORTION_MULTIPLIERS, servingScale, servingUnitOptions } from '@/lib/nutrition/serving';
import { spacing, typography, useJienTheme } from '@/theme';

export type FoodSelection = { kind: 'logged'; food: DailyFoodItem } | { kind: 'catalog'; food: FoodCatalogItem };

export function DailyFoodQuickAdd({ onSelect, onQuickAdd, onMultiAdd, onMore }: {
  onSelect: (selection: FoodSelection) => void;
  onQuickAdd: (food: FoodCatalogItem) => Promise<void>;
  onMultiAdd: (foods: FoodCatalogItem[]) => Promise<void>;
  onMore: (query: string) => void;
}) {
  const db = useSQLiteContext();
  const { colors } = useJienTheme();
  const [query, setQuery] = useState('');
  const [foods, setFoods] = useState<FoodCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setSelectedIds([]);
    const timer = setTimeout(() => {
      void searchLocalFoodCatalog(db, query, query.trim() ? 8 : 3).then((rows) => {
        if (active) setFoods(rows);
      }).catch(() => {
        if (active) { setFoods([]); setError('Saved foods could not be loaded. You can still add food below.'); }
      }).finally(() => { if (active) setLoading(false); });
    }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [db, query]);
  const toggle = (id: string) => setSelectedIds((current) => current.includes(id)
    ? current.filter((value) => value !== id)
    : [...current, id]);
  const quickAdd = async (food: FoodCatalogItem) => {
    setSavingId(food.id); setError(null);
    try { await onQuickAdd(food); } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The food could not be added. Try again.');
    } finally { setSavingId(null); }
  };
  const multiAdd = async () => {
    const selected = foods.filter((food) => selectedIds.includes(food.id));
    if (!selected.length) return;
    setSavingId('multi'); setError(null);
    try { await onMultiAdd(selected); setSelectedIds([]); } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The selected foods could not be added. Try again.');
    } finally { setSavingId(null); }
  };
  return <Card>
    <Field label="Quick add" placeholder="Search saved foods" value={query} onChangeText={setQuery} returnKeyType="search" onSubmitEditing={() => onMore(query)} />
    {error ? <AppText accessibilityRole="alert" style={{ color: colors.danger }}>{error}</AppText> : null}
    {loading ? <AppText style={{ color: colors.textMuted }}>Finding saved foods…</AppText> : foods.length ? <>
      <AppText style={{ color: colors.textMuted }}>{query.trim() ? 'Your matches first' : 'Recent & frequent for this time of day'}</AppText>
      <View style={styles.suggestionList}>{foods.map((food) => {
        const selected = selectedIds.includes(food.id);
        return <View key={food.id} style={[styles.suggestionRow, { borderColor: colors.border }]}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={`Select ${food.name}`}
            accessibilityState={{ checked: selected }}
            onPress={() => toggle(food.id)}
            style={({ pressed }) => [styles.suggestionChoice, pressed && styles.pressed]}
          >
            <View style={[styles.check, { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accent : 'transparent' }]}>
              {selected ? <AppText style={{ color: colors.textOnAccent }}>✓</AppText> : null}
            </View>
            <View style={styles.suggestionCopy}>
              <AppText style={styles.suggestionName}>{food.name}{food.brand ? ` · ${food.brand}` : ''}</AppText>
              <AppText style={{ color: colors.textMuted }}>{food.servingQuantity} {food.servingUnit} · {Math.round(food.caloriesKcal)} kcal{food.isFromHistory ? ' · last logged portion' : ''}</AppText>
            </View>
          </Pressable>
          <View style={styles.suggestionActions}>
            <Button label={`Add ${food.name}`} accessibilityLabel={`Add ${food.name}`} variant="secondary"
              busy={savingId === food.id} disabled={savingId != null} onPress={() => void quickAdd(food)} />
            <Button label="Portion" accessibilityLabel={`Adjust ${food.name} portion`} variant="quiet"
              disabled={savingId != null} onPress={() => onSelect({ kind: 'catalog', food })} />
          </View>
        </View>;
      })}</View>
      {selectedIds.length ? <Button label={`Add ${selectedIds.length} selected food${selectedIds.length === 1 ? '' : 's'}`}
        busy={savingId === 'multi'} disabled={savingId != null} onPress={() => void multiAdd()} /> : null}
    </> : <AppText style={{ color: colors.textMuted }}>No saved matches. Search online or enter a new food.</AppText>}
    <Button label="More foods, barcode or photo" variant="secondary" onPress={() => onMore(query)} />
  </Card>;
}

/** Mount a fresh sheet per selection so portions and confirmation cannot leak between items. */
export function DailyFoodEntry({ selection, date, onClose, onSaved, onDetails }: {
  selection: FoodSelection; date: string; onClose: () => void; onSaved: (message: string) => void;
  onDetails: (mealId: string) => void;
}) {
  const db = useSQLiteContext();
  const { colors } = useJienTheme();
  const originalQuantity = selection.kind === 'logged' ? selection.food.quantity : selection.food.servingQuantity;
  const originalUnit = selection.kind === 'logged' ? selection.food.unit : selection.food.servingUnit;
  const [quantity, setQuantity] = useState(String(originalQuantity));
  const [unit, setUnit] = useState(originalUnit);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const valid = quantity.trim() !== '' && Number.isFinite(Number(quantity)) && Number(quantity) > 0 && originalQuantity > 0;
  const scale = valid ? servingScale(Number(quantity), unit, originalQuantity, originalUnit) ?? 0 : 0;
  const food = selection.food;
  const totals = {
    caloriesKcal: food.caloriesKcal * scale, proteinG: food.proteinG * scale,
    carbohydrateG: food.carbohydrateG * scale, fatG: food.fatG * scale,
    fibreG: food.fibreG == null ? null : food.fibreG * scale,
  };
  const useMultiplier = (multiplier: number) => {
    const next = multipliedPortion(originalQuantity, multiplier);
    if (next != null) { setUnit(originalUnit); setQuantity(String(next)); }
  };
  const changeUnit = (nextUnit: string) => {
    const converted = convertServingQuantity(Number(quantity), unit, nextUnit);
    setUnit(nextUnit);
    if (converted != null) setQuantity(String(Math.round(converted * 100) / 100));
  };
  const save = async (remove = false) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      if (selection.kind === 'logged') {
        if (remove) await removeDailyFoodItem(db, food.id);
        else await changeDailyFoodPortion(db, food.id, Number(quantity), unit);
      } else {
        if (!valid || Object.values(totals).some((value) => value != null && !Number.isFinite(value))) throw new Error('Enter a valid portion.');
        await saveMeal(db, {
          name: food.name, type: 'other', eatenAt: localTimestampForDate(date),
          items: [{ name: food.name, quantity: Number(quantity), unit, ...totals,
            source: food.source === 'starter' || food.source === 'custom' ? 'manual' : 'imported', confidence: null }],
        });
        // A cache failure must not turn a committed food into a duplicate on retry.
        void markFoodCatalogItemUsed(db, food.id).catch(() => undefined);
      }
      onSaved(remove ? `${food.name} removed.` : selection.kind === 'logged' ? 'Portion updated.' : `${food.name} added.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The food could not be saved. Try again.');
    } finally { lock.current = false; setBusy(false); }
  };
  return <Modal visible animationType="none" onRequestClose={() => { if (!busy) onClose(); }}>
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top', 'bottom']}>
      <Screen contentContainerStyle={styles.content}>
        <ScreenHeading title={selection.kind === 'logged' ? 'Edit portion' : 'Add food'} eyebrow={date}
          action={<Button label="Close" variant="quiet" disabled={busy} onPress={onClose} />} />
        <Card>
          <AppText style={styles.title}>{food.name}</AppText>
          {selection.kind === 'catalog' && selection.food.brand ? <AppText>{selection.food.brand}</AppText> : null}
          {selection.kind === 'catalog' ? <AppText style={{ color: colors.textMuted }}>{({
            starter: 'JIEN starter estimate', custom: 'Your saved food', community: 'JIEN community · unverified',
            usda_fdc: 'USDA FoodData Central · public domain', open_food_facts: 'Open Food Facts contributors · ODbL',
            fatsecret: 'FatSecret Platform', ai_photo: 'Photo estimate',
          })[selection.food.source]}</AppText> : null}
          <Field label="Portion" hint={unit} value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" editable={!busy} />
          <View style={styles.multiplierRow}>{servingUnitOptions(unit).map((option) => <Pill key={option}
            label={option} active={unit === option} onPress={() => changeUnit(option)} />)}</View>
          <View style={styles.multiplierRow}>
            {PORTION_MULTIPLIERS.map((multiplier) => <Button key={multiplier}
              label={multiplier === 0.5 ? '½×' : multiplier === 1.5 ? '1½×' : `${multiplier}×`}
              accessibilityLabel={`${multiplier} times the saved portion`}
              onPress={() => useMultiplier(multiplier)} disabled={busy} variant="quiet" />)}
          </View>
          <AppText style={{ color: colors.textMuted }}>Calories and macros scale with the portion.</AppText>
          <AppText style={styles.title}>{Math.round(totals.caloriesKcal)} kcal</AppText>
          <AppText>P {round(totals.proteinG)} g · C {round(totals.carbohydrateG)} g · F {round(totals.fatG)} g</AppText>
          <AppText style={{ color: colors.textMuted }}>{(selection.kind === 'logged' ? selection.food.originalSource : food.source) === 'ai_photo' ? 'Photo estimate. Check the portion and ingredients. Not medical advice.'
            : selection.kind === 'catalog' ? (selection.food.isShared || selection.food.source === 'community' ? 'Community food · unverified. Check the serving and nutrition.' : 'Check the serving and nutrition before adding.') : 'Only this item will change. Other foods in the same entry stay unchanged.'}</AppText>
        </Card>
        {error ? <StatePanel title="Food not saved" body={error} /> : null}
        <Button label={selection.kind === 'logged' ? 'Save portion' : 'Add to day'} onPress={() => void save()} busy={busy} disabled={!valid || confirmRemove} />
        {selection.kind === 'logged' ? <>
          <Button label="Edit nutrition or view original entry" variant="quiet" disabled={busy} onPress={() => onDetails(selection.food.mealId)} />
          {confirmRemove ? <Card>
            <AppText>Remove {food.name} from this day? This removal will sync to your account.</AppText>
            <View style={styles.actions}>
              <Button label="Remove item" variant="danger" busy={busy} onPress={() => void save(true)} />
              <Button label="Keep item" variant="secondary" disabled={busy} onPress={() => setConfirmRemove(false)} />
            </View>
          </Card> : <Button label="Remove from day" variant="quiet" disabled={busy} onPress={() => setConfirmRemove(true)} />}
        </> : null}
      </Screen>
    </SafeAreaView>
  </Modal>;
}

function round(value: number) { return Math.round(value * 10) / 10; }
const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 700, alignSelf: 'center' },
  title: { ...typography.section, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  suggestionList: { gap: spacing.xs },
  suggestionRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.xs, gap: spacing.xs },
  suggestionChoice: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  suggestionCopy: { flex: 1, minWidth: 0 },
  suggestionName: { fontWeight: '700' },
  suggestionActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  check: { width: 24, height: 24, borderWidth: 1.5, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  multiplierRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pressed: { opacity: 0.68 },
});
