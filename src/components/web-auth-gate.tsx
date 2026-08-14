import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { signInWithGoogle } from '@/lib/auth';
import { getSupabaseClient } from '@/lib/db';
import { radii, resolveTheme, spacing, typography } from '@/theme/tokens';

type GateState =
  | { kind: 'loading' }
  | { kind: 'signed_out' }
  | { kind: 'offline' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; session: Session };

export function WebAuthGate({ children }: PropsWithChildren) {
  if (Platform.OS !== 'web') return children;
  return <WebAuthGateContent>{children}</WebAuthGateContent>;
}

function WebAuthGateContent({ children }: PropsWithChildren) {
  const [state, setState] = useState<GateState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let client: SupabaseClient;
    const resolveSession = (session: Session | null) => {
      if (!active) return;
      if (!navigator.onLine) setState({ kind: 'offline' });
      else setState(session ? { kind: 'ready', session } : { kind: 'signed_out' });
    };
    try {
      client = getSupabaseClient();
      void client.auth.getSession().then(({ data, error }) => {
        if (error) throw error;
        resolveSession(data.session);
      }).catch((cause) => {
        if (active) setState({ kind: 'error', message: cause instanceof Error ? cause.message : 'Could not restore your session.' });
      });
      const { data } = client.auth.onAuthStateChange((_event, session) => resolveSession(session));
      const onOnlineChange = () => {
        if (!navigator.onLine) setState({ kind: 'offline' });
        else void client!.auth.getSession().then(({ data }) => resolveSession(data.session));
      };
      window.addEventListener('online', onOnlineChange);
      window.addEventListener('offline', onOnlineChange);
      return () => {
        active = false;
        data.subscription.unsubscribe();
        window.removeEventListener('online', onOnlineChange);
        window.removeEventListener('offline', onOnlineChange);
      };
    } catch (cause) {
      setState({ kind: 'error', message: cause instanceof Error ? cause.message : 'Account service is unavailable.' });
      return () => { active = false; };
    }
  }, [attempt]);

  if (state.kind === 'ready') return children;
  return <WebAccountPanel state={state} onRetry={() => setAttempt((value) => value + 1)} />;
}

function WebAccountPanel({ state, onRetry }: { state: Exclude<GateState, { kind: 'ready' }>; onRetry: () => void }) {
  const { colors } = resolveTheme(useColorScheme());
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const loading = state.kind === 'loading';
  const offline = state.kind === 'offline';
  const error = authError ?? (state.kind === 'error' ? state.message : null);

  const signIn = async () => {
    setBusy(true);
    setAuthError(null);
    try { await signInWithGoogle(); }
    catch (cause) { setAuthError(cause instanceof Error ? cause.message : 'Google sign-in could not start.'); }
    finally { setBusy(false); }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.brand, { color: colors.accent }]}>JIEN</Text>
        {loading ? <ActivityIndicator color={colors.accent} /> : null}
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          {offline ? 'Connect to continue' : loading ? 'Restoring your session' : 'Your training record, on every device'}
        </Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          {offline
            ? 'This web tester uses your private cloud account for every session. Reconnect, then try again.'
            : 'The web tester keeps its working database in memory and restores it securely after Google sign-in.'}
        </Text>
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
        {!loading && !offline ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void signIn()} style={({ pressed }) => [styles.button, { backgroundColor: colors.accent }, pressed && styles.pressed]}>
            {busy ? <ActivityIndicator color={colors.textOnAccent} /> : <Text style={[styles.buttonLabel, { color: colors.textOnAccent }]}>Continue with Google</Text>}
          </Pressable>
        ) : null}
        {(offline || state.kind === 'error') ? (
          <Pressable accessibilityRole="button" onPress={onRetry} style={[styles.button, { borderColor: colors.border, borderWidth: 1 }]}>
            <Text style={[styles.buttonLabel, { color: colors.text }]}>Try again</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, justifyContent: 'center' },
  card: { width: '100%', maxWidth: 520, alignSelf: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.xl, gap: spacing.md },
  brand: { ...typography.bodyLarge, fontWeight: '800', letterSpacing: 1.2 },
  title: { ...typography.title, fontWeight: '700' },
  body: { ...typography.body },
  error: { ...typography.label, fontWeight: '600' },
  button: { minHeight: 48, borderRadius: radii.control, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { ...typography.body, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
