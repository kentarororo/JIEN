import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Pill } from '@/components/ui';
import type { SessionApproach, WorkoutSet } from '@/lib/db';
import { recommendNextSession, SESSION_REVIEW_OPTIONS, type SessionReviewFeedback } from '@/lib/planning/next-session-recommendation';
import { sessionApproachTitle } from '@/lib/planning/session-approach';
import { spacing, useJienTheme } from '@/theme';

export function NextSessionReview({ sets, startedAt, completedAt, jointFlag, selected, onSelect }: {
  sets: WorkoutSet[];
  startedAt: string | null;
  completedAt: string | null;
  jointFlag: boolean;
  selected: SessionApproach | null;
  onSelect: (approach: SessionApproach) => void;
}) {
  const { colors } = useJienTheme();
  const [feedback, setFeedback] = useState<SessionReviewFeedback>('unsure');
  useFocusEffect(useCallback(() => () => setFeedback('unsure'), []));
  const recommendation = recommendNextSession({ sets, startedAt, completedAt, jointFlag, feedback, now: new Date() });
  const approach = recommendation.approach;
  return (
    <View style={styles.review}>
      <AppText style={styles.title}>Session check-in (optional)</AppText>
      <View accessibilityRole="radiogroup" accessibilityLabel="Session check-in" style={styles.options}>
        {SESSION_REVIEW_OPTIONS.map((option) => (
          <Pill key={option.id} label={option.label} active={feedback === option.id}
            accessibilityRole="radio" onPress={() => setFeedback(option.id)} />
        ))}
      </View>
      <View accessibilityLiveRegion="polite" style={styles.review}>
        <AppText style={[styles.title, { color: colors.accent }]}>{approach ? `Suggested: ${sessionApproachTitle(approach)}` : 'More information needed'}</AppText>
        <AppText>{recommendation.reason}</AppText>
        {selected && approach && selected !== approach ? (
          <AppText style={{ color: colors.textMuted }}>Your choice is still {sessionApproachTitle(selected)}. Changing feedback does not change it.</AppText>
        ) : null}
      </View>
      {approach ? <Button label={`Use ${sessionApproachTitle(approach)} recommendation`}
        onPress={() => onSelect(approach)} variant="secondary" /> : null}
      <AppText style={{ color: colors.textMuted }}>Choose an approach below or use the suggestion. Only your chosen approach is saved with the plan; this check-in resets when you leave.</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  review: { gap: spacing.sm },
  title: { fontWeight: '700' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
