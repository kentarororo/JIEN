import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Button, Card, Screen, ScreenHeading, StatePanel } from '@/components/ui';
import { copyFoodHistoryToDay, getLatestFoodCopyMeal, listRecentFoodCopyDays, type FoodCopyDay, type FoodCopyMeal } from '@/lib/db';
import { useSQLiteContext } from '@/lib/db/database-context';
import { shiftLocalDateKey } from '@/lib/time';
import { spacing, useJienTheme } from '@/theme';

export function FoodCopyActions({ date, onCopied }: { date: string; onCopied: (message: string) => void }) {
  const db = useSQLiteContext();
  const { colors } = useJienTheme();
  const [days, setDays] = useState<FoodCopyDay[]>([]);
  const [previousMeal, setPreviousMeal] = useState<FoodCopyMeal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void Promise.all([listRecentFoodCopyDays(db, date), getLatestFoodCopyMeal(db, date)]).then(([rows, latestMeal]) => {
      if (!active) return;
      setDays(rows); setPreviousMeal(latestMeal);
      setSelectedDate((current) => current && rows.some((day) => day.date === current) ? current : rows[0]?.date ?? null);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Past food could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [date, db]);
  const yesterday = days.find((day) => day.date === shiftLocalDateKey(date, -1));
  const chosenDay = days.find((day) => day.date === selectedDate) ?? null;
  const selectedItems = useMemo(() => chosenDay?.items.filter((item) => selectedIds.includes(item.id)) ?? [], [chosenDay, selectedIds]);
  const copy = async (input: { sourceDate?: string; mealId?: string; itemIds?: string[] }, label: string) => {
    setBusy(true); setError(null);
    try {
      const count = await copyFoodHistoryToDay(db, { targetDate: date, ...input });
      onCopied(`${count} food${count === 1 ? '' : 's'} copied from ${label}.`);
      setOpen(false); setSelectedIds([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The food could not be copied. Try again.');
    } finally { setBusy(false); }
  };
  const chooseDay = (value: string) => { setSelectedDate(value); setSelectedIds([]); };
  const toggle = (id: string) => setSelectedIds((current) => current.includes(id)
    ? current.filter((value) => value !== id) : [...current, id]);

  return <Card>
    <View>
      <AppText style={styles.title}>Copy food</AppText>
      <AppText style={{ color: colors.textMuted }}>Reuse a meal, a whole day, or selected foods without re-entering portions.</AppText>
    </View>
    {loading ? <AppText style={{ color: colors.textMuted }}>Reading past food…</AppText> : null}
    {error ? <AppText accessibilityRole="alert" style={{ color: colors.danger }}>{error}</AppText> : null}
    {!loading && !days.length ? <AppText style={{ color: colors.textMuted }}>No earlier food is available to copy.</AppText> : null}
    <View style={styles.actions}>
      <Button label="Copy yesterday" onPress={() => yesterday && void copy({ sourceDate: yesterday.date }, 'yesterday')}
        busy={busy && Boolean(yesterday)} disabled={busy || !yesterday} variant="secondary" />
      <Button label="Copy previous meal" onPress={() => previousMeal && void copy({ mealId: previousMeal.id }, previousMeal.name)}
        disabled={busy || !previousMeal} variant="secondary" />
      <Button label="Choose past food" onPress={() => setOpen(true)} disabled={busy || !days.length} variant="quiet" />
    </View>
    <Modal visible={open} animationType="none" onRequestClose={() => { if (!busy) setOpen(false); }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top', 'bottom']}>
        <Screen>
          <ScreenHeading eyebrow={date} title="Copy past food" action={<Button label="Close" onPress={() => setOpen(false)} disabled={busy} variant="quiet" />} />
          <View style={styles.actions}>{days.map((day) => <Button key={day.date} label={`${day.date} · ${day.items.length} food${day.items.length === 1 ? '' : 's'}`}
            onPress={() => chooseDay(day.date)} variant={selectedDate === day.date ? 'primary' : 'secondary'} />)}</View>
          {chosenDay ? <Card>
            <AppText style={styles.title}>{chosenDay.date}</AppText>
            {chosenDay.items.map((item) => {
              const selected = selectedIds.includes(item.id);
              return <Pressable key={item.id} accessibilityRole="checkbox" accessibilityLabel={`Select ${item.name}`}
                accessibilityState={{ checked: selected }} onPress={() => toggle(item.id)}
                style={({ pressed }) => [styles.choice, { borderColor: colors.border }, pressed && styles.pressed]}>
                <View style={[styles.check, { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accent : 'transparent' }]}>
                  {selected ? <AppText style={{ color: colors.textOnAccent }}>✓</AppText> : null}
                </View>
                <View style={styles.flex}><AppText style={{ fontWeight: '700' }}>{item.name}</AppText><AppText style={{ color: colors.textMuted }}>{item.quantity} {item.unit} · {Math.round(item.caloriesKcal)} kcal</AppText></View>
              </Pressable>;
            })}
            <View style={styles.actions}>
              <Button label={`Copy full day · ${chosenDay.items.length} foods`} onPress={() => void copy({ sourceDate: chosenDay.date }, chosenDay.date)} busy={busy} />
              <Button label={`Copy selected · ${selectedItems.length}`} onPress={() => void copy({ itemIds: selectedIds }, 'selected foods')}
                disabled={busy || !selectedItems.length} variant="secondary" />
            </View>
          </Card> : <StatePanel title="No past day selected" body="Choose a day above." />}
        </Screen>
      </SafeAreaView>
    </Modal>
  </Card>;
}

const styles = StyleSheet.create({
  title: { fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  choice: { minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  check: { width: 24, height: 24, borderWidth: 1.5, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.68 },
});
