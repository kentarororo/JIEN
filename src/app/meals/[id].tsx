import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Field, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { deleteMeal, getMealDetail, updateMeal, type MealDetail, type MealItemSnapshot } from '@/lib/db';
import { calculateMealTotals, localMealTimestamp } from '@/lib/nutrition/meal-record';
import { formatTime } from '@/lib/time';
import { radii, spacing, typography, useJienTheme } from '@/theme';

type ItemDraft = {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  fibre: string;
  originalSource: MealItemSnapshot['originalSource'];
  isUserEdited: boolean;
};

type MealDraft = { name: string; date: string; time: string; items: ItemDraft[] };

export default function MealDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const loader = useCallback(() => getMealDetail(db, id), [db, id]);
  const { data: detail, error, loading, reload } = useScreenData(loader);
  const [draft, setDraft] = useState<MealDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const draftTotals = useMemo(() => calculateMealTotals((draft?.items ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    quantity: numeric(item.quantity),
    unit: item.unit,
    caloriesKcal: numeric(item.calories),
    proteinG: numeric(item.protein),
    carbohydrateG: numeric(item.carbs),
    fatG: numeric(item.fat),
    fibreG: item.fibre.trim() ? numeric(item.fibre) : null,
  }))), [draft]);

  const beginEdit = () => {
    if (!detail) return;
    setDraft(toDraft(detail));
    setFormError(null);
    setConfirmDelete(false);
  };

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      await updateMeal(db, id, {
        name: draft.name,
        eatenAt: localMealTimestamp(draft.date, draft.time),
        items: draft.items.map((item) => ({
          id: item.id,
          name: item.name,
          quantity: Number(item.quantity),
          unit: item.unit,
          caloriesKcal: Number(item.calories),
          proteinG: Number(item.protein),
          carbohydrateG: Number(item.carbs),
          fatG: Number(item.fat),
          fibreG: item.fibre.trim() ? Number(item.fibre) : null,
        })),
      });
      setDraft(null);
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'The meal could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    setFormError(null);
    try {
      await deleteMeal(db, id);
      router.replace('/food');
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'The meal could not be removed.');
      setDeleting(false);
    }
  };

  if (loading && !detail) return <Screen><StatePanel title="Loading meal" body="Reading this meal from your device." loading /></Screen>;
  if (error) return <Screen><StatePanel title="Meal unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /></Screen>;
  if (!detail) return <Screen><StatePanel title="Meal not found" body="It may have been removed from this device." actionLabel="Back to food" onAction={() => router.replace('/food')} /></Screen>;

  return (
    <Screen contentContainerStyle={styles.screenContent}>
      <ScreenHeading
        title={draft ? 'Edit meal' : detail.name}
        eyebrow={`${formatMealDate(detail.eatenOn)} · ${formatTime(detail.eatenAt)}`}
        action={draft ? undefined : <Button label="Edit" onPress={beginEdit} variant="secondary" />}
      />

      {draft ? (
        <>
          <Card>
            <Field label="Meal name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
            <View style={styles.fieldGrid}>
              <Field label="Date" hint="YYYY-MM-DD" value={draft.date} onChangeText={(date) => setDraft({ ...draft, date })} containerStyle={styles.headerField} autoCapitalize="none" />
              <Field label="Time" hint="24-hour HH:MM" value={draft.time} onChangeText={(time) => setDraft({ ...draft, time })} containerStyle={styles.headerField} keyboardType="numbers-and-punctuation" />
            </View>
          </Card>

          <SectionHeading title="Food snapshots" detail="Totals update as you edit" />
          {draft.items.map((item, index) => (
            <Card key={item.id}>
              <View style={styles.row}>
                <AppText style={styles.itemTitle}>Food {index + 1}</AppText>
                <AppText style={{ color: colors.textMuted }}>{provenanceLabel(item.originalSource, item.isUserEdited)}</AppText>
              </View>
              <Field label="Food" value={item.name} onChangeText={(name) => setDraft(updateDraftItem(draft, item.id, { name }))} />
              <View style={styles.fieldGrid}>
                <Field label="Quantity" value={item.quantity} onChangeText={(quantity) => setDraft(updateDraftItem(draft, item.id, { quantity }))} keyboardType="decimal-pad" containerStyle={styles.portionField} />
                <Field label="Unit" value={item.unit} onChangeText={(unit) => setDraft(updateDraftItem(draft, item.id, { unit }))} containerStyle={styles.portionField} />
              </View>
              <View style={styles.fieldGrid}>
                <Field label="Calories" value={item.calories} onChangeText={(calories) => setDraft(updateDraftItem(draft, item.id, { calories }))} keyboardType="decimal-pad" containerStyle={styles.macroField} />
                <Field label="Protein (g)" value={item.protein} onChangeText={(protein) => setDraft(updateDraftItem(draft, item.id, { protein }))} keyboardType="decimal-pad" containerStyle={styles.macroField} />
                <Field label="Carbs (g)" value={item.carbs} onChangeText={(carbs) => setDraft(updateDraftItem(draft, item.id, { carbs }))} keyboardType="decimal-pad" containerStyle={styles.macroField} />
                <Field label="Fat (g)" value={item.fat} onChangeText={(fat) => setDraft(updateDraftItem(draft, item.id, { fat }))} keyboardType="decimal-pad" containerStyle={styles.macroField} />
                <Field label="Fibre (g)" value={item.fibre} onChangeText={(fibre) => setDraft(updateDraftItem(draft, item.id, { fibre }))} keyboardType="decimal-pad" containerStyle={styles.macroField} />
              </View>
            </Card>
          ))}
          <MacroSummary totals={draftTotals} />
          {formError ? <View accessibilityRole="alert" style={[styles.message, { backgroundColor: colors.dangerSoft }]}><AppText style={{ color: colors.danger }}>{formError}</AppText></View> : null}
          <View style={styles.actions}>
            <Button label="Save changes" onPress={() => void save()} busy={saving} />
            <Button label="Cancel" onPress={() => { setDraft(null); setFormError(null); }} disabled={saving} variant="secondary" />
          </View>
        </>
      ) : (
        <>
          <MacroSummary totals={detail} />
          <SectionHeading title="Food items" detail={`${detail.itemCount} saved snapshot${detail.itemCount === 1 ? '' : 's'}`} />
          {detail.items.map((item) => (
            <Card key={item.id}>
              <View style={styles.row}>
                <View style={styles.flex}>
                  <AppText style={styles.itemTitle}>{item.name}</AppText>
                  <AppText style={{ color: colors.textMuted }}>{formatNumber(item.quantity)} {item.unit} · {provenanceLabel(item.originalSource, item.isUserEdited)}</AppText>
                </View>
                <AppText style={styles.value}>{Math.round(item.caloriesKcal)} kcal</AppText>
              </View>
              <AppText style={{ color: colors.textMuted }}>P {formatNumber(item.proteinG)} · C {formatNumber(item.carbohydrateG)} · F {formatNumber(item.fatG)}{item.fibreG != null ? ` · Fibre ${formatNumber(item.fibreG)}` : ''}</AppText>
            </Card>
          ))}
          {detail.notes ? <><SectionHeading title="Notes" /><Card><AppText>{detail.notes}</AppText></Card></> : null}
          <Card style={{ backgroundColor: colors.surfaceMuted }}>
            <AppText style={styles.itemTitle}>Recorded {formatMealDate(detail.eatenOn)} at {formatTime(detail.eatenAt)}</AppText>
            <AppText style={{ color: colors.textMuted }}>{sourceLabel(detail.source)}{detail.isUserEdited ? ' · saved values edited by you' : ''}. Viewing this record never changes its date.</AppText>
          </Card>
          <Card style={confirmDelete ? { backgroundColor: colors.dangerSoft, borderColor: colors.danger } : undefined}>
            {confirmDelete ? (
              <>
                <AppText style={styles.itemTitle}>Remove this meal?</AppText>
                <AppText style={{ color: colors.textMuted }}>It will disappear from Food, Today, Calendar, and daily macro totals. The removal will sync to your account.</AppText>
                {formError ? <AppText accessibilityRole="alert" style={{ color: colors.danger }}>{formError}</AppText> : null}
                <View style={styles.actions}>
                  <Button label="Remove meal" onPress={() => void remove()} busy={deleting} variant="danger" />
                  <Button label="Keep it" onPress={() => { setConfirmDelete(false); setFormError(null); }} disabled={deleting} variant="secondary" />
                </View>
              </>
            ) : <Button label="Remove this meal" onPress={() => setConfirmDelete(true)} variant="quiet" />}
          </Card>
        </>
      )}
    </Screen>
  );
}

function MacroSummary({ totals }: { totals: { caloriesKcal: number; proteinG: number; carbohydrateG: number; fatG: number; fibreG: number } }) {
  const { colors } = useJienTheme();
  return (
    <Card style={styles.summary}>
      <View><AppText style={styles.metric}>{Math.round(totals.caloriesKcal).toLocaleString()}</AppText><AppText style={{ color: colors.textMuted }}>kcal</AppText></View>
      <View><AppText style={styles.metric}>{formatNumber(totals.proteinG)}</AppText><AppText style={{ color: colors.textMuted }}>g protein</AppText></View>
      <View><AppText style={styles.metric}>{formatNumber(totals.carbohydrateG)}</AppText><AppText style={{ color: colors.textMuted }}>g carbs</AppText></View>
      <View><AppText style={styles.metric}>{formatNumber(totals.fatG)}</AppText><AppText style={{ color: colors.textMuted }}>g fat</AppText></View>
    </Card>
  );
}

function toDraft(meal: MealDetail): MealDraft {
  const localTime = new Date(meal.eatenAt);
  return {
    name: meal.name,
    date: meal.eatenOn,
    time: `${String(localTime.getHours()).padStart(2, '0')}:${String(localTime.getMinutes()).padStart(2, '0')}`,
    items: meal.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: String(item.quantity),
      unit: item.unit,
      calories: String(item.caloriesKcal),
      protein: String(item.proteinG),
      carbs: String(item.carbohydrateG),
      fat: String(item.fatG),
      fibre: item.fibreG == null ? '' : String(item.fibreG),
      originalSource: item.originalSource,
      isUserEdited: item.isUserEdited,
    })),
  };
}

function updateDraftItem(draft: MealDraft, id: string, patch: Partial<ItemDraft>): MealDraft {
  return { ...draft, items: draft.items.map((item) => item.id === id ? { ...item, ...patch } : item) };
}

function numeric(value: string): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function formatMealDate(dateKey: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(`${dateKey}T12:00:00`));
}

function sourceLabel(source: MealDetail['source']): string {
  if (source === 'ai_photo') return 'AI photo estimate';
  if (source === 'imported') return 'Database/imported snapshot';
  return 'Manual entry';
}

function provenanceLabel(source: MealItemSnapshot['originalSource'], edited: boolean): string {
  return `${sourceLabel(source)}${edited ? ' · edited' : ''}`;
}

const styles = StyleSheet.create({
  screenContent: { width: '100%', maxWidth: 900, alignSelf: 'center' },
  summary: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', gap: spacing.lg },
  metric: { ...typography.section, fontWeight: '800', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  itemTitle: { ...typography.bodyLarge, fontWeight: '700' },
  value: { fontWeight: '800', fontVariant: ['tabular-nums'] },
  flex: { flex: 1 },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  headerField: { flexGrow: 1, flexBasis: 220 },
  portionField: { flexGrow: 1, flexBasis: 180 },
  macroField: { flexGrow: 1, flexBasis: 130, minWidth: 112 },
  message: { padding: spacing.md, borderRadius: radii.control },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
