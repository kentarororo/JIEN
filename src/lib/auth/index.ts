import type { User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { getSupabaseClient } from '@/lib/db';

import { buildWebOAuthRedirectUrl } from './oauth';

export type AccountState =
  | { configured: false; user: null }
  | { configured: true; user: User | null };

export async function getAccountState(): Promise<AccountState> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return { configured: true, user: data.session?.user ?? null };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Supabase is not configured')) {
      return { configured: false, user: null };
    }
    return { configured: true, user: null };
  }
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

export async function signUpWithPassword(email: string, password: string): Promise<'signed_in' | 'confirm_email'> {
  const { data, error } = await getSupabaseClient().auth.signUp({ email: email.trim(), password });
  if (error) throw error;
  return data.session ? 'signed_in' : 'confirm_email';
}

function getOAuthRedirectUrl(): string {
  if (Platform.OS === 'web') {
    if (typeof globalThis.location === 'undefined') {
      throw new Error('Google sign-in is available after the app finishes loading.');
    }
    return buildWebOAuthRedirectUrl(
      globalThis.location.origin,
      process.env.EXPO_PUBLIC_BASE_URL,
    );
  }
  return Linking.createURL('auth/callback');
}

export async function signInWithGoogle(): Promise<void> {
  const redirectTo = getOAuthRedirectUrl();
  const { data, error } = await getSupabaseClient().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: Platform.OS !== 'web',
    },
  });
  if (error) throw error;
  if (Platform.OS !== 'web') {
    if (!data.url) throw new Error('Google did not return a sign-in URL.');
    await Linking.openURL(data.url);
  }
}

export async function completeOAuthSignIn(code: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.exchangeCodeForSession(code);
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) throw error;
}
