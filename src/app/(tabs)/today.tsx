import { Link, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ActionCard, AppText, Button, Card, HeroPanel, Pill, ProgressBar, Screen, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { buildMonthGrid, calendarSelectionForDate, isRepeatedCalendarDayActivation, moveMonthSelection, type CalendarDayActivation } from '@/lib/calendar';
import { getDashboardSummary, listBodyMeasurementsForDate, listCalendarActivity, listMealsForDate, listPlannedWorkoutsForDate, listSleepLogsForDate, listWorkoutsForDate } from '@/lib/db';
import { muscleGroupLabel } from '@/lib/progression';
import { formatShortDate, formatTime, shiftLocalDateKey, toLocalDateKey } from '@/lib/time';
import { formatSleepDuration } from '@/lib/wellness/sleep-record';
import { radii, spacing, typography, useJienTheme } from '@/theme';

export default function TodayScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useJienTheme();
  const { width } = useWindowDimensions();
  const todayKey = toLocalDateKey();
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [monthExpanded, setMonthExpanded] = useState(false);
  const [dayWorkspaceOpen, setDayWorkspaceOpen] = useState(false);
  const lastDayActivation = useRef<CalendarDayActivation | null>(null);
  const cells = useMemo(() => buildMonthGrid(visibleMonth), [visibleMonth]);
  const weekCells = useMemo(() => {
    const selectedIndex = cells.findIndex((cell) => cell.dateKey === selectedDate);
    const weekStart = selectedIndex < 0 ? 0 : Math.floor(selectedIndex / 7) * 7;
    return cells.slice(weekStart, weekStart + 7);
  }, [cells, selectedDate]);
  const loader = useCallback(async () => {
    const rangeStart = cells[0]?.dateKey ?? todayKey;
    const rangeEnd = cells.at(-1)?.dateKey ?? todayKey;
    const [summary, activity, selectedWorkouts, selectedPlans, selectedMeals, selectedBodyMeasurements, selectedSleepLogs] = await Promise.all([
      getDashboardSummary(db),
      listCalendarActivity(db, rangeStart, rangeEnd),
      listWorkoutsForDate(db, selectedDate),
      listPlannedWorkoutsForDate(db, selectedDate),
      listMealsForDate(db, selectedDate),
      listBodyMeasurementsForDate(db, selectedDate),
      listSleepLogsForDate(db, selectedDate),
    ]);
    return { summary, activity, selectedWorkouts, selectedPlans, selectedMeals, selectedBodyMeasurements, selectedSleepLogs, selectedDate };
  }, [cells, db, selectedDate, todayKey]);
  const { data, error, loading, reload } = useScreenData(loader);

  if (loading && !data) return <Screen><StatePanel title="Opening your day" body="Loading your local training and nutrition log." loading /></Screen>;
  if (error || !data) return <Screen><StatePanel title="Today is unavailable" body={error ?? 'The summary could not be loaded.'} actionLabel="Try again" onAction={() => void reload()} /></Screen>;

  const summary = data.summary;
  const calorieTarget = summary.nutrition.target?.caloriesKcal ?? 0;
  const proteinTarget = summary.nutrition.target?.proteinG ?? 0;
  const activityByDate = new Map(data.activity.map((day) => [day.date, day]));
  const todayActivity = activityByDate.get(todayKey);
  const selectedActivity = activityByDate.get(selectedDate);
  const selectedWorkouts = data.selectedDate === selectedDate ? data.selectedWorkouts : [];
  const selectedPlans = data.selectedDate === selectedDate ? data.selectedPlans : [];
  const selectedMeals = data.selectedDate === selectedDate ? data.selectedMeals : [];
  const selectedBodyMeasurements = data.selectedDate === selectedDate ? data.selectedBodyMeasurements : [];
  const selectedSleepLogs = data.selectedDate === selectedDate ? data.selectedSleepLogs : [];
  const selectedDayLoading = loading && data.selectedDate !== selectedDate;
  const compactRecords = width < 700;
  const selectedInFuture = selectedDate > todayKey;
  const selectedInPast = selectedDate < todayKey;
  const changeMonth = (delta: number) => {
    const next = moveMonthSelection(visibleMonth, selectedDate, delta);
    setVisibleMonth(next.month);
    setSelectedDate(next.dateKey);
  };
  const changeCalendarPeriod = (delta: number) => {
    if (monthExpanded) {
      changeMonth(delta);
      return;
    }
    selectDate(shiftLocalDateKey(selectedDate, delta * 7));
  };
  const selectDate = (dateKey: string) => {
    const selection = calendarSelectionForDate(dateKey);
    if (!selection) return;
    setVisibleMonth(selection.month);
    setSelectedDate(selection.dateKey);
  };
  const activateDate = (dateKey: string) => {
    const nextActivation = { dateKey, activatedAt: Date.now() };
    const openWorkspace = isRepeatedCalendarDayActivation(lastDayActivation.current, nextActivation);
    lastDayActivation.current = nextActivation;
    selectDate(dateKey);
    if (openWorkspace) setDayWorkspaceOpen(true);
  };
  return (
    <Screen contentContainerStyle={compactRecords ? styles.screenCompact : undefined}>
      <HeroPanel
        eyebrow={new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}
        title="Today"
        body="Training, meals and recovery."
      >
        <View accessibilityLabel="Today summary" style={styles.heroStats}>
          <View style={[styles.heroStat, { backgroundColor: colors.surfaceRaised }]}>
            <AppText style={[styles.heroStatValue, { color: colors.accent }]}>{todayActivity?.workoutCount ?? 0}</AppText>
            <AppText style={styles.heroStatLabel}>Workouts</AppText>
            <AppText style={[styles.heroStatDetail, { color: colors.textMuted }]}>completed</AppText>
          </View>
          <View style={[styles.heroStat, { backgroundColor: colors.surfaceRaised }]}>
            <AppText style={[styles.heroStatValue, { color: colors.wood }]}>{summary.nutrition.meals.length}</AppText>
            <AppText style={styles.heroStatLabel}>Meals</AppText>
            <AppText style={[styles.heroStatDetail, { color: colors.textMuted }]}>logged</AppText>
          </View>
          <View style={[styles.heroStat, { backgroundColor: colors.surfaceRaised }]}>
            <AppText style={[styles.heroStatValue, { color: colors.success }]}>{todayActivity?.sleepLogCount ?? 0}</AppText>
            <AppText style={styles.heroStatLabel}>Sleep</AppText>
            <AppText style={[styles.heroStatDetail, { color: colors.textMuted }]}>entries</AppText>
          </View>
        </View>
        <View style={styles.actions}>
          <ActionCard tone="accent" title="Log workout" detail="Sets, reps and load" icon="barbell-outline" onPress={() => router.push('/workouts/new')} />
          <ActionCard title="Add meal" detail="Calories and macros" icon="restaurant-outline" onPress={() => router.push('/meals/new')} />
        </View>
      </HeroPanel>

      <SectionHeading title={monthExpanded ? 'Calendar' : 'Your week'} detail="Training, meals and wellness" />
      <Card style={[styles.calendarCard, compactRecords && styles.calendarCardCompact]}>
        <View style={styles.calendarHeader}>
          <Button label="‹" accessibilityLabel={monthExpanded ? 'Previous month' : 'Previous week'} onPress={() => changeCalendarPeriod(-1)} variant="quiet" />
          <View style={styles.calendarTitleWrap}>
            <AppText style={styles.calendarTitle}>{monthExpanded
              ? new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(visibleMonth)
              : formatWeekRange(weekCells)}</AppText>
            <Button label="Today" onPress={() => { const now = new Date(); setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelectedDate(todayKey); }} variant="quiet" />
          </View>
          <Button label="›" accessibilityLabel={monthExpanded ? 'Next month' : 'Next week'} onPress={() => changeCalendarPeriod(1)} variant="quiet" />
        </View>
        <View style={styles.calendarModeRow}>
          <Button icon={monthExpanded ? 'calendar-outline' : 'grid-outline'} label={monthExpanded ? 'Show week' : 'Show month'} onPress={() => setMonthExpanded((value) => !value)} variant="quiet" />
        </View>
        <View style={styles.weekRow}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <AppText key={`${day}-${index}`} style={[styles.weekday, { color: colors.textMuted }]}>{day}</AppText>)}</View>
        <View style={styles.monthGrid}>
          {(monthExpanded ? cells : weekCells).map((cell) => {
            const day = activityByDate.get(cell.dateKey);
            const selected = cell.dateKey === selectedDate;
            return (
              <Pressable
                key={cell.dateKey}
                accessibilityRole="button"
                accessibilityLabel={`${cell.date.toLocaleDateString()}${day ? `, ${day.workoutCount} completed workouts, ${day.plannedWorkoutCount} planned workouts, ${day.mealCount} meals, ${day.bodyMeasurementCount} body measurements, ${day.sleepLogCount} sleep logs` : ''}`}
                onPress={() => activateDate(cell.dateKey)}
                style={({ pressed }) => [
                  styles.dayCell,
                  !monthExpanded && styles.weekDayCell,
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
                  {day?.bodyMeasurementCount ? <View accessibilityLabel="Body measurement logged" style={[styles.dot, { backgroundColor: colors.warning }]} /> : null}
                  {day?.sleepLogCount ? <View accessibilityLabel="Sleep logged" style={[styles.dot, { backgroundColor: colors.textMuted }]} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        <View accessibilityLabel="Calendar activity legend" style={styles.calendarLegend}>
          <CalendarLegendItem color={colors.success} label="Workout" />
          <CalendarLegendItem color={colors.accent} label="Planned" />
          <CalendarLegendItem color={colors.wood} label="Food" />
          <CalendarLegendItem color={colors.warning} label="Body" />
          <CalendarLegendItem color={colors.textMuted} label="Sleep" />
        </View>
        <View style={[styles.dayWorkspacePrompt, { borderTopColor: colors.border }]}>
          <View style={styles.flex}>
            <AppText style={styles.value}>{new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${selectedDate}T12:00:00`))}</AppText>
            <AppText style={{ color: colors.textMuted }}>View logged and planned details</AppText>
          </View>
          <Button label="Open day" onPress={() => setDayWorkspaceOpen(true)} variant="secondary" />
        </View>
      </Card>

      <Modal visible={dayWorkspaceOpen} transparent animationType={compactRecords ? 'slide' : 'fade'} onRequestClose={() => setDayWorkspaceOpen(false)}>
        <View style={styles.dayWorkspaceOverlay}>
          <Pressable accessible={false} importantForAccessibility="no-hide-descendants" onPress={() => setDayWorkspaceOpen(false)} style={StyleSheet.absoluteFill} />
          <View role="dialog" accessibilityLabel="Day details" accessibilityViewIsModal style={[styles.dayWorkspaceSheet, compactRecords && styles.dayWorkspaceSheetCompact, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
            <ScrollView contentContainerStyle={styles.dayWorkspaceScroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.selectedDay, { backgroundColor: colors.surfaceMuted }]}>
          <View style={styles.workspaceTopBar}>
            <View style={styles.flex}><AppText style={styles.selectedDateTitle}>Day details</AppText><AppText style={{ color: colors.textMuted }}>Training, food and wellness</AppText></View>
            <Button label="Close" onPress={() => setDayWorkspaceOpen(false)} variant="quiet" />
          </View>
          <View style={styles.selectedDayNavigator}>
            <Button label="‹" accessibilityLabel="Previous day" onPress={() => selectDate(shiftLocalDateKey(selectedDate, -1))} variant="quiet" />
            <View style={styles.flex}>
              <AppText style={styles.selectedDateTitle}>{new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${selectedDate}T12:00:00`))}</AppText>
              <AppText style={{ color: colors.textMuted }}>{selectedDayLoading
                ? 'Loading this day’s records…'
                : selectedInFuture
                ? `${selectedPlans.length} planned workout${selectedPlans.length === 1 ? '' : 's'} · completed logs are limited to today or earlier.`
                : selectedActivity
                  ? `${selectedActivity.workoutCount} completed · ${selectedActivity.plannedWorkoutCount} planned · ${selectedActivity.workingSetCount} working sets · ${selectedActivity.mealCount} meals · ${selectedActivity.bodyMeasurementCount} body logs · ${selectedActivity.sleepLogCount} sleep logs · ${Math.round(selectedActivity.caloriesKcal)} kcal`
                  : 'No activity logged'}</AppText>
            </View>
            <Button label="›" accessibilityLabel="Next day" onPress={() => selectDate(shiftLocalDateKey(selectedDate, 1))} variant="quiet" />
          </View>
          <View style={styles.selectedDayHeader}>
            <View style={styles.selectedDayActions}>
              <View style={[styles.actionGroup, { backgroundColor: colors.surfaceRaised }]}>
                <AppText style={styles.actionGroupTitle}>Training</AppText>
                <View style={styles.actionGroupButtons}>
                  <Button icon="barbell-outline" label={selectedWorkouts.length ? 'Log another' : 'Log workout'} onPress={() => router.push({ pathname: '/workouts/new', params: { date: selectedDate } })} disabled={selectedInFuture} variant="secondary" />
                  <Button icon="calendar-outline" label={selectedPlans.length ? 'Plan another' : 'Plan workout'} onPress={() => router.push({ pathname: '/workouts/plan', params: { date: selectedDate } } as never)} disabled={selectedInPast} variant="quiet" />
                </View>
              </View>
              <View style={[styles.actionGroup, { backgroundColor: colors.surfaceRaised }]}>
                <AppText style={styles.actionGroupTitle}>Food</AppText>
                <Button icon="restaurant-outline" label={selectedActivity?.mealCount ? 'Add another meal' : 'Add meal'} onPress={() => router.push({ pathname: '/meals/new', params: { date: selectedDate } })} disabled={selectedInFuture} variant="secondary" />
              </View>
              <View style={[styles.actionGroup, { backgroundColor: colors.surfaceRaised }]}>
                <AppText style={styles.actionGroupTitle}>Wellness</AppText>
                <View style={styles.actionGroupButtons}>
                  <Button icon="body-outline" label={selectedBodyMeasurements.length ? 'Add body entry' : 'Log body'} onPress={() => router.push({ pathname: '/wellness/body', params: { date: selectedDate } } as never)} disabled={selectedInFuture} variant="quiet" />
                  <Button icon="moon-outline" label={selectedSleepLogs.length ? 'Add sleep entry' : 'Log sleep'} onPress={() => router.push({ pathname: '/wellness/sleep', params: { date: selectedDate } } as never)} disabled={selectedInFuture} variant="quiet" />
                </View>
              </View>
            </View>
          </View>
          {selectedDayLoading ? <View accessibilityLiveRegion="polite" style={styles.selectedLoading}><AppText style={{ color: colors.textMuted }}>Loading this day’s records…</AppText></View> : null}
          {selectedPlans.length ? <View style={styles.selectedRecords}><AppText style={styles.selectedRecordsTitle}>Planned workouts</AppText>{selectedPlans.map((workout) => (
            <Link key={workout.id} href={{ pathname: '/workouts/[id]', params: { id: workout.id } }} asChild>
              <Pressable style={({ pressed }) => [styles.selectedRecord, compactRecords && styles.selectedRecordCompact, { borderColor: colors.border, backgroundColor: colors.accentSoft }, pressed && styles.pressed]}>
                <View style={styles.flex}><AppText style={styles.value}>{workout.title}</AppText><AppText style={{ color: colors.textMuted }}>{workout.exerciseCount} exercise{workout.exerciseCount === 1 ? '' : 's'} · {workout.setCount} target sets</AppText>{workout.muscleGroups.length ? <View style={styles.workoutTags}>{workout.muscleGroups.slice(0, 4).map((group) => <Pill key={group} label={muscleGroupLabel(group)} />)}</View> : null}</View>
                <AppText style={{ color: colors.accent, fontWeight: '700' }}>{workout.scheduledAt ? formatTime(workout.scheduledAt) : 'Planned'}</AppText>
              </Pressable>
            </Link>
          ))}</View> : null}
          {selectedWorkouts.length ? <View style={styles.selectedRecords}><AppText style={styles.selectedRecordsTitle}>Logged workouts</AppText>{selectedWorkouts.map((workout) => (
            <Link key={workout.id} href={{ pathname: '/workouts/[id]', params: { id: workout.id } }} asChild>
              <Pressable style={({ pressed }) => [styles.selectedRecord, compactRecords && styles.selectedRecordCompact, { borderColor: colors.border }, pressed && styles.pressed]}>
                <View style={styles.flex}><AppText style={styles.value}>{workout.title}</AppText><AppText style={{ color: colors.textMuted }}>{workout.exerciseCount} exercise{workout.exerciseCount === 1 ? '' : 's'} · {workout.setCount} sets · {Math.round(workout.totalVolumeKg).toLocaleString()} kg·reps</AppText>{workout.muscleGroups.length ? <View style={styles.workoutTags}>{workout.muscleGroups.slice(0, 4).map((group) => <Pill key={group} label={muscleGroupLabel(group)} />)}</View> : null}</View>
                <View style={[styles.recordEnd, compactRecords && styles.recordEndCompact]}><AppText style={{ color: colors.textMuted }}>{workout.completedAt ? formatTime(workout.completedAt) : 'Completed'}</AppText><AppText style={{ color: colors.accent, fontWeight: '800' }}>Review · Edit</AppText></View>
              </Pressable>
            </Link>
          ))}</View> : null}
          {selectedMeals.length ? <View style={styles.selectedRecords}><AppText style={styles.selectedRecordsTitle}>Logged meals</AppText>{selectedMeals.map((meal) => (
            <Link key={meal.id} href={`/meals/${meal.id}` as Href} asChild>
              <Pressable style={({ pressed }) => [styles.selectedRecord, compactRecords && styles.selectedRecordCompact, { borderColor: colors.border }, pressed && styles.pressed]}>
                <View style={styles.flex}><AppText style={styles.value}>{meal.name}</AppText><AppText style={{ color: colors.textMuted }}>{meal.itemCount} item{meal.itemCount === 1 ? '' : 's'} · P {Math.round(meal.proteinG)} · C {Math.round(meal.carbohydrateG)} · F {Math.round(meal.fatG)}</AppText></View>
                <View style={[styles.recordEnd, compactRecords && styles.recordEndCompact]}><AppText style={styles.value}>{Math.round(meal.caloriesKcal)} kcal</AppText><AppText style={{ color: colors.textMuted }}>{formatTime(meal.eatenAt)}</AppText><AppText style={{ color: colors.accent, fontWeight: '800' }}>Review · Edit</AppText></View>
              </Pressable>
            </Link>
          ))}</View> : null}
          {selectedBodyMeasurements.length ? <View style={styles.selectedRecords}><AppText style={styles.selectedRecordsTitle}>Body measurements</AppText>{selectedBodyMeasurements.map((measurement) => (
            <View key={measurement.id} style={[styles.selectedRecord, compactRecords && styles.selectedRecordCompact, { borderColor: colors.border }]}>
              <View style={styles.flex}><AppText style={styles.value}>{measurement.bodyWeightKg.toFixed(1)} kg</AppText><AppText style={{ color: colors.textMuted }}>{measurement.heightCm} cm height</AppText></View>
              {measurement.bodyFatPercent != null ? <AppText style={{ color: colors.textMuted }}>{measurement.bodyFatPercent}% {measurement.bodyFatIsEstimated ? 'estimated' : 'measured'}</AppText> : null}
            </View>
          ))}</View> : null}
          {selectedSleepLogs.length ? <View style={styles.selectedRecords}><AppText style={styles.selectedRecordsTitle}>Sleep</AppText>{selectedSleepLogs.map((sleep) => (
            <Link key={sleep.id} href={{ pathname: '/wellness/sleep', params: { id: sleep.id, date: sleep.loggedOn } } as never} asChild>
              <Pressable style={({ pressed }) => [styles.selectedRecord, compactRecords && styles.selectedRecordCompact, { borderColor: colors.border }, pressed && styles.pressed]}>
                <View style={styles.flex}><AppText style={styles.value}>{formatSleepDuration(sleep.sleepDurationMinutes)}</AppText><AppText style={{ color: colors.textMuted }}>{sleep.sleepQualityScore == null ? 'Quality not rated' : `Quality ${sleep.sleepQualityScore}/5`}</AppText></View>
                <View style={[styles.recordEnd, compactRecords && styles.recordEndCompact]}><AppText style={{ color: colors.textMuted }}>{formatTime(sleep.loggedAt)}</AppText><AppText style={{ color: colors.accent, fontWeight: '800' }}>Review · Edit</AppText></View>
              </Pressable>
            </Link>
          ))}</View> : null}
          {!selectedDayLoading && !selectedPlans.length && !selectedWorkouts.length && !selectedMeals.length && !selectedBodyMeasurements.length && !selectedSleepLogs.length ? (
            <View style={[styles.emptySelectedDay, { borderColor: colors.border }]}>
              <AppText style={styles.value}>{selectedInFuture ? 'Nothing planned yet' : 'No logs on this day'}</AppText>
              <AppText style={{ color: colors.textMuted }}>{selectedInFuture ? 'Plan a workout above and it will appear here.' : 'Use the workout or meal actions above to add records for this day.'}</AppText>
            </View>
          ) : null}
        </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <SectionHeading title="This week" detail="Completed training" />
      <Card style={[styles.metricCard, { backgroundColor: colors.surfaceMuted }]}>
        <View style={styles.weekMetric}><AppText style={[styles.metric, { color: colors.accent }]}>{summary.workoutCountThisWeek}</AppText><AppText style={styles.weekMetricLabel}>Workouts</AppText><AppText style={{ color: colors.textMuted }}>completed</AppText></View>
        <View style={styles.weekMetric}><AppText style={styles.metric}>{Math.round(summary.weeklyVolumeKg).toLocaleString()}</AppText><AppText style={styles.weekMetricLabel}>kg·reps</AppText><AppText style={{ color: colors.textMuted }}>total work</AppText></View>
      </Card>

      {summary.workoutProgress ? (
        <Card style={[styles.progressCard, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
          <View style={styles.macroRow}>
            <View style={styles.flex}>
              <AppText style={[styles.kicker, { color: colors.accent }]}>WORKOUT PROGRESS</AppText>
              <AppText style={styles.progressMetric}>{summary.workoutProgress.overallChangePercent == null ? 'Baseline' : formatPercent(summary.workoutProgress.overallChangePercent)}</AppText>
            </View>
            <AppText style={{ color: colors.textMuted, textAlign: 'right' }}>{summary.workoutProgress.overallChangePercent == null ? 'comparison starts next session' : `${summary.workoutProgress.improvedExerciseCount}/${summary.workoutProgress.comparableExerciseCount} exercises up`}</AppText>
          </View>
          <AppText style={{ color: colors.textMuted }}>Compared with the previous session containing the same exercises.</AppText>
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
          <Button label="Log or review body trend" onPress={() => router.push('/wellness/body' as never)} variant="secondary" />
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
          <Pressable><Card><AppText style={styles.sessionTitle}>{summary.latestWorkout.title}</AppText><AppText style={{ color: colors.textMuted }}>{formatShortDate(summary.latestWorkout.completedAt ?? summary.latestWorkout.performedOn)} · {summary.latestWorkout.setCount} sets · {Math.round(summary.latestWorkout.totalVolumeKg).toLocaleString()} kg·reps</AppText></Card></Pressable>
        </Link>
      ) : <StatePanel title="No workouts logged" body="Log a completed workout to start progression comparisons." actionLabel="Log workout" onAction={() => router.push('/workouts/new')} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  heroStats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  heroStat: { flexGrow: 1, flexBasis: 104, minWidth: 96, borderRadius: radii.control, padding: spacing.sm },
  heroStatValue: { ...typography.title, fontWeight: '800', fontVariant: ['tabular-nums'] },
  heroStatLabel: { ...typography.label, fontWeight: '800' },
  heroStatDetail: { ...typography.caption },
  sessionTitle: { ...typography.bodyLarge, fontWeight: '700' },
  metricCard: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, padding: spacing.xs },
  weekMetric: { flexGrow: 1, flexBasis: 180, minHeight: 112, justifyContent: 'center', borderRadius: radii.control, padding: spacing.md },
  weekMetricLabel: { ...typography.label, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  metric: { ...typography.display, fontWeight: '700', fontVariant: ['tabular-nums'] },
  macroRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  value: { fontWeight: '700' },
  flex: { flex: 1 },
  kicker: { ...typography.caption, fontWeight: '800', letterSpacing: 0.6 },
  progressCard: { padding: spacing.lg },
  progressMetric: { ...typography.title, fontWeight: '800' },
  exerciseProgressList: { gap: spacing.xs, marginTop: spacing.xs },
  bodyCard: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', gap: spacing.lg },
  calendarCard: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: spacing.sm },
  screenCompact: { paddingHorizontal: spacing.md },
  calendarCardCompact: { paddingHorizontal: 0 },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calendarTitleWrap: { flex: 1, alignItems: 'center' },
  calendarTitle: { ...typography.bodyLarge, fontWeight: '800' },
  calendarModeRow: { flexDirection: 'row', justifyContent: 'center' },
  weekRow: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', ...typography.caption, fontWeight: '800' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: `${100 / 7}%`, aspectRatio: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.compact, gap: 2 },
  weekDayCell: { aspectRatio: undefined, minHeight: 68 },
  dayNumber: { ...typography.label },
  dayDots: { height: 5, flexDirection: 'row', gap: 3 },
  dot: { width: 5, height: 5, borderRadius: radii.pill },
  calendarLegend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  calendarLegendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  dayWorkspacePrompt: { minHeight: 64, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  dayWorkspaceOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.48)', padding: spacing.md, alignItems: 'center', justifyContent: 'center' },
  dayWorkspaceSheet: { width: '100%', maxWidth: 920, maxHeight: '92%', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.sheet, overflow: 'hidden' },
  dayWorkspaceSheetCompact: { maxHeight: '94%', marginTop: 'auto', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  dayWorkspaceScroll: { padding: spacing.md },
  workspaceTopBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  selectedDay: { padding: spacing.sm, borderRadius: radii.control, gap: spacing.sm },
  selectedDayNavigator: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  selectedDateTitle: { ...typography.bodyLarge, fontWeight: '800' },
  selectedDayHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  selectedDayActions: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actionGroup: { flexGrow: 1, flexBasis: 240, minWidth: 220, borderRadius: radii.control, padding: spacing.sm, gap: spacing.xs },
  actionGroupTitle: { ...typography.label, fontWeight: '800' },
  actionGroupButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  selectedLoading: { minHeight: 58, alignItems: 'center', justifyContent: 'center' },
  selectedRecords: { gap: spacing.xs },
  selectedRecordsTitle: { ...typography.label, fontWeight: '800' },
  selectedRecord: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm },
  selectedRecordCompact: { alignItems: 'stretch', flexDirection: 'column' },
  workoutTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  recordEnd: { alignItems: 'flex-end' },
  recordEndCompact: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  emptySelectedDay: { minHeight: 84, justifyContent: 'center', gap: spacing.xxs, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm },
  todayMeals: { gap: spacing.xs, marginTop: spacing.xs },
  todayMeal: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm },
  pressed: { opacity: 0.68 },
});

function formatPercent(value: number): string {
  const rounded = Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${value > 0 ? '+' : ''}${rounded}%`;
}

function CalendarLegendItem({ color, label }: { color: string; label: string }) {
  return <View style={styles.calendarLegendItem}><View style={[styles.dot, { backgroundColor: color }]} /><AppText>{label}</AppText></View>;
}

function formatWeekRange(cells: ReturnType<typeof buildMonthGrid>): string {
  const first = cells[0]?.date;
  const last = cells.at(-1)?.date;
  if (!first || !last) return 'This week';
  const firstLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(first);
  const lastLabel = new Intl.DateTimeFormat(undefined, {
    month: first.getMonth() === last.getMonth() ? undefined : 'short',
    day: 'numeric',
  }).format(last);
  return `${firstLabel}–${lastLabel}`;
}
