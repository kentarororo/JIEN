// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

import { isConfirmedAccountDeletionEnvelope } from '../_shared/account-deletion.ts';
import { resolveSupabaseServerKey } from '../_shared/user-ai.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  const requestId = safeRequestId(request.headers.get('x-request-id'));
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') {
    return failure(requestId, 'METHOD_NOT_ALLOWED', 'Use POST to delete an account.', false, 405);
  }

  try {
    const authHeader = request.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return failure(requestId, 'AUTH_REQUIRED', 'Sign in before deleting this account.', false, 401);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serverKey = resolveSupabaseServerKey({
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      SUPABASE_SECRET_KEYS: Deno.env.get('SUPABASE_SECRET_KEYS'),
    });
    if (!url || !anonKey || !serverKey) {
      return failure(requestId, 'SERVICE_NOT_CONFIGURED', 'Account deletion is unavailable right now.', true, 503);
    }

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(url, serverKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) {
      return failure(requestId, 'AUTH_REQUIRED', 'Sign in before deleting this account.', false, 401);
    }

    const envelope = await request.json().catch(() => null);
    if (!isConfirmedAccountDeletionEnvelope(envelope)) {
      return failure(
        requestId,
        'CONFIRMATION_REQUIRED',
        'Type DELETE in JIEN before permanently deleting the account.',
        false,
        400,
      );
    }

    const userId = userData.user.id;
    const { error: credentialError } = await admin.rpc('delete_user_ai_credential', {
      p_user_id: userId,
    });
    if (credentialError) {
      return failure(requestId, 'PRIVATE_DATA_DELETE_FAILED', 'Private account data could not be deleted.', true, 503);
    }

    const { error: deletionError } = await admin.auth.admin.deleteUser(userId, false);
    if (deletionError) {
      return failure(requestId, 'ACCOUNT_DELETE_FAILED', 'The account could not be deleted.', true, 503);
    }

    return success(requestId, { deleted: true });
  } catch {
    return failure(requestId, 'INTERNAL_ERROR', 'Account deletion is temporarily unavailable.', true, 500);
  }
});

function safeRequestId(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{8,128}$/.test(clean) ? clean : crypto.randomUUID();
}

function success(requestId, data, status = 200) {
  return new Response(JSON.stringify({ data, requestId }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function failure(requestId, code, message, retryable, status) {
  return new Response(JSON.stringify({ error: { code, message, retryable }, requestId }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
