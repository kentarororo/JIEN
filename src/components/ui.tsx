import type { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  View,
  type ViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { radii, spacing, typography, useJienTheme } from '@/theme';

export function AppText({ style, ...props }: TextProps) {
  const { colors } = useJienTheme();
  return <Text {...props} style={[styles.body, { color: colors.text }, style]} />;
}

export function Screen({ children, contentContainerStyle }: PropsWithChildren<{ contentContainerStyle?: ViewProps['style'] }>) {
  const { colors } = useJienTheme();
  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentContainerStyle={[styles.screenContent, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function ScreenHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  const { colors } = useJienTheme();
  return (
    <View style={styles.headingRow}>
      <View style={styles.headingCopy}>
        {eyebrow ? <AppText style={[styles.eyebrow, { color: colors.accent }]}>{eyebrow}</AppText> : null}
        <AppText accessibilityRole="header" style={styles.title}>{title}</AppText>
      </View>
      {action}
    </View>
  );
}

export function SectionHeading({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.sectionHeading}>
      <AppText accessibilityRole="header" style={styles.sectionTitle}>{title}</AppText>
      {detail ? <AppText style={styles.muted}>{detail}</AppText> : null}
    </View>
  );
}

export function Card({ children, style, ...props }: ViewProps) {
  const { colors } = useJienTheme();
  return <View {...props} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  disabled?: boolean;
  busy?: boolean;
}) {
  const { colors } = useJienTheme();
  const background = variant === 'primary' ? colors.accent : variant === 'danger' ? colors.dangerSoft : variant === 'secondary' ? colors.accentSoft : 'transparent';
  const foreground = variant === 'primary' ? colors.textOnAccent : variant === 'danger' ? colors.danger : colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, borderColor: variant === 'quiet' ? colors.border : background },
        pressed && styles.pressed,
        (disabled || busy) && styles.disabled,
      ]}
    >
      {busy ? <ActivityIndicator color={foreground} /> : <AppText style={[styles.buttonLabel, { color: foreground }]}>{label}</AppText>}
    </Pressable>
  );
}

export function Pill({ label, active = false, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  const { colors } = useJienTheme();
  const content = <AppText style={[styles.pillLabel, { color: active ? colors.textOnAccent : colors.text }]}>{label}</AppText>;
  if (!onPress) {
    return <View style={[styles.pill, { backgroundColor: active ? colors.accent : colors.surfaceMuted }]}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, { backgroundColor: active ? colors.accent : colors.surfaceMuted }, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const { colors } = useJienTheme();
  return (
    <View style={styles.field}>
      <AppText style={styles.fieldLabel}>{label}</AppText>
      <TextInput
        {...props}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceRaised, borderColor: colors.border }, props.style]}
      />
      {hint ? <AppText style={styles.fieldHint}>{hint}</AppText> : null}
    </View>
  );
}

export function StatePanel({
  title,
  body,
  actionLabel,
  onAction,
  loading = false,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
}) {
  const { colors } = useJienTheme();
  return (
    <Card style={styles.statePanel}>
      {loading ? <ActivityIndicator color={colors.accent} /> : null}
      <AppText style={styles.stateTitle}>{title}</AppText>
      <AppText style={[styles.stateBody, { color: colors.textMuted }]}>{body}</AppText>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant="secondary" /> : null}
    </Card>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const { colors } = useJienTheme();
  return (
    <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
      <View style={[styles.fill, { backgroundColor: color ?? colors.wood, width: `${Math.max(0, Math.min(100, value * 100))}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  screenContent: { padding: spacing.lg, paddingBottom: spacing.jumbo, gap: spacing.lg },
  body: { ...typography.body },
  headingRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md },
  headingCopy: { flex: 1, gap: spacing.xxs },
  eyebrow: { ...typography.label, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  title: { ...typography.display, fontWeight: '700', letterSpacing: -0.7 },
  sectionHeading: { gap: 2 },
  sectionTitle: { ...typography.section, fontWeight: '700' },
  muted: { ...typography.label, opacity: 0.7 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.md, gap: spacing.sm },
  button: { minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radii.control, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { fontWeight: '700' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.48 },
  pill: { minHeight: 40, borderRadius: radii.pill, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  pillLabel: { ...typography.label, fontWeight: '600' },
  field: { gap: spacing.xs },
  fieldLabel: { ...typography.label, fontWeight: '700' },
  input: { minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, paddingHorizontal: spacing.md, ...typography.body },
  fieldHint: { ...typography.caption, opacity: 0.7 },
  statePanel: { alignItems: 'flex-start', paddingVertical: spacing.xl },
  stateTitle: { ...typography.bodyLarge, fontWeight: '700' },
  stateBody: { maxWidth: 480 },
  track: { height: 7, overflow: 'hidden', borderRadius: radii.pill },
  fill: { height: '100%', borderRadius: radii.pill },
});
