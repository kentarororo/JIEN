import type { User } from '@supabase/supabase-js';

import { getSupabaseClient } from '@/lib/db';

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

export async function signOut(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) throw error;
}
