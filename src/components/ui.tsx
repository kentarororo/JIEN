import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, PropsWithChildren, ReactNode, Ref } from 'react';
import { useState } from 'react';
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
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { radii, spacing, typography, useJienTheme } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export function AppText({ style, ...props }: TextProps) {
  const { colors } = useJienTheme();
  return <Text {...props} style={[styles.body, { color: colors.text }, style]} />;
}

export function Screen({
  children,
  contentContainerStyle,
  scrollViewRef,
}: PropsWithChildren<{ contentContainerStyle?: ViewProps['style']; scrollViewRef?: Ref<ScrollView> }>) {
  const { colors } = useJienTheme();
  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <ScrollView
        ref={scrollViewRef}
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
        <AppText role="heading" aria-level={1} style={styles.title}>{title}</AppText>
      </View>
      {action}
    </View>
  );
}

export function HeroPanel({
  eyebrow,
  title,
  body,
  children,
}: PropsWithChildren<{ eyebrow: string; title: string; body?: string }>) {
  const { colors } = useJienTheme();
  return (
    <View style={[styles.heroPanel, { backgroundColor: colors.accentSoft, borderColor: colors.border }]}>
      <View style={styles.heroCopy}>
        <AppText style={[styles.heroEyebrow, { color: colors.accent }]}>{eyebrow}</AppText>
        <AppText role="heading" aria-level={1} style={styles.heroTitle}>{title}</AppText>
        {body ? <AppText style={[styles.heroBody, { color: colors.textMuted }]}>{body}</AppText> : null}
      </View>
      {children ? <View style={styles.heroContent}>{children}</View> : null}
    </View>
  );
}

export function SectionHeading({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.sectionHeading}>
      <AppText role="heading" aria-level={2} style={styles.sectionTitle}>{title}</AppText>
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
  accessibilityLabel,
  expanded,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  expanded?: boolean;
  icon?: IconName;
}) {
  const { colors } = useJienTheme();
  const [focused, setFocused] = useState(false);
  const background = variant === 'primary' ? colors.accent : variant === 'danger' ? colors.dangerSoft : variant === 'secondary' ? colors.accentSoft : 'transparent';
  const foreground = variant === 'primary' ? colors.textOnAccent : variant === 'danger' ? colors.danger : colors.accent;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy, expanded }}
      disabled={disabled || busy}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, borderColor: variant === 'quiet' ? colors.border : background },
        focused && { borderColor: colors.accent, borderWidth: 2 },
        pressed && styles.pressed,
        (disabled || busy) && styles.disabled,
      ]}
    >
      <View style={[styles.buttonContent, busy && styles.busyContent]}>
        {icon ? <Ionicons name={icon} size={18} color={foreground} /> : null}
        <AppText style={[styles.buttonLabel, { color: foreground }]}>{label}</AppText>
      </View>
      {busy ? <ActivityIndicator color={foreground} style={styles.busyIndicator} /> : null}
    </Pressable>
  );
}

export function Pill({
  label,
  active = false,
  onPress,
  accessibilityLabel,
  accessibilityRole = 'button',
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'radio';
}) {
  const { colors } = useJienTheme();
  const [focused, setFocused] = useState(false);
  const content = <AppText style={[styles.pillLabel, { color: active ? colors.textOnAccent : colors.text }]}>{label}</AppText>;
  if (!onPress) {
    return <View style={[styles.pill, { backgroundColor: active ? colors.accent : colors.surfaceMuted, borderColor: 'transparent' }]}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.pill, { backgroundColor: active ? colors.accent : colors.surfaceMuted, borderColor: focused ? colors.accent : 'transparent' }, focused && styles.focusedControl, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

export function ActionCard({
  title,
  detail,
  icon,
  onPress,
  tone = 'default',
}: {
  title: string;
  detail: string;
  icon: IconName;
  onPress: () => void;
  tone?: 'default' | 'accent';
}) {
  const { colors } = useJienTheme();
  const [focused, setFocused] = useState(false);
  const backgroundColor = tone === 'accent' ? colors.accent : colors.surface;
  const foregroundColor = tone === 'accent' ? colors.textOnAccent : colors.text;
  const secondaryColor = tone === 'accent' ? colors.textOnAccent : colors.textMuted;
  const focusColor = tone === 'accent' ? colors.textOnAccent : colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.actionCard,
        { backgroundColor, borderColor: focused ? focusColor : tone === 'accent' ? colors.accent : colors.border },
        focused && styles.focusedControl,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.actionIcon, { backgroundColor: tone === 'accent' ? colors.surfaceRaised : colors.accentSoft }]}>
        <Ionicons name={icon} size={22} color={colors.accent} />
      </View>
      <View style={styles.actionCopy}>
        <AppText style={[styles.actionTitle, { color: foregroundColor }]}>{title}</AppText>
        <AppText style={[styles.actionDetail, { color: secondaryColor }]}>{detail}</AppText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={secondaryColor} />
    </Pressable>
  );
}

export function ChoiceCard({
  title,
  body,
  selected,
  onPress,
}: {
  title: string;
  body?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useJienTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: selected ? colors.accentSoft : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
        },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.choiceCopy}>
        <AppText style={styles.choiceTitle}>{title}</AppText>
        {body ? <AppText style={[styles.choiceBody, { color: colors.textMuted }]}>{body}</AppText> : null}
      </View>
      <View style={[styles.choiceMark, { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accent : 'transparent' }]}>
        {selected ? <AppText style={[styles.choiceTick, { color: colors.textOnAccent }]}>✓</AppText> : null}
      </View>
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  containerStyle,
  ...props
}: TextInputProps & { label?: string; hint?: string; containerStyle?: StyleProp<ViewStyle> }) {
  const { colors } = useJienTheme();
  return (
    <View style={[styles.field, containerStyle]}>
      {label ? <AppText style={styles.fieldLabel}>{label}</AppText> : null}
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
  screenContent: { width: '100%', maxWidth: 1120, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.jumbo, gap: spacing.lg },
  body: { ...typography.body },
  headingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md },
  headingCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 220, gap: spacing.xxs },
  eyebrow: { ...typography.label, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  title: { ...typography.display, fontWeight: '700', letterSpacing: -0.7 },
  heroPanel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.sheet, padding: spacing.xl, gap: spacing.lg, overflow: 'hidden' },
  heroCopy: { maxWidth: 680, gap: spacing.xxs },
  heroEyebrow: { ...typography.label, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase' },
  heroTitle: { ...typography.display, fontWeight: '700', letterSpacing: -0.9 },
  heroBody: { ...typography.bodyLarge, maxWidth: 600 },
  heroContent: { gap: spacing.md },
  sectionHeading: { gap: 2 },
  sectionTitle: { ...typography.section, fontWeight: '700' },
  muted: { ...typography.label, opacity: 0.7 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.md, gap: spacing.sm },
  button: { minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radii.control, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  buttonLabel: { fontWeight: '700' },
  busyContent: { opacity: 0 },
  busyIndicator: { position: 'absolute' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.48 },
  pill: { minHeight: 44, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  pillLabel: { ...typography.label, fontWeight: '600' },
  focusedControl: { borderWidth: 2 },
  actionCard: { flex: 1, minWidth: 220, minHeight: 84, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actionIcon: { width: 44, height: 44, borderRadius: radii.control, alignItems: 'center', justifyContent: 'center' },
  actionCopy: { flex: 1, minWidth: 0, gap: 1 },
  actionTitle: { ...typography.bodyLarge, fontWeight: '700' },
  actionDetail: { ...typography.label },
  choice: { minHeight: 72, borderWidth: 1, borderRadius: radii.card, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  choiceCopy: { flex: 1, gap: spacing.xxs },
  choiceTitle: { ...typography.bodyLarge, fontWeight: '700' },
  choiceBody: { ...typography.label },
  choiceMark: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  choiceTick: { ...typography.caption, fontWeight: '700' },
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
