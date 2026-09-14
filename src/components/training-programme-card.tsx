import { View } from 'react-native';
import { AppText, Button, Card, ProgressBar } from './ui';
import type { getTrainingProgrammeProgress } from '@/lib/db/training-programme';
import { PROGRAMME_GOALS } from '@/lib/planning/training-programme';
import { spacing, typography, useJienTheme } from '@/theme';

export function TrainingProgrammeCard({ progress, onEdit, onPlan }: {
  progress: Awaited<ReturnType<typeof getTrainingProgrammeProgress>>;
  onEdit: () => void;
  onPlan: () => void;
}) {
  const { colors } = useJienTheme();
  if (!progress) return <Card>
    <AppText style={typography.section}>Choose your training targets</AppText>
    <AppText style={{ color: colors.textMuted }}>Set priority muscles and weekly targets. Your recent history stays a separate reference.</AppText>
    <Button label="Set training targets" onPress={onEdit} variant="secondary" />
  </Card>;
  const { programme, rows, completedSessions, focus } = progress;
  const remaining = rows.filter((row) => row.remaining > 0);
  return <Card>
    <AppText style={typography.section}>Your weekly targets</AppText>
    <AppText>{PROGRAMME_GOALS.find((goal) => goal.value === programme.goal)?.label} · {completedSessions} of {programme.sessionsPerWeek} sessions logged</AppText>
    <AppText style={{ color: colors.textMuted }}>Monday–Sunday · Targets you chose, not automatic progression.</AppText>
    {rows.map((row) => <View key={row.muscleGroup} style={{ gap: spacing.xxs }}>
      <AppText>{row.label}: {row.completed} / {row.weeklySetCredits} credits</AppText>
      <ProgressBar value={row.completed / row.weeklySetCredits} />
      <AppText style={{ color: colors.textMuted }}>{row.usual == null ? 'No previous full-week reference' : `Recent weekly average: ${Number(row.usual.toFixed(1))} credits (${progress.baselineWeekCount} weeks)`}{row.trainedRecently ? ' · Trained within 48 hours' : ''}</AppText>
    </View>)}
    <AppText>{!remaining.length ? 'Your selected targets are met. There is no automatic increase.'
      : focus.length ? `Next focus: ${focus.map((row) => row.label).join(', ')}. Routine options use these remaining targets and your equipment.`
        : 'The remaining priorities were trained within 48 hours. No target-based routine is highlighted.'}</AppText>
    <AppText style={{ color: colors.textMuted }}>Primary sets: 1 credit; supporting: 0.5. Failure and drop sets count; warm-ups do not. The 48-hour filter is a scheduling cue, not a recovery check.</AppText>
    <Button label={focus.length ? 'Plan from my targets' : 'Browse workout plans'} onPress={onPlan} variant="secondary" />
    <Button label="Edit training targets" onPress={onEdit} variant="quiet" />
  </Card>;
}
