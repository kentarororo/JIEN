// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

import { parseProviderPhotoItems } from '../_shared/photo-contract.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const allowedMediaTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const providerTimeoutMs = 22_000;

Deno.serve(async (request) => {
  const requestId = safeRequestId(request.headers.get('x-request-id'));
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') {
    return failure(requestId, 'METHOD_NOT_ALLOWED', 'Use POST for photo analysis.', false, 405);
  }

  try {
    const authHeader = request.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return failure(requestId, 'AUTH_REQUIRED', 'Sign in to analyze meal photos.', false, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anonKey) {
      return failure(requestId, 'SERVICE_NOT_CONFIGURED', 'Photo analysis is unavailable right now.', true, 503);
    }
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return failure(requestId, 'AUTH_REQUIRED', 'Sign in to analyze meal photos.', false, 401);
    }
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('ai_data_consent')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (profileError) {
      return failure(requestId, 'PROFILE_UNAVAILABLE', 'Your AI preferences could not be checked.', true, 503);
    }
    if (!profile?.ai_data_consent) {
      return failure(
        requestId,
        'AI_CONSENT_REQUIRED',
        'Allow contextual AI in your profile before sending a meal photo.',
        false,
        403,
      );
    }

    let envelope;
    try {
      envelope = await request.json();
    } catch {
      return failure(requestId, 'INVALID_REQUEST', 'Send a valid photo-analysis request.', false, 400);
    }
    if (!isRecord(envelope) || envelope.version !== 1 || !isRecord(envelope.data)) {
      return failure(requestId, 'INVALID_REQUEST', 'This photo-analysis request version is not supported.', false, 400);
    }
    const data = envelope.data;
    const action = data.action;
    if (action !== 'capability' && action !== 'analyze') {
      return failure(requestId, 'INVALID_REQUEST', 'Choose a supported photo-analysis action.', false, 400);
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    const model = Deno.env.get('ANTHROPIC_MODEL');
    if (!apiKey || !model) {
      return failure(
        requestId,
        'PHOTO_AI_NOT_CONFIGURED',
        'AI photo analysis is not configured for this project.',
        false,
        503,
      );
    }
    if (action === 'capability') return success(requestId, { available: true });

    const imageBase64 = data.imageBase64;
    const mediaType = data.mediaType;
    const description = typeof data.description === 'string' ? data.description.trim().slice(0, 500) : '';
    if (typeof imageBase64 !== 'string' || imageBase64.length < 100) {
      return failure(requestId, 'PHOTO_REQUIRED', 'Choose a meal photo before starting analysis.', false, 400);
    }
    if (imageBase64.length > 14_000_000) {
      return failure(requestId, 'PHOTO_TOO_LARGE', 'The photo is too large. Choose a smaller image.', false, 413);
    }
    if (typeof mediaType !== 'string' || !allowedMediaTypes.has(mediaType)) {
      return failure(requestId, 'PHOTO_TYPE_UNSUPPORTED', 'Use a JPEG, PNG, or WebP meal photo.', false, 415);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
    let providerResponse;
    try {
      providerResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1200,
          temperature: 0,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
              {
                type: 'text',
                text: `Estimate the visible meal as editable food line items. User description: ${description || 'none provided'}\nReturn JSON only: {"items":[{"name":string,"quantity":number,"unit":string,"caloriesKcal":number,"proteinG":number,"carbohydrateG":number,"fatG":number,"fibreG":number|null,"confidence":number}]}. Confidence must be 0..1. Use realistic portions. Do not provide medical advice.`,
              },
            ],
          }],
        }),
      });
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') {
        return failure(requestId, 'PROVIDER_TIMEOUT', 'Photo analysis took too long. Try again.', true, 504);
      }
      return failure(requestId, 'PROVIDER_UNAVAILABLE', 'The photo service could not be reached.', true, 502);
    } finally {
      clearTimeout(timeout);
    }
    if (!providerResponse.ok) {
      return failure(requestId, 'PROVIDER_UNAVAILABLE', 'The photo service could not analyze this image.', providerResponse.status >= 500 || providerResponse.status === 429, 502);
    }

    let providerPayload;
    try {
      providerPayload = await providerResponse.json();
    } catch {
      return failure(requestId, 'PROVIDER_OUTPUT_INVALID', 'The photo result could not be read. Try again.', true, 502);
    }
    const text = providerPayload?.content?.find((part) => part?.type === 'text')?.text;
    if (typeof text !== 'string') {
      return failure(requestId, 'PROVIDER_OUTPUT_INVALID', 'The photo result could not be read. Try again.', true, 502);
    }

    let items;
    try {
      items = parseProviderPhotoItems(text);
    } catch (cause) {
      const noFood = cause instanceof Error && cause.message === 'NO_FOOD_DETECTED';
      return failure(
        requestId,
        noFood ? 'NO_FOOD_DETECTED' : 'PROVIDER_OUTPUT_INVALID',
        noFood
          ? 'No food was identified. Try a clearer photo or add a short description.'
          : 'The photo result was incomplete. Try the analysis again.',
        !noFood,
        noFood ? 422 : 502,
      );
    }
    return success(requestId, {
      items: items.map((item) => ({
        id: `ai-${crypto.randomUUID()}`,
        name: item.name,
        brand: null,
        servingQuantity: item.quantity,
        servingUnit: item.unit,
        caloriesKcal: item.caloriesKcal,
        proteinG: item.proteinG,
        carbohydrateG: item.carbohydrateG,
        fatG: item.fatG,
        fibreG: item.fibreG,
        source: 'ai_photo',
        sourceRef: null,
        barcode: null,
        confidence: item.confidence,
      })),
      disclaimer: 'AI estimate—review every portion and macro before saving. Not medical advice.',
    });
  } catch {
    return failure(requestId, 'INTERNAL_ERROR', 'Photo analysis is temporarily unavailable.', true, 500);
  }
});

function safeRequestId(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{8,128}$/.test(clean) ? clean : crypto.randomUUID();
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function success(requestId, data, status = 200) {
  return json({ data, requestId }, status);
}

function failure(requestId, code, message, retryable, status) {
  return json({ error: { code, message, retryable }, requestId }, status);
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
