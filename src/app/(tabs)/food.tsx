import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, ProgressBar, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { DailyFoodEntry, DailyFoodQuickAdd, type FoodSelection } from '@/components/daily-food-entry';
import { reconcileMealGapNotification } from '@/lib/notifications';
import {
  discardQueuedMealPhoto,
  getDailyNutrition,
  listDailyFoodItems,
  getMealPhotoQueueSummary,
  processPendingMealPhotoJobs,
  retryQueuedMealPhotos,
  setNutritionDayState,
} from '@/lib/db';
import { historicalDateKey, shiftLocalDateKey, toLocalDateKey, formatTime } from '@/lib/time';
import {
  isPlausibleCompleteDay,
  MIN_PLAUSIBLE_COMPLETE_DAY_KCAL,
} from '@/lib/nutrition/adaptive-targets';
import { radii, spacing, typography, useJienTheme } from '@/theme';

function confirmNearEmptyDay(caloriesKcal: number): Promise<boolean> {
  if (isPlausibleCompleteDay(caloriesKcal)) return Promise.resolve(true);
  const message = `This day has ${Math.round(caloriesKcal).toLocaleString()} kcal logged. Complete days below ${MIN_PLAUSIBLE_COMPLETE_DAY_KCAL.toLocaleString()} kcal stay out of adaptive nutrition averages. Mark it complete anyway?`;
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm(message));
  return new Promise((resolve) => {
    Alert.alert(
      'Mark this day complete?',
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Mark complete', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function Macro({ label, value, target, color }: { label: string; value: number; target?: number; color?: string }) {
  const remaining = target == null ? null : target - value;
  return (
    <View style={styles.macro}>
      <View style={styles.row}><AppText>{label}</AppText><AppText style={styles.value}>{Math.round(value)}{target ? ` / ${Math.round(target)}` : ''} g</AppText></View>
      <ProgressBar value={target ? value / target : 0} color={color} />
      {remaining != null ? <AppText style={styles.remaining}>{remaining >= 0 ? `${Math.round(remaining)} g remaining` : `${Math.abs(Math.round(remaining))} g over`}</AppText> : null}
    </View>
  );
}

function MacroCalorieSplit({ protein, carbs, fat }: { protein: number; carbs: number; fat: number }) {
  const { colors } = useJienTheme();
  const values = [protein * 4, carbs * 4, fat * 9];
  const total = values.reduce((sum, value) => sum + value, 0);
  return (
    <View style={styles.splitSection}>
      <View style={styles.row}><AppText style={styles.value}>Macro calorie split</AppText><AppText style={{ color: colors.textMuted }}>P / C / F</AppText></View>
      <View accessibilityLabel="Macro calorie split" style={[styles.splitTrack, { backgroundColor: colors.surfaceMuted }]}>
        {total > 0 ? (
          <>
            <View style={{ flex: values[0], backgroundColor: colors.success }} />
            <View style={{ flex: values[1], backgroundColor: colors.wood }} />
            <View style={{ flex: values[2], backgroundColor: colors.warning }} />
          </>
        ) : null}
      </View>
    </View>
  );
}

function MacroSnapshot({ label, value }: { label: string; value: number }) {
  const { colors } = useJienTheme();
  return (
    <View style={[styles.macroSnapshot, { backgroundColor: colors.surfaceMuted }]}>
      <AppText style={[styles.snapshotLabel, { color: colors.textMuted }]}>{label}</AppText>
      <AppText style={styles.snapshotValue}>{Math.round(value)} g</AppText>
    </View>
  );
}

export default function FoodScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { date } = useLocalSearchParams<{ date?: string }>();
  const { colors } = useJienTheme();
  const todayKey = toLocalDateKey();
  const selectedDate = historicalDateKey(date, todayKey);
  const loader = useCallback(async () => {
    const [nutrition, photoQueue, items] = await Promise.all([
      getDailyNutrition(db, selectedDate),
      getMealPhotoQueueSummary(db),
      listDailyFoodItems(db, selectedDate),
    ]);
    return { nutrition, photoQueue, items };
  }, [db, selectedDate]);
  const { data, error, loading, reload } = useScreenData(loader);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const [showNutritionDetails, setShowNutritionDetails] = useState(false);
  const [selection, setSelection] = useState<FoodSelection | null>(null);
  const [foodMessage, setFoodMessage] = useState<string | null>(null);
  const [dayStateBusy, setDayStateBusy] = useState(false);
  const [dayStateError, setDayStateError] = useState<string | null>(null);
  const [dayStateMessage, setDayStateMessage] = useState<string | null>(null);
  const addFood = (query = '') => router.push({ pathname: '/meals/new', params: { date: selectedDate, query } });
  const nutrition = data?.nutrition.date === selectedDate ? data.nutrition : null;
  const openDate = (nextDate: string) => {
    setSelection(null);
    setFoodMessage(null);
    setDayStateError(null);
    setDayStateMessage(null);
    router.replace({ pathname: '/food', params: nextDate === todayKey ? {} : { date: nextDate } } as never);
  };

  const toggleDayState = async () => {
    if (!nutrition || nutrition.dayState === 'not_logged') return;
    const nextState = nutrition.dayState === 'complete' ? 'partial' : 'complete';
    if (nextState === 'complete' && !await confirmNearEmptyDay(nutrition.totals.caloriesKcal)) return;
    const qualifiesForAdaptiveAverages = isPlausibleCompleteDay(nutrition.totals.caloriesKcal);
    setDayStateBusy(true);
    setDayStateError(null);
    setDayStateMessage(null);
    try {
      await setNutritionDayState(db, selectedDate, nextState);
      setDayStateMessage(nextState === 'complete'
        ? qualifiesForAdaptiveAverages
          ? 'Day marked complete. Its calorie and protein totals now count in adaptive nutrition.'
          : `Day marked complete. Its totals stay out of adaptive nutrition averages because fewer than ${MIN_PLAUSIBLE_COMPLETE_DAY_KCAL.toLocaleString()} kcal are logged.`
        : 'Day marked partial. Its calorie and protein totals no longer count in adaptive nutrition.');
      await reload();
    } catch (cause) {
      setDayStateError(cause instanceof Error ? cause.message : 'The food day status could not be changed.');
    } finally {
      setDayStateBusy(false);
    }
  };

  const retryQueuedPhotos = async () => {
    setQueueBusy(true);
    setQueueMessage(null);
    try {
      await retryQueuedMealPhotos(db);
      const result = await processPendingMealPhotoJobs(db);
      setQueueMessage(result.state === 'completed'
        ? 'A queued photo is ready to review.'
        : result.state === 'action_required'
          ? 'Photo analysis still needs account, consent, or server configuration attention.'
          : 'The photo remains queued on this device and will retry when a connection is available.');
      await reload();
    } catch (cause) {
      setQueueMessage(cause instanceof Error ? cause.message : 'Queued photos could not be retried.');
    } finally {
      setQueueBusy(false);
    }
  };

  const discardFailedPhoto = async () => {
    const jobId = data?.photoQueue.latestFailedId;
    if (!jobId) return;
    setQueueBusy(true);
    try {
      await discardQueuedMealPhoto(db, jobId);
      setQueueMessage('The failed queued photo was removed from this device.');
      await reload();
    } finally {
      setQueueBusy(false);
    }
  };

  return (
    <Screen>
      <ScreenHeading
        title="Food"
        eyebrow={selectedDate === todayKey ? 'Today' : formatFoodDate(selectedDate)}
        action={<Button label="Add food" accessibilityLabel="Add food" icon="add-circle-outline" onPress={() => addFood()} />}
      />
      <Card style={[styles.dateNavigator, { backgroundColor: colors.surfaceMuted }]}>
        <View style={styles.dateNavigatorRow}>
          <Button label="‹" accessibilityLabel="Previous day" onPress={() => openDate(shiftLocalDateKey(selectedDate, -1))} variant="quiet" />
          <View style={styles.dateNavigatorLabel}>
            <AppText style={styles.mealName}>{selectedDate === todayKey ? 'Today' : formatFoodDate(selectedDate)}</AppText>
            <AppText style={{ color: colors.textMuted }}>{selectedDate}</AppText>
          </View>
          <Button label="›" accessibilityLabel="Next day" onPress={() => openDate(shiftLocalDateKey(selectedDate, 1))} disabled={selectedDate >= todayKey} variant="quiet" />
        </View>
        {selectedDate !== todayKey ? <Button label="Back to today" onPress={() => openDate(todayKey)} variant="secondary" /> : null}
      </Card>
      {loading && !data ? <StatePanel title="Loading food" body="Reading this day’s local log." loading /> : null}
      {error ? <StatePanel title="Food log unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /> : null}
      {loading && data && !nutrition ? <StatePanel title="Loading this day" body="Reading its food and macro totals." loading /> : null}
      {data && nutrition ? (
        <>
          {data.photoQueue.readyCount > 0 && data.photoQueue.latestReadyId ? (
            <Card style={{ backgroundColor: colors.successSoft, borderColor: colors.success }}>
              <AppText style={styles.mealName}>{data.photoQueue.readyCount} photo result{data.photoQueue.readyCount === 1 ? '' : 's'} ready</AppText>
              <AppText style={{ color: colors.textMuted }}>Open the latest estimate, then review and edit every item before saving.</AppText>
              <Button label="Review latest result" onPress={() => router.push({ pathname: '/meals/new', params: { photoJob: data.photoQueue.latestReadyId! } })} variant="secondary" />
            </Card>
          ) : null}
          {data.photoQueue.pendingCount > 0 ? (
            <Card style={{ backgroundColor: colors.accentSoft, borderColor: colors.accent }}>
              <AppText style={styles.mealName}>{data.photoQueue.pendingCount} meal photo{data.photoQueue.pendingCount === 1 ? '' : 's'} waiting</AppText>
              <AppText style={{ color: colors.textMuted }}>Stored on this device and processed after your signed-in connection is ready.</AppText>
            </Card>
          ) : null}
          {data.photoQueue.actionRequiredCount > 0 ? (
            <Card style={{ backgroundColor: colors.warningSoft, borderColor: colors.warning }}>
              <AppText style={styles.mealName}>Queued photo needs attention</AppText>
              <AppText>{data.photoQueue.latestFailureMessage ?? 'Check sign-in, AI consent, or the server configuration, then try again.'}</AppText>
              <View style={styles.actionRow}>
                <Button label="Try again" onPress={() => void retryQueuedPhotos()} busy={queueBusy} variant="secondary" />
                <Button label="Remove photo" onPress={() => void discardFailedPhoto()} disabled={queueBusy} variant="quiet" />
              </View>
            </Card>
          ) : null}
          {queueMessage ? <Card style={{ backgroundColor: colors.surfaceMuted }}><AppText>{queueMessage}</AppText></Card> : null}
          <Card>
            <View style={styles.calorieLine}>
              <View style={styles.calorieValue}><AppText style={[styles.kicker, { color: colors.textMuted }]}>CALORIES</AppText><AppText style={styles.calories}>{Math.round(nutrition.totals.caloriesKcal).toLocaleString()}</AppText></View>
              <AppText style={{ color: colors.textMuted }}>{nutrition.target ? `of ${Math.round(nutrition.target.caloriesKcal).toLocaleString()} kcal` : 'No target set'}</AppText>
            </View>
            <ProgressBar value={nutrition.target ? nutrition.totals.caloriesKcal / nutrition.target.caloriesKcal : 0} />
            {nutrition.target ? <AppText style={{ color: nutrition.totals.caloriesKcal > nutrition.target.caloriesKcal ? colors.warning : colors.textMuted }}>{nutrition.totals.caloriesKcal <= nutrition.target.caloriesKcal ? `${Math.round(nutrition.target.caloriesKcal - nutrition.totals.caloriesKcal).toLocaleString()} kcal below target` : `${Math.round(nutrition.totals.caloriesKcal - nutrition.target.caloriesKcal).toLocaleString()} kcal above target`}</AppText> : null}
            <View style={styles.macroSummary}>
              <MacroSnapshot label="Protein" value={nutrition.totals.proteinG} />
              <MacroSnapshot label="Carbs" value={nutrition.totals.carbohydrateG} />
              <MacroSnapshot label="Fat" value={nutrition.totals.fatG} />
            </View>
            <Button
              label={showNutritionDetails ? 'Hide nutrition details' : 'Nutrition details'}
              icon={showNutritionDetails ? 'chevron-up-outline' : 'chevron-down-outline'}
              onPress={() => setShowNutritionDetails((visible) => !visible)}
              expanded={showNutritionDetails}
              variant="quiet"
            />
            {showNutritionDetails ? (
              <View style={styles.nutritionDetails}>
                <Macro label="Protein" value={nutrition.totals.proteinG} target={nutrition.target?.proteinG} color={colors.success} />
                <Macro label="Carbs" value={nutrition.totals.carbohydrateG} target={nutrition.target?.carbohydrateG} color={colors.wood} />
                <Macro label="Fat" value={nutrition.totals.fatG} target={nutrition.target?.fatG} color={colors.warning} />
                <MacroCalorieSplit protein={nutrition.totals.proteinG} carbs={nutrition.totals.carbohydrateG} fat={nutrition.totals.fatG} />
                {nutrition.target ? <AppText style={{ color: colors.textMuted }}>Targets use your profile and goal. You can edit them at any time.</AppText> : null}
                <Button label={nutrition.target ? 'Edit macro targets' : 'Set macro targets'} onPress={() => router.push('/settings/macros')} variant="secondary" />
              </View>
            ) : null}
          </Card>

          <Card
            accessibilityLabel={`Food day status: ${nutrition.dayState === 'not_logged' ? 'Not logged' : nutrition.dayState === 'complete' ? 'Complete' : 'Partial'}`}
            style={{
              backgroundColor: nutrition.dayState === 'complete' ? colors.successSoft : colors.surface,
              borderColor: nutrition.dayState === 'complete' ? colors.success : colors.border,
            }}
          >
            <View style={styles.dayStateHeader}>
              <View style={styles.flex}>
                <AppText style={[styles.kicker, { color: colors.textMuted }]}>FOOD DAY STATUS</AppText>
                <AppText style={styles.mealName}>
                  {nutrition.dayState === 'not_logged' ? 'Not logged' : nutrition.dayState === 'complete' ? 'Complete' : 'Partial'}
                </AppText>
              </View>
              {nutrition.dayState !== 'not_logged' ? (
                <Button
                  label={nutrition.dayState === 'complete' ? 'Mark day partial' : 'Mark day complete'}
                  onPress={() => void toggleDayState()}
                  busy={dayStateBusy}
                  variant={nutrition.dayState === 'complete' ? 'secondary' : 'primary'}
                />
              ) : null}
            </View>
            <AppText style={{ color: colors.textMuted }}>
              {nutrition.dayState === 'not_logged'
                ? 'No food is recorded for this day. Adaptive nutrition treats the intake as unknown, not zero.'
                : nutrition.dayState === 'complete'
                  ? isPlausibleCompleteDay(nutrition.totals.caloriesKcal)
                    ? 'This day’s calorie and protein totals count in adaptive nutrition.'
                    : `This day is marked complete, but its totals stay out of adaptive nutrition averages until at least ${MIN_PLAUSIBLE_COMPLETE_DAY_KCAL.toLocaleString()} kcal are logged.`
                  : 'This day’s calorie and protein totals stay out of adaptive nutrition until the log is complete.'}
            </AppText>
            {dayStateMessage ? <AppText accessibilityLiveRegion="polite">{dayStateMessage}</AppText> : null}
            {dayStateError ? (
              <AppText accessibilityLiveRegion="assertive" style={{ color: colors.danger }}>
                {dayStateError} Try again.
              </AppText>
            ) : null}
          </Card>

          <DailyFoodQuickAdd key={selectedDate + data.items.length} onSelect={setSelection} onMore={addFood} />
          {foodMessage ? <AppText accessibilityLiveRegion="polite">{foodMessage}</AppText> : null}
          <SectionHeading title="Daily food log" detail={`${data.items.length} item${data.items.length === 1 ? '' : 's'} · Tap an item to adjust its portion`} />
          {data.items.length === 0 ? <StatePanel title="No food logged" body="Add foods as you go. No meal names or categories needed." actionLabel="Add your first food" onAction={() => addFood()} /> : null}
          <View style={styles.list}>
            {data.items.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item.name}, ${Math.round(item.caloriesKcal)} calories`}
                onPress={() => setSelection({ kind: 'logged', food: item })}
                style={({ pressed }) => [styles.mealPressable, pressed && styles.pressed]}
              >
                <Card>
                  <View style={styles.mealRow}>
                    <View style={styles.flex}><AppText style={styles.mealName}>{item.name}</AppText><AppText style={{ color: colors.textMuted }}>{Math.round(item.quantity * 100) / 100} {item.unit} · {formatTime(item.eatenAt)}</AppText></View>
                    <View style={styles.mealTotal}><AppText style={styles.value}>{Math.round(item.caloriesKcal)} kcal</AppText><Ionicons name="chevron-forward" size={18} color={colors.textMuted} /></View>
                  </View>
                  <AppText style={{ color: colors.textMuted }}>P {Math.round(item.proteinG)} g · C {Math.round(item.carbohydrateG)} g · F {Math.round(item.fatG)} g</AppText>
                </Card>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      {selection ? <DailyFoodEntry key={selection.kind + selection.food.id} selection={selection} date={selectedDate}
        onClose={() => setSelection(null)}
        onSaved={(message) => {
          setSelection(null); setFoodMessage(message); void reload();
          void reconcileMealGapNotification(db).catch(() => undefined);
        }}
        onDetails={(mealId) => { setSelection(null); router.push(`/meals/${mealId}` as Href); }} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  dateNavigator: { gap: spacing.xs },
  dateNavigatorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dateNavigatorLabel: { flex: 1, minWidth: 0, alignItems: 'center' },
  calorieLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md },
  calorieValue: { flexGrow: 1, flexShrink: 1, minWidth: 140 },
  kicker: { ...typography.caption, fontWeight: '700', letterSpacing: 0.7 },
  calories: { ...typography.display, fontWeight: '700' },
  macro: { gap: spacing.xs },
  remaining: { ...typography.caption, opacity: 0.7, textAlign: 'right' },
  splitSection: { gap: spacing.xs, marginTop: spacing.xs },
  splitTrack: { height: 12, borderRadius: radii.pill, overflow: 'hidden', flexDirection: 'row' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  dayStateHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  value: { fontWeight: '700' },
  flex: { flex: 1, minWidth: 0 },
  macroSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  macroSnapshot: { flexGrow: 1, flexBasis: 80, minWidth: 80, borderRadius: radii.control, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  snapshotLabel: { ...typography.caption, fontWeight: '600' },
  snapshotValue: { ...typography.bodyLarge, fontWeight: '700', fontVariant: ['tabular-nums'] },
  nutritionDetails: { gap: spacing.sm },
  list: { gap: spacing.sm },
  mealName: { ...typography.bodyLarge, fontWeight: '700' },
  mealPressable: { minHeight: 44 },
  mealRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  mealTotal: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pressed: { opacity: 0.68 },
});

function formatFoodDate(dateKey: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(`${dateKey}T12:00:00`));
}
