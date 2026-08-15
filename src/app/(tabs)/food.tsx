import { useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, ProgressBar, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import {
  discardQueuedMealPhoto,
  getDailyNutrition,
  getMealPhotoQueueSummary,
  processPendingMealPhotoJobs,
  retryQueuedMealPhotos,
} from '@/lib/db';
import { formatTime } from '@/lib/time';
import { spacing, typography, useJienTheme } from '@/theme';

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

export default function FoodScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const loader = useCallback(async () => {
    const [nutrition, photoQueue] = await Promise.all([
      getDailyNutrition(db),
      getMealPhotoQueueSummary(db),
    ]);
    return { nutrition, photoQueue };
  }, [db]);
  const { data, error, loading, reload } = useScreenData(loader);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const nutrition = data?.nutrition;

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
          : 'The photo remains safely queued and will retry when the connection is ready.');
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
      <ScreenHeading title="Food" eyebrow="Today" action={<Button label="Add" onPress={() => router.push('/meals/new')} />} />
      {loading && !data ? <StatePanel title="Loading meals" body="Reading today’s local log." loading /> : null}
      {error ? <StatePanel title="Meals are unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /> : null}
      {data && nutrition ? (
        <>
          {data.photoQueue.readyCount > 0 && data.photoQueue.latestReadyId ? (
            <Card style={{ backgroundColor: colors.successSoft, borderColor: colors.success }}>
              <AppText style={styles.mealName}>{data.photoQueue.readyCount} photo result{data.photoQueue.readyCount === 1 ? '' : 's'} ready</AppText>
              <AppText style={{ color: colors.textMuted }}>Open the latest estimate, then review and edit every item before saving.</AppText>
              <Button label="Review latest result" onPress={() => router.push({ pathname: '/meals/new', params: { photoJob: data.photoQueue.latestReadyId! } })} />
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
              <View style={styles.row}>
                <Button label="Try again" onPress={() => void retryQueuedPhotos()} busy={queueBusy} variant="secondary" />
                <Button label="Remove photo" onPress={() => void discardFailedPhoto()} disabled={queueBusy} variant="quiet" />
              </View>
            </Card>
          ) : null}
          {queueMessage ? <Card style={{ backgroundColor: colors.surfaceMuted }}><AppText>{queueMessage}</AppText></Card> : null}
          <Card>
            <View style={styles.calorieLine}>
              <View><AppText style={[styles.kicker, { color: colors.textMuted }]}>CALORIES</AppText><AppText style={styles.calories}>{Math.round(nutrition.totals.caloriesKcal).toLocaleString()}</AppText></View>
              <AppText style={{ color: colors.textMuted }}>{nutrition.target ? `of ${Math.round(nutrition.target.caloriesKcal).toLocaleString()} kcal` : 'No target set'}</AppText>
            </View>
            <ProgressBar value={nutrition.target ? nutrition.totals.caloriesKcal / nutrition.target.caloriesKcal : 0} />
            {nutrition.target ? <AppText style={{ color: nutrition.totals.caloriesKcal > nutrition.target.caloriesKcal ? colors.warning : colors.textMuted }}>{nutrition.totals.caloriesKcal <= nutrition.target.caloriesKcal ? `${Math.round(nutrition.target.caloriesKcal - nutrition.totals.caloriesKcal).toLocaleString()} kcal remaining today` : `${Math.round(nutrition.totals.caloriesKcal - nutrition.target.caloriesKcal).toLocaleString()} kcal over today`}</AppText> : null}
            <Macro label="Protein" value={nutrition.totals.proteinG} target={nutrition.target?.proteinG} color={colors.success} />
            <Macro label="Carbs" value={nutrition.totals.carbohydrateG} target={nutrition.target?.carbohydrateG} color={colors.wood} />
            <Macro label="Fat" value={nutrition.totals.fatG} target={nutrition.target?.fatG} color={colors.warning} />
            <MacroCalorieSplit protein={nutrition.totals.proteinG} carbs={nutrition.totals.carbohydrateG} fat={nutrition.totals.fatG} />
            {nutrition.target ? <AppText style={{ color: colors.textMuted }}>Starting targets are calculated from your onboarding weight and goal, then remain fully editable.</AppText> : null}
            <Button label={nutrition.target ? 'Edit macro targets' : 'Set macro targets'} onPress={() => router.push('/settings/macros')} variant="secondary" />
          </Card>

          <SectionHeading title="Meals" detail={`${nutrition.meals.length} logged`} />
          {nutrition.meals.length === 0 ? <StatePanel title="No meals logged" body="Add the food and portions you know. Exact is useful, but consistent estimates count too." actionLabel="Log a meal" onAction={() => router.push('/meals/new')} /> : null}
          <View style={styles.list}>
            {nutrition.meals.map((meal) => (
              <Pressable
                key={meal.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${meal.name}, ${Math.round(meal.caloriesKcal)} calories`}
                onPress={() => router.push(`/meals/${meal.id}` as Href)}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Card>
                  <View style={styles.row}><View style={styles.flex}><AppText style={styles.mealName}>{meal.name}</AppText><AppText style={{ color: colors.textMuted }}>{meal.type ?? 'meal'} · {formatTime(meal.eatenAt)}</AppText></View><AppText style={styles.value}>{Math.round(meal.caloriesKcal)} kcal</AppText></View>
                  <AppText style={{ color: colors.textMuted }}>P {Math.round(meal.proteinG)} · C {Math.round(meal.carbohydrateG)} · F {Math.round(meal.fatG)}</AppText>
                </Card>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  calorieLine: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md },
  kicker: { ...typography.caption, fontWeight: '700', letterSpacing: 0.7 },
  calories: { ...typography.display, fontWeight: '700' },
  macro: { gap: spacing.xs },
  remaining: { ...typography.caption, opacity: 0.7, textAlign: 'right' },
  splitSection: { gap: spacing.xs, marginTop: spacing.xs },
  splitTrack: { height: 12, borderRadius: 999, overflow: 'hidden', flexDirection: 'row' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  value: { fontWeight: '700' },
  flex: { flex: 1 },
  list: { gap: spacing.sm },
  mealName: { ...typography.bodyLarge, fontWeight: '700' },
  pressed: { opacity: 0.68 },
});
