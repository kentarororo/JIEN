import { EdgeFunctionError, invokeEdgeFunctionEnvelope } from './supabase';

type AccountDeletionResponse = {
  deleted: true;
};

const ACCOUNT_DELETION_MESSAGES = {
  notConfigured: 'Account deletion is unavailable because the account service is not configured.',
  authRequired: 'Sign in before deleting this account.',
  timeout: 'Account deletion timed out. No completion was confirmed. Try again.',
  networkRequired: 'Account deletion needs a working connection. No completion was confirmed.',
} as const;

export function parseAccountDeletionResponse(value: unknown): AccountDeletionResponse {
  if (
    value == null
    || typeof value !== 'object'
    || Array.isArray(value)
    || (value as { deleted?: unknown }).deleted !== true
  ) {
    throw new EdgeFunctionError(
      'The account service returned an invalid deletion confirmation. Contact support before retrying.',
      'INVALID_RESPONSE',
      false,
    );
  }
  return { deleted: true };
}

export async function deleteCloudAccount(): Promise<{ requestId: string }> {
  const result = await invokeEdgeFunctionEnvelope<unknown>(
    'delete-account',
    { confirmation: 'DELETE' },
    25_000,
    ACCOUNT_DELETION_MESSAGES,
  );
  parseAccountDeletionResponse(result.data);
  return { requestId: result.requestId };
}
