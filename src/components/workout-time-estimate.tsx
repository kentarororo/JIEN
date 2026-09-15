import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Button, Card, Field, Pill } from '@/components/ui';
import type { PlannedWorkoutExercise, WorkoutTimeBudget } from '@/lib/db/types';
import { estimateSessionTime, type TimeEstimateFields } from '@/lib/planning/session-time';
import { spacing, typography, useJienTheme } from '@/theme';

export function WorkoutTimeSummary({ exercises, budget }: {
  exercises: PlannedWorkoutExercise[]; budget: WorkoutTimeBudget;
}) {
  const { colors } = useJienTheme();
  const estimate = estimateSessionTime(exercises, budget);
  return <View style={styles.stack}>
    <AppText style={styles.title}>Estimated {estimate.totalMinutes} min · {budget.availableMinutes} min available</AppText>
    <AppText style={{ color: colors.textMuted }}>{estimate.setCount} sets · {Math.round(estimate.workSeconds / 6) / 10} min lifting · {Math.round(estimate.restSeconds / 6) / 10} min between sets · {Math.round(estimate.transitionSeconds / 6) / 10} min between exercises · {estimate.warmUpSeconds / 60} min warm-up</AppText>
    {estimate.overByMinutes > 0 ? <AppText style={{ color: colors.warning }}>About {estimate.overByMinutes} min over your available time. Keep this plan or adjust it below.</AppText> : null}
    <AppText style={{ color: colors.textMuted }}>Estimate only. Warm-up includes preparation and warm-up sets. Between-exercise time includes rest, moving and setup. Equipment waits and interruptions can add time.</AppText>
  </View>;
}

export function WorkoutTimeEditor({ exercises, availableMinutes, onMinutesChange, fields, onFieldsChange, budget }: {
  exercises: PlannedWorkoutExercise[];
  availableMinutes: WorkoutTimeBudget['availableMinutes'];
  onMinutesChange: (minutes: WorkoutTimeBudget['availableMinutes']) => void;
  fields: TimeEstimateFields;
  onFieldsChange: (fields: TimeEstimateFields) => void;
  budget: WorkoutTimeBudget | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const { colors } = useJienTheme();
  return <Card>
    <AppText style={styles.title}>Session duration</AppText>
    <AppText style={{ color: colors.textMuted }}>Time available</AppText>
    <View style={styles.row}>
      {([30, 45, 60, 90] as const).map((minutes) => <Pill key={minutes} label={`${minutes} min`} active={minutes === availableMinutes} onPress={() => onMinutesChange(minutes)} />)}
    </View>
    {budget && exercises.length ? <WorkoutTimeSummary exercises={exercises} budget={budget} />
      : budget ? <AppText style={{ color: colors.textMuted }}>Add exercises to see the estimate. Changing available time never removes exercises.</AppText> : null}
    <Button label={expanded ? 'Hide time settings' : 'Edit time settings'} expanded={expanded} onPress={() => setExpanded(!expanded)} variant="quiet" />
    {expanded ? <View style={styles.stack}>
      <AppText style={{ color: colors.textMuted }}>These starting estimates are editable, not recommended rest times. They do not change the workout timer or record any work.</AppText>
      {([
        ['warmUpMinutes', 'Warm-up minutes', '0–30 minutes, including warm-up sets'],
        ['secondsPerSet', 'Seconds per set', '10–300 seconds, including both sides for unilateral work'],
        ['restSeconds', 'Rest between sets (seconds)', '0–600 seconds; no rest added after an exercise’s last set'],
        ['transitionSeconds', 'Between exercises (seconds)', '0–600 seconds for rest, moving and setup'],
      ] as const).map(([key, label, hint]) => <Field key={key} label={label} hint={hint} keyboardType="number-pad" value={fields[key]} onChangeText={(value) => onFieldsChange({ ...fields, [key]: value })} />)}
    </View> : null}
    {!budget ? <View accessibilityRole="alert"><AppText style={{ color: colors.danger }}>Enter whole numbers within the time settings’ ranges before saving.</AppText></View> : null}
  </Card>;
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  title: { ...typography.bodyLarge, fontWeight: '700' },
});
