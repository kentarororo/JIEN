import { View } from 'react-native';

import { AppText, Card, ChoiceCard } from '@/components/ui';
import { spacing, useJienTheme } from '@/theme';

export type JointProgressionChoice = 'hold' | 'continue';

export function JointProgressionChoicePanel({
  value,
  onChange,
}: {
  value: JointProgressionChoice;
  onChange: (value: JointProgressionChoice) => void;
}) {
  const { colors } = useJienTheme();
  const holding = value === 'hold';

  return (
    <Card style={{ backgroundColor: holding ? colors.warningSoft : colors.surfaceMuted, borderColor: holding ? colors.warning : colors.border }}>
      <AppText style={{ color: holding ? colors.warning : colors.text, fontWeight: '700' }}>Progression recommendation</AppText>
      <AppText style={{ color: colors.textMuted }}>
        {holding
          ? 'Hold load and rep increases while a joint or injury note is active.'
          : 'Normal progression suggestions are enabled for this session. Recorded set values remain unchanged.'}
      </AppText>
      <View accessibilityRole="radiogroup" accessibilityLabel="Joint progression choice" style={{ gap: spacing.xs }}>
        <ChoiceCard
          title="Hold progression"
          body="Recommended: keep previous values and withhold increase cues."
          selected={holding}
          onPress={() => onChange('hold')}
        />
        <ChoiceCard
          title="Continue progression"
          body="Show the usual rep and load suggestions for this session."
          selected={!holding}
          onPress={() => onChange('continue')}
        />
      </View>
      <AppText style={{ color: colors.textMuted }}>This changes suggestions only. Use your current clinician guidance and how you feel today.</AppText>
    </Card>
  );
}
