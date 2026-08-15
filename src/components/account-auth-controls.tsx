import { useSQLiteContext } from '@/lib/db/database-context';
import { useState } from 'react';
import { View } from 'react-native';

import { signInWithGoogle, signInWithPassword, signUpWithPassword } from '@/lib/auth';
import { retryableAuthFailure } from '@/lib/auth/account-entry';
import { syncAccountData, type AccountSyncResult } from '@/lib/db';
import { spacing, useJienTheme } from '@/theme';

import { AppText, Button, Card, Field } from './ui';

type BusyAction = 'google' | 'sign_in' | 'sign_up';

export function AccountAuthControls({
  allowSignUp = false,
  onAuthenticated,
}: {
  allowSignUp?: boolean;
  onAuthenticated: (result: AccountSyncResult) => void | Promise<void>;
}) {
  const db = useSQLiteContext();
  const { colors } = useJienTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reportFailure = (cause: unknown) => {
    setError(retryableAuthFailure(cause).message);
    setBusy(null);
  };

  const continueWithGoogle = async () => {
    setError(null);
    setNotice(null);
    setBusy('google');
    try {
      await signInWithGoogle();
    } catch (cause) {
      reportFailure(cause);
    }
  };

  const finishEmailAuthentication = async () => {
    const result = await syncAccountData(db, { trigger: 'auth_state_change' });
    await onAuthenticated(result);
  };

  const submit = async (kind: 'sign_in' | 'sign_up') => {
    setError(null);
    setNotice(null);
    if (!email.includes('@') || password.length < 8) {
      setError('Use a valid email and a password of at least 8 characters.');
      return;
    }

    setBusy(kind);
    try {
      if (kind === 'sign_in') {
        await signInWithPassword(email, password);
        await finishEmailAuthentication();
      } else {
        const result = await signUpWithPassword(email, password);
        if (result === 'signed_in') {
          await finishEmailAuthentication();
        } else {
          setNotice('Confirm your email address, then return here to sign in.');
        }
      }
    } catch (cause) {
      reportFailure(cause);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: spacing.md }}>
      {error ? (
        <Card accessibilityRole="alert" style={{ backgroundColor: colors.dangerSoft }}>
          <AppText style={{ color: colors.danger, fontWeight: '600' }}>{error}</AppText>
          <AppText style={{ color: colors.textMuted }}>Your local data has not been changed. Correct the details and try again.</AppText>
        </Card>
      ) : null}
      {notice ? (
        <Card accessibilityRole="alert" style={{ backgroundColor: colors.successSoft }}>
          <AppText style={{ color: colors.success }}>{notice}</AppText>
        </Card>
      ) : null}
      <Button label="Continue with Google" onPress={() => void continueWithGoogle()} busy={busy === 'google'} disabled={busy !== null} />
      <AppText style={{ color: colors.textMuted, textAlign: 'center' }}>or use email</AppText>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" hint="At least 8 characters" />
      <Button label="Sign in and restore" onPress={() => void submit('sign_in')} busy={busy === 'sign_in'} disabled={busy !== null} />
      {allowSignUp ? (
        <Button label="Create account" onPress={() => void submit('sign_up')} busy={busy === 'sign_up'} disabled={busy !== null} variant="secondary" />
      ) : null}
    </View>
  );
}
