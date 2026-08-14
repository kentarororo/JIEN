import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';

import { completeOAuthSignIn } from '@/lib/auth';
import { buildCleanWebAppUrl, type OAuthCallbackRequest } from '@/lib/auth/oauth';
import { radii, resolveTheme, spacing, typography } from '@/theme/tokens';

export function OAuthCallbackCompletion({ request }: { request: OAuthCallbackRequest }) {
  const router = useRouter();
  const { colors, isDark } = resolveTheme(useColorScheme());
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        if (request.errorDescription) throw new Error(request.errorDescription);
        if (!request.code) throw new Error('Google did not return a sign-in code.');
        await completeOAuthSignIn(request.code);

        if (Platform.OS === 'web' && typeof globalThis.location !== 'undefined') {
          globalThis.location.replace(buildCleanWebAppUrl(
            globalThis.location.origin,
            process.env.EXPO_PUBLIC_BASE_URL,
          ));
          return;
        }
        router.replace('/');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Google sign-in could not finish.');
      }
    })();
  }, [request.code, request.errorDescription, router]);

  const leaveCallback = () => {
    if (Platform.OS === 'web' && typeof globalThis.location !== 'undefined') {
      globalThis.location.replace(buildCleanWebAppUrl(
        globalThis.location.origin,
        process.env.EXPO_PUBLIC_BASE_URL,
      ));
      return;
    }
    router.replace('/');
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {!error ? <ActivityIndicator color={colors.accent} /> : null}
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          {error ? 'Sign-in needs attention' : 'Finishing sign-in'}
        </Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          {error ?? 'Securing your Google session before JIEN opens your local profile.'}
        </Text>
        {error ? (
          <Pressable
            accessibilityRole="button"
            onPress={leaveCallback}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: colors.accentSoft },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.buttonText, { color: colors.accent }]}>Return to sign in</Text>
          </Pressable>
        ) : null}
      </View>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  card: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 560,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.card,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { ...typography.section, fontWeight: '700' },
  body: { ...typography.body },
  button: {
    minHeight: 48,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonText: { ...typography.body, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
