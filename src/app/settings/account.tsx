import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert } from 'react-native';

import { AppText, Button, Card, Field, Screen } from '@/components/ui';
import { signInWithPassword, signUpWithPassword } from '@/lib/auth';
import { syncPendingChanges } from '@/lib/db';
import { useJienTheme } from '@/theme';

export default function AccountScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useJienTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'sign_in' | 'sign_up' | null>(null);

  const submit = async (kind: 'sign_in' | 'sign_up') => {
    if (!email.includes('@') || password.length < 8) {
      Alert.alert('Check your details', 'Use a valid email and a password of at least 8 characters.');
      return;
    }
    setBusy(kind);
    try {
      if (kind === 'sign_in') {
        await signInWithPassword(email, password);
        await syncPendingChanges(db);
        router.back();
      } else {
        const result = await signUpWithPassword(email, password);
        if (result === 'signed_in') {
          await syncPendingChanges(db);
          router.back();
        }
        else Alert.alert('Check your email', 'Confirm your email address, then return here to sign in.');
      }
    } catch (cause) {
      Alert.alert(kind === 'sign_in' ? 'Sign in failed' : 'Account not created', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Card><AppText style={{ color: colors.textMuted }}>Logging always works without an account. Signing in adds encrypted transport to your Supabase project and lets the queued local changes sync.</AppText></Card>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" hint="At least 8 characters" />
      <Button label="Sign in" onPress={() => void submit('sign_in')} busy={busy === 'sign_in'} disabled={busy !== null} />
      <Button label="Create account" onPress={() => void submit('sign_up')} busy={busy === 'sign_up'} disabled={busy !== null} variant="secondary" />
    </Screen>
  );
}
