import { Link, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, ProgressBar, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { buildMonthGrid, moveMonthSelection } from '@/lib/calendar';
import { getDashboardSummary, listCalendarActivity, listMealsForDate, listPlannedWorkoutsForDate, listWorkoutsForDate } from '@/lib/db';
import { formatShortDate, formatTime, toLocalDateKey } from '@/lib/time';
import { radii, spacing, typography, useJienTheme } from '@/theme';

export default function TodayScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const todayKey = toLocalDateKey();
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const cells = useMemo(() => buildMonthGrid(visibleMonth), [visibleMonth]);
  const loader = useCallback(async () => {
    const rangeStart = cells[0]?.dateKey ?? todayKey;
    const rangeEnd = cells.at(-1)?.dateKey ?? todayKey;
    const [summary, activity, selectedWorkouts, selectedPlans, selectedMeals] = await Promise.all([
      getDashboardSummary(db),
      listCalendarActivity(db, rangeStart, rangeEnd),
      listWorkoutsForDate(db, selectedDate),
      listPlannedWorkoutsForDate(db, selectedDate),
      listMealsForDate(db, selectedDate),
    ]);
    return { summary, activity, selectedWorkouts, selectedPlans, selectedMeals, selectedDate };
  }, [cells, db, selectedDate, todayKey]);
  const { data, error, loading, reload } = useScreenData(loader);

  if (loading && !data) return <Screen><StatePanel title="Opening your day" body="Loading your local training and nutrition log." loading /></Screen>;
  if (error || !data) return <Screen><StatePanel title="Today is unavailable" body={error ?? 'The summary could not be loaded.'} actionLabel="Try again" onAction={() => void reload()} /></Screen>;

  const summary = data.summary;
  const calorieTarget = summary.nutrition.target?.caloriesKcal ?? 0;
  const proteinTarget = summary.nutrition.target?.proteinG ?? 0;
  const activityByDate = new Map(data.activity.map((day) => [day.date, day]));
  const selectedActivity = activityByDate.get(selectedDate);
  const selectedWorkouts = data.selectedDate === selectedDate ? data.selectedWorkouts : [];
  const selectedPlans = data.selectedDate === selectedDate ? data.selectedPlans : [];
  const selectedMeals = data.selectedDate === selectedDate ? data.selectedMeals : [];
  const selectedInFuture = selectedDate > todayKey;
  const selectedInPast = selectedDate < todayKey;
  const changeMonth = (delta: number) => {
    const next = moveMonthSelection(visibleMonth, selectedDate, delta);
    setVisibleMonth(next.month);
    setSelectedDate(next.dateKey);
  };
  return (
    <Screen>
      <ScreenHeading eyebrow={new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())} title="Keep the day honest." />

      <View style={styles.actions}>
        <Link href="/workouts/new" asChild><Pressable><Card style={styles.actionCard}><AppText style={styles.actionTitle}>Log a workout</AppText><AppText style={{ color: colors.textMuted }}>Sets, reps, load and effort</AppText></Card></Pressable></Link>
        <Link href="/meals/new" asChild><Pressable><Card style={styles.actionCard}><AppText style={styles.actionTitle}>Log a meal</AppText><AppText style={{ color: colors.textMuted }}>Calories and macros</AppText></Card></Pressable></Link>
      </View>

      <SectionHeading title="Calendar" detail="Training and food, together" />
      <Card style={styles.calendarCard}>
        <View style={styles.calendarHeader}>
          <Button label="‹" onPress={() => changeMonth(-1)} variant="quiet" />
          <View style={styles.calendarTitleWrap}>
            <AppText style={styles.calendarTitle}>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(visibleMonth)}</AppText>
            <Button label="Today" onPress={() => { const now = new Date(); setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelectedDate(todayKey); }} variant="quiet" />
          </View>
          <Button label="›" onPress={() => changeMonth(1)} variant="quiet" />
        </View>
        <View style={styles.weekRow}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <AppText key={`${day}-${index}`} style={[styles.weekday, { color: colors.textMuted }]}>{day}</AppText>)}</View>
        <View style={styles.monthGrid}>
          {cells.map((cell) => {
            const day = activityByDate.get(cell.dateKey);
            const selected = cell.dateKey === selectedDate;
            return (
              <Pressable
                key={cell.dateKey}
                accessibilityRole="button"
                accessibilityLabel={`${cell.date.toLocaleDateString()}${day ? `, ${day.workoutCount} completed workouts, ${day.plannedWorkoutCount} planned workouts, ${day.mealCount} meals` : ''}`}
                onPress={() => setSelectedDate(cell.dateKey)}
                style={({ pressed }) => [
                  styles.dayCell,
                  cell.isToday && { borderColor: colors.accent, borderWidth: 1 },
                  selected && { backgroundColor: colors.accentSoft },
                  pressed && styles.pressed,
                ]}
              >
                <AppText style={[styles.dayNumber, { color: cell.isCurrentMonth ? colors.text : colors.textMuted }, selected && { color: colors.accent, fontWeight: '800' }]}>{cell.dayNumber}</AppText>
                <View style={styles.dayDots}>
                  {day?.workoutCount ? <View accessibilityLabel="Workout logged" style={[styles.dot, { backgroundColor: colors.success }]} /> : null}
                  {day?.plannedWorkoutCount ? <View accessibilityLabel="Workout planned" style={[styles.dot, { backgroundColor: colors.accent }]} /> : null}
                  {day?.mealCount ? <View accessibilityLabel="Food logged" style={[styles.dot, { backgroundColor: colors.wood }]} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={[styles.selectedDay, { backgroundColor: colors.surfaceMuted }]}>
          <View style={styles.selectedDayHeader}>
            <View style={styles.flex}>
              <AppText style={styles.value}>{new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${selectedDate}T12:00:00`))}</AppText>
              <AppText style={{ color: colors.textMuted }}>{selectedInFuture
                ? `${selectedPlans.length} planned workout${selectedPlans.length === 1 ? '' : 's'} · completed logs stay on today or earlier.`
                : selectedActivity
                  ? `${selectedActivity.workoutCount} completed · ${selectedActivity.plannedWorkoutCount} planned · ${selectedActivity.workingSetCount} working sets · ${selectedActivity.mealCount} meals · ${Math.round(selectedActivity.caloriesKcal)} kcal`
                  : 'No activity logged'}</AppText>
            </View>
            <View style={styles.selectedDayActions}>
              <Button label={selectedWorkouts.length ? 'Log another workout' : 'Log workout'} onPress={() => router.push({ pathname: '/workouts/new', params: { date: selectedDate } })} disabled={selectedInFuture} variant="quiet" />
              <Button label={selectedPlans.length ? 'Plan another' : 'Plan workout'} onPress={() => router.push({ pathname: '/workouts/plan', params: { date: selectedDate } } as never)} disabled={selectedInPast} variant="quiet" />
              <Button label={selectedActivity?.mealCount ? 'Log another meal' : 'Log meal'} onPress={() => router.push({ pathname: '/meals/new', params: { date: selectedDate } })} disabled={selectedInFuture} variant="quiet" />
            </View>
          </View>
          {selectedPlans.length ? <View style={styles.selectedRecords}><AppText style={styles.selectedRecordsTitle}>Planned workouts</AppText>{selectedPlans.map((workout) => (
            <Link key={workout.id} href={{ pathname: '/workouts/[id]', params: { id: workout.id } }} asChild>
              <Pressable style={({ pressed }) => [styles.selectedRecord, { borderColor: colors.border, backgroundColor: colors.accentSoft }, pressed && styles.pressed]}>
                <View style={styles.flex}><AppText style={styles.value}>{workout.title}</AppText><AppText style={{ color: colors.textMuted }}>{workout.exerciseCount} exercise{workout.exerciseCount === 1 ? '' : 's'} · {workout.setCount} target sets</AppText></View>
                <AppText style={{ color: colors.accent, fontWeight: '700' }}>{workout.scheduledAt ? formatTime(workout.scheduledAt) : 'Planned'}</AppText>
              </Pressable>
            </Link>
          ))}</View> : null}
          {selectedWorkouts.length ? <View style={styles.selectedRecords}><AppText style={styles.selectedRecordsTitle}>Logged workouts</AppText>{selectedWorkouts.map((workout) => (
            <Link key={workout.id} href={{ pathname: '/workouts/[id]', params: { id: workout.id } }} asChild>
              <Pressable style={({ pressed }) => [styles.selectedRecord, { borderColor: colors.border }, pressed && styles.pressed]}>
                <View style={styles.flex}><AppText style={styles.value}>{workout.title}</AppText><AppText style={{ color: colors.textMuted }}>{workout.exerciseCount} exercise · {workout.setCount} sets · {Math.round(workout.totalVolumeKg).toLocaleString()} kg</AppText></View>
                <AppText style={{ color: colors.textMuted }}>{workout.completedAt ? formatTime(workout.completedAt) : 'Completed'}</AppText>
              </Pressable>
            </Link>
          ))}</View> : null}
          {selectedMeals.length ? <View style={styles.selectedRecords}><AppText style={styles.selectedRecordsTitle}>Logged meals</AppText>{selectedMeals.map((meal) => (
            <Link key={meal.id} href={`/meals/${meal.id}` as Href} asChild>
              <Pressable style={({ pressed }) => [styles.selectedRecord, { borderColor: colors.border }, pressed && styles.pressed]}>
                <View style={styles.flex}><AppText style={styles.value}>{meal.name}</AppText><AppText style={{ color: colors.textMuted }}>{meal.itemCount} item{meal.itemCount === 1 ? '' : 's'} · P {Math.round(meal.proteinG)} · C {Math.round(meal.carbohydrateG)} · F {Math.round(meal.fatG)}</AppText></View>
                <View style={styles.recordEnd}><AppText style={styles.value}>{Math.round(meal.caloriesKcal)} kcal</AppText><AppText style={{ color: colors.textMuted }}>{formatTime(meal.eatenAt)}</AppText></View>
              </Pressable>
            </Link>
          ))}</View> : null}
        </View>
      </Card>

      <SectionHeading title="This week" detail="Completed training" />
      <Card style={styles.metricCard}>
        <View><AppText style={styles.metric}>{summary.workoutCountThisWeek}</AppText><AppText style={{ color: colors.textMuted }}>workouts</AppText></View>
        <View><AppText style={styles.metric}>{Math.round(summary.weeklyVolumeKg).toLocaleString()}</AppText><AppText style={{ color: colors.textMuted }}>kg training work</AppText></View>
      </Card>

      {summary.workoutProgress ? (
        <Card style={[styles.progressCard, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
          <View style={styles.macroRow}>
            <View style={styles.flex}>
              <AppText style={[styles.kicker, { color: colors.accent }]}>PROGRESSIVE OVERLOAD</AppText>
              <AppText style={styles.progressMetric}>{summary.workoutProgress.overallChangePercent == null ? 'Baseline' : formatPercent(summary.workoutProgress.overallChangePercent)}</AppText>
            </View>
            <AppText style={{ color: colors.textMuted, textAlign: 'right' }}>{summary.workoutProgress.overallChangePercent == null ? 'comparison starts next session' : `${summary.workoutProgress.improvedExerciseCount}/${summary.workoutProgress.comparableExerciseCount} exercises up`}</AppText>
          </View>
          <AppText style={{ color: colors.textMuted }}>Work performed versus the previous matching session—not a strength or muscle-growth score.</AppText>
          <View style={styles.exerciseProgressList}>
            {summary.workoutProgress.exercises.slice(0, 4).map((exercise) => (
              <View key={exercise.exerciseId} style={styles.macroRow}>
                <AppText style={styles.flex}>{exercise.exerciseName}</AppText>
                <AppText style={{ color: exercise.changePercent == null ? colors.textMuted : exercise.changePercent >= 0 ? colors.success : colors.warning, fontWeight: '800' }}>{exercise.changePercent == null ? 'baseline' : formatPercent(exercise.changePercent)}</AppText>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {summary.latestBodyMeasurement ? (
        <>
          <SectionHeading title="Body baseline" detail="Latest wellness measurement" />
          <Card style={styles.bodyCard}>
            <View><AppText style={styles.metric}>{summary.latestBodyMeasurement.bodyWeightKg}</AppText><AppText style={{ color: colors.textMuted }}>kg weight</AppText></View>
            <View><AppText style={styles.metric}>{summary.latestBodyMeasurement.heightCm}</AppText><AppText style={{ color: colors.textMuted }}>cm height</AppText></View>
            {summary.latestBodyMeasurement.bodyFatPercent != null ? <View><AppText style={styles.metric}>{summary.latestBodyMeasurement.bodyFatPercent}%</AppText><AppText style={{ color: colors.textMuted }}>{summary.latestBodyMeasurement.bodyFatIsEstimated ? 'estimated' : 'measured'} body fat</AppText></View> : null}
          </Card>
        </>
      ) : null}

      <SectionHeading title="Today’s fuel" detail={summary.nutrition.meals.length === 0 ? 'Nothing logged yet' : `${summary.nutrition.meals.length} meals logged`} />
      <Card>
        <View style={styles.macroRow}><AppText>Calories</AppText><AppText style={styles.value}>{Math.round(summary.nutrition.totals.caloriesKcal)}{calorieTarget ? ` / ${Math.round(calorieTarget)}` : ''} kcal</AppText></View>
        <ProgressBar value={calorieTarget ? summary.nutrition.totals.caloriesKcal / calorieTarget : 0} />
        <View style={styles.macroRow}><AppText>Protein</AppText><AppText style={styles.value}>{Math.round(summary.nutrition.totals.proteinG)}{proteinTarget ? ` / ${Math.round(proteinTarget)}` : ''} g</AppText></View>
        <ProgressBar value={proteinTarget ? summary.nutrition.totals.proteinG / proteinTarget : 0} color={colors.success} />
        {!summary.nutrition.target ? <Button label="Set macro targets" onPress={() => router.push('/settings/macros')} variant="secondary" /> : null}
        {summary.nutrition.meals.length ? <View style={styles.todayMeals}>{summary.nutrition.meals.map((meal) => (
          <Link key={meal.id} href={`/meals/${meal.id}` as Href} asChild>
            <Pressable accessibilityLabel={`Open ${meal.name}`} style={({ pressed }) => [styles.todayMeal, { borderColor: colors.border }, pressed && styles.pressed]}>
              <View style={styles.flex}><AppText style={styles.value}>{meal.name}</AppText><AppText style={{ color: colors.textMuted }}>{formatTime(meal.eatenAt)} · {meal.itemCount} item{meal.itemCount === 1 ? '' : 's'}</AppText></View>
              <AppText style={styles.value}>{Math.round(meal.caloriesKcal)} kcal</AppText>
            </Pressable>
          </Link>
        ))}</View> : null}
      </Card>

      <SectionHeading title="Last session" />
      {summary.latestWorkout ? (
        <Link href={{ pathname: '/workouts/[id]', params: { id: summary.latestWorkout.id } }} asChild>
          <Pressable><Card><AppText style={styles.actionTitle}>{summary.latestWorkout.title}</AppText><AppText style={{ color: colors.textMuted }}>{formatShortDate(summary.latestWorkout.completedAt ?? summary.latestWorkout.performedOn)} · {summary.latestWorkout.setCount} sets · {Math.round(summary.latestWorkout.totalVolumeKg).toLocaleString()} kg</AppText></Card></Pressable>
        </Link>
      ) : <StatePanel title="Your first session starts here" body="Log the work you actually completed. JIEN will build progression guidance from it." actionLabel="Log workout" onAction={() => router.push('/workouts/new')} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: spacing.sm },
  actionCard: { flex: 1, minHeight: 110, justifyContent: 'space-between' },
  actionTitle: { ...typography.bodyLarge, fontWeight: '700' },
  metricCard: { flexDirection: 'row', justifyContent: 'space-around' },
  metric: { ...typography.title, fontWeight: '700' },
  macroRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  value: { fontWeight: '700' },
  flex: { flex: 1 },
  kicker: { ...typography.caption, fontWeight: '800', letterSpacing: 0.6 },
  progressCard: { padding: spacing.lg },
  progressMetric: { ...typography.title, fontWeight: '800' },
  exerciseProgressList: { gap: spacing.xs, marginTop: spacing.xs },
  bodyCard: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', gap: spacing.lg },
  calendarCard: { gap: spacing.sm },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calendarTitleWrap: { flex: 1, alignItems: 'center' },
  calendarTitle: { ...typography.bodyLarge, fontWeight: '800' },
  weekRow: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', ...typography.caption, fontWeight: '800' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: `${100 / 7}%`, aspectRatio: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.compact, gap: 2 },
  dayNumber: { ...typography.label },
  dayDots: { height: 5, flexDirection: 'row', gap: 3 },
  dot: { width: 5, height: 5, borderRadius: radii.pill },
  selectedDay: { padding: spacing.sm, borderRadius: radii.control, gap: spacing.sm },
  selectedDayHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  selectedDayActions: { flexDirection: 'row', flexWrap: 'wrap' },
  selectedRecords: { gap: spacing.xs },
  selectedRecordsTitle: { ...typography.label, fontWeight: '800' },
  selectedRecord: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm },
  recordEnd: { alignItems: 'flex-end' },
  todayMeals: { gap: spacing.xs, marginTop: spacing.xs },
  todayMeal: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm },
  pressed: { opacity: 0.68 },
});

function formatPercent(value: number): string {
  const rounded = Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${value > 0 ? '+' : ''}${rounded}%`;
}
