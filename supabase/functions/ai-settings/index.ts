// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  AI_DAILY_LIMITS,
  loadPersonalAiConfiguration,
  PERSONAL_GEMINI_MODEL,
  resolveSupabaseServerKey,
  verifyGeminiApiKey,
} from '../_shared/user-ai.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  const requestId = safeRequestId(request.headers.get('x-request-id'));
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return failure(requestId, 'METHOD_NOT_ALLOWED', 'Use POST for AI settings.', false, 405);

  try {
    const authHeader = request.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return failure(requestId, 'AUTH_REQUIRED', 'Sign in to manage your AI connection.', false, 401);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serverKey = resolveSupabaseServerKey({
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      SUPABASE_SECRET_KEYS: Deno.env.get('SUPABASE_SECRET_KEYS'),
    });
    if (!url || !anonKey || !serverKey) {
      return failure(requestId, 'SERVICE_NOT_CONFIGURED', 'Secure AI setup is unavailable right now.', true, 503);
    }
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(url, serverKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) {
      return failure(requestId, 'AUTH_REQUIRED', 'Sign in to manage your AI connection.', false, 401);
    }
    const userId = userData.user.id;

    const envelope = await request.json().catch(() => null);
    if (!isRecord(envelope) || envelope.version !== 1 || !isRecord(envelope.data)) {
      return failure(requestId, 'INVALID_REQUEST', 'This AI settings request is not supported.', false, 400);
    }
    const action = envelope.data.action;
    if (action !== 'status' && action !== 'save' && action !== 'remove') {
      return failure(requestId, 'INVALID_REQUEST', 'Choose a supported AI settings action.', false, 400);
    }

    if (action === 'save') {
      if (envelope.data.acknowledgesBillingControl !== true || envelope.data.acknowledgesFreeTierDataUse !== true) {
        return failure(requestId, 'ACKNOWLEDGEMENT_REQUIRED', 'Review the Gemini billing and free-tier data notes first.', false, 400);
      }
      const apiKey = typeof envelope.data.apiKey === 'string' ? envelope.data.apiKey.trim() : '';
      try {
        await verifyGeminiApiKey(apiKey);
      } catch (cause) {
        const code = cause instanceof Error ? cause.message : 'AI_KEY_VERIFICATION_FAILED';
        if (code === 'AI_KEY_INVALID') {
          return failure(requestId, code, 'Gemini did not accept that key. Create or copy an active key from Google AI Studio.', false, 400);
        }
        if (code === 'AI_KEY_VERIFICATION_TIMEOUT') {
          return failure(requestId, code, 'Gemini key verification timed out. Try again.', true, 504);
        }
        if (code === 'AI_MODEL_UNAVAILABLE') {
          return failure(requestId, code, 'This Gemini model is not available to the key’s Google project.', false, 400);
        }
        if (code === 'AI_KEY_QUOTA_EXCEEDED') {
          return failure(requestId, code, 'This Google project has no current Gemini quota. Check its Free/Paid tier and quotas in AI Studio.', false, 429);
        }
        return failure(requestId, 'AI_KEY_VERIFICATION_FAILED', 'The key could not be verified with Gemini. Try again.', true, 502);
      }
      const { error } = await admin.rpc('set_user_ai_credential', {
        p_user_id: userId,
        p_provider: 'gemini',
        p_model: PERSONAL_GEMINI_MODEL,
        p_secret: apiKey,
      });
      if (error) return failure(requestId, 'AI_KEY_SAVE_FAILED', 'The verified key could not be stored securely.', true, 503);
    }

    if (action === 'remove') {
      const { error } = await admin.rpc('delete_user_ai_credential', { p_user_id: userId });
      if (error) return failure(requestId, 'AI_KEY_REMOVE_FAILED', 'The AI connection could not be removed.', true, 503);
    }

    let personal = null;
    try {
      personal = await loadPersonalAiConfiguration(admin, userId);
    } catch {
      return failure(requestId, 'AI_KEY_STATUS_FAILED', 'Your AI connection status could not be read.', true, 503);
    }
    const appGeminiConfigured = Boolean(Deno.env.get('GEMINI_API_KEY')?.trim());
    return success(requestId, {
      configured: Boolean(personal || appGeminiConfigured),
      credentialSource: personal ? 'personal' : appGeminiConfigured ? 'app' : null,
      provider: personal || appGeminiConfigured ? 'gemini' : null,
      model: personal?.model ?? (appGeminiConfigured ? Deno.env.get('GEMINI_MODEL')?.trim() || PERSONAL_GEMINI_MODEL : PERSONAL_GEMINI_MODEL),
      limits: {
        photoPerUtcDay: AI_DAILY_LIMITS.photo,
        contextPerUtcDay: AI_DAILY_LIMITS.context,
      },
    });
  } catch {
    return failure(requestId, 'INTERNAL_ERROR', 'Secure AI setup is temporarily unavailable.', true, 500);
  }
});

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
function safeRequestId(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{8,128}$/.test(clean) ? clean : crypto.randomUUID();
}
function success(requestId, data, status = 200) {
  return new Response(JSON.stringify({ data, requestId }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function failure(requestId, code, message, retryable, status) {
  return new Response(JSON.stringify({ error: { code, message, retryable }, requestId }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
