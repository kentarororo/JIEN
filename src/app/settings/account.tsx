import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert } from 'react-native';

import { AppText, Button, Card, Field, Screen } from '@/components/ui';
import { signInWithGoogle, signInWithPassword, signUpWithPassword } from '@/lib/auth';
import { syncAccountData } from '@/lib/db';
import { useJienTheme } from '@/theme';

export default function AccountScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useJienTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'google' | 'sign_in' | 'sign_up' | null>(null);

  const finishSync = async () => {
    const result = await syncAccountData(db);
    if (result.state === 'account_conflict') {
      throw new Error('This device is linked to another JIEN account. Sign in with the original account; local records are never merged automatically.');
    }
    if (result.state === 'partial') throw new Error(result.error);
  };

  const continueWithGoogle = async () => {
    setBusy('google');
    try {
      await signInWithGoogle();
    } catch (cause) {
      Alert.alert('Google sign-in did not start', cause instanceof Error ? cause.message : 'Please try again.');
      setBusy(null);
    }
  };

  const submit = async (kind: 'sign_in' | 'sign_up') => {
    if (!email.includes('@') || password.length < 8) {
      Alert.alert('Check your details', 'Use a valid email and a password of at least 8 characters.');
      return;
    }
    setBusy(kind);
    try {
      if (kind === 'sign_in') {
        await signInWithPassword(email, password);
        await finishSync();
        router.back();
      } else {
        const result = await signUpWithPassword(email, password);
        if (result === 'signed_in') {
          await finishSync();
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
      <Card><AppText style={{ color: colors.textMuted }}>Logging always works without an account. Sign in once to restore your profile and history on another device. The first account used here becomes this local databaseâ€™s owner, so JIEN never merges two peopleâ€™s records silently.</AppText></Card>
      <Button label="Continue with Google" onPress={() => void continueWithGoogle()} busy={busy === 'google'} disabled={busy !== null} />
      <AppText style={{ color: colors.textMuted, textAlign: 'center' }}>or use email</AppText>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" hint="At least 8 characters" />
      <Button label="Sign in" onPress={() => void submit('sign_in')} busy={busy === 'sign_in'} disabled={busy !== null} />
      <Button label="Create account" onPress={() => void submit('sign_up')} busy={busy === 'sign_up'} disabled={busy !== null} variant="secondary" />
    </Screen>
  );
}
