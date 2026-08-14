import type { AccountSyncResult } from '@/lib/db';

export function hydrationCopy(result: AccountSyncResult | null): { title: string; body: string } {
  if (!result) return { title: 'Restoring JIEN', body: 'Loading your private profile and history before the app opens.' };
  if (result.state === 'synced') return { title: 'JIEN is ready', body: 'Your private training record has been restored.' };
  if (result.state === 'offline') return { title: 'Connect to restore JIEN', body: 'The web tester needs an internet connection before it can open your account.' };
  if (result.state === 'account_conflict') return { title: 'This account does not match', body: 'No local records were changed. Sign out, then use the Google account that owns this training record.' };
  if (result.state === 'signed_out') return { title: 'Your session ended', body: 'Sign in with Google again to restore your training record.' };
  if (result.state === 'not_configured') return { title: 'Account service is unavailable', body: 'This tester build is missing its public Supabase configuration.' };
  if ('error' in result) return { title: 'Cloud restore needs attention', body: result.error };
  return { title: 'Cloud restore needs attention', body: 'Your account could not be restored yet. Try again.' };
}
