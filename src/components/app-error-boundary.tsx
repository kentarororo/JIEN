import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import { Appearance, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { classifyRuntimeDiagnostic } from '@/lib/db/runtime-diagnostic-code';
import { radii, spacing, themes, typography } from '@/theme/tokens';

type State = { error: Error | null };
type Props = PropsWithChildren<{
  scope?: 'startup' | 'runtime';
  onError?: (error: Error, info: ErrorInfo) => void;
}>;

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const code = classifyRuntimeDiagnostic(error);
    if (__DEV__) console.error('Unhandled application error', error, info.componentStack);
    else console.error(`Unhandled application error: ${code}`);
    try {
      this.props.onError?.(error, info);
    } catch {
      // Recovery reporting must never replace the original recovery screen.
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    const colors = Appearance.getColorScheme() === 'dark' ? themes.dark.colors : themes.light.colors;
    const startup = this.props.scope === 'startup';
    const code = classifyRuntimeDiagnostic(this.state.error);
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>{startup ? 'JIEN couldn’t start' : 'This screen stopped'}</Text>
          <Text style={[styles.body, { color: colors.textMuted }]}>{startup
            ? 'The app stopped before local records opened. No records were deleted. Close and reopen the app, then try again.'
            : 'Records already saved were not removed. Try the screen again. If the error returns, close and reopen the app.'}</Text>
          <Text selectable style={[styles.code, { color: colors.danger }]}>Recovery code: {code}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => this.setState({ error: null })}
            style={({ pressed }) => [styles.button, { backgroundColor: colors.accent }, pressed && styles.pressed]}
          >
            <Text style={[styles.buttonLabel, { color: colors.textOnAccent }]}>Try again</Text>
          </Pressable>
          {__DEV__ ? <Text selectable style={[styles.detail, { color: colors.danger }]}>{this.state.error.message}</Text> : null}
        </View>
      </SafeAreaView>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, justifyContent: 'center' },
  card: { width: '100%', maxWidth: 560, alignSelf: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.lg, gap: spacing.sm },
  title: { ...typography.section, fontWeight: '700' },
  body: { ...typography.body },
  code: { ...typography.label, fontWeight: '700' },
  detail: { ...typography.caption },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radii.control, paddingHorizontal: spacing.lg },
  buttonLabel: { ...typography.body, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
