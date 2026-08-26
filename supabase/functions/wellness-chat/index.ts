// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  requestWellnessGuidance,
  resolveWellnessProvider,
  WellnessProviderError,
} from '../_shared/wellness-provider.ts';
import {
  contextQueriesSucceeded,
  parseWellnessChatRequest,
  storedReplyMatchesRequest,
} from '../_shared/wellness-contract.ts';
import {
  loadPersonalAiConfiguration,
  resolveSupabaseServerKey,
} from '../_shared/user-ai.ts';
import { summarizeTrainingMuscleContext } from '../_shared/training-context.ts';
import { summarizeLoggedNutrition } from '../_shared/nutrition-context.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
};

Deno.serve(async (request) => {
  const requestId = safeRequestId(request.headers.get('x-request-id'));
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') {
    return failure('METHOD_NOT_ALLOWED', 'Only POST is supported.', false, 405, requestId);
  }

  try {
    const authHeader = request.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return failure('AUTH_REQUIRED', 'Sign in to request AI guidance.', false, 401, requestId);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = resolveSupabaseServerKey({
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      SUPABASE_SECRET_KEYS: Deno.env.get('SUPABASE_SECRET_KEYS'),
    });
    if (!url || !anonKey || !serviceKey) {
      return failure('SERVICE_NOT_CONFIGURED', 'The wellness service is not configured.', true, 503, requestId);
    }
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) {
      return failure('AUTH_REQUIRED', 'Sign in to request AI guidance.', false, 401, requestId);
    }
    const userId = userData.user.id;

    const contract = parseWellnessChatRequest(await request.json().catch(() => null));
    if (!contract.ok) return contractFailure(contract.code, requestId);
    const {
      conversationId,
      userMessageId,
      assistantMessageId,
      assistantSequence,
      mode,
      planBrief,
    } = contract.data;

    const { data: profile, error: profileError } = await userClient
      .from('users')
      .select('training_experience, available_equipment, injury_flags, goals, typical_diet_pattern, preferred_load_unit, ai_data_consent, medical_disclaimer_acknowledged_at')
      .eq('id', userId)
      .maybeSingle();
    if (profileError) {
      return failure('PROFILE_UNAVAILABLE', 'The wellness profile could not be read. Try again.', true, 503, requestId);
    }
    if (!profile) {
      return failure('PROFILE_REQUIRED', 'Complete onboarding before requesting AI guidance.', false, 409, requestId);
    }
    if (!profile.ai_data_consent) {
      return failure('AI_CONSENT_REQUIRED', 'AI data consent is required before requesting guidance.', false, 403, requestId);
    }
    if (!profile.medical_disclaimer_acknowledged_at) {
      return failure('DISCLAIMER_REQUIRED', 'Acknowledge the health guidance notice before using AI.', false, 403, requestId);
    }

    const { data: existingReply, error: existingReplyError } = await admin
      .from('ai_messages')
      .select('id, user_id, conversation_id, sequence, role, content, created_at, model, deleted_at')
      .eq('id', assistantMessageId)
      .eq('user_id', userId)
      .maybeSingle();
    if (existingReplyError) {
      return failure('RESPONSE_LOOKUP_FAILED', 'The saved guidance could not be checked. Try again.', true, 503, requestId);
    }
    if (existingReply) {
      if (!storedReplyMatchesRequest(existingReply, contract.data)) {
        return failure('IDEMPOTENCY_CONFLICT', 'This reply identifier is already in use.', false, 409, requestId);
      }
      return success({ message: mapMessage(existingReply) }, requestId);
    }

    const [conversationResult, userMessageResult] = await Promise.all([
      userClient
        .from('ai_conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .maybeSingle(),
      userClient
        .from('ai_messages')
        .select('id, sequence, content')
        .eq('id', userMessageId)
        .eq('conversation_id', conversationId)
        .eq('role', 'user')
        .is('deleted_at', null)
        .maybeSingle(),
    ]);
    if (conversationResult.error || userMessageResult.error) {
      return failure('MESSAGE_LOOKUP_FAILED', 'The synced question could not be checked. Try again.', true, 503, requestId);
    }
    const conversation = conversationResult.data;
    const userMessage = userMessageResult.data;
    if (!conversation || !userMessage) {
      return failure('MESSAGE_NOT_SYNCED', 'Sync the question before requesting an AI reply.', true, 409, requestId);
    }
    if (assistantSequence !== userMessage.sequence + 1) {
      return failure('INVALID_SEQUENCE', 'The reply sequence does not follow the question.', false, 409, requestId);
    }

    let personalConfiguration = null;
    try {
      personalConfiguration = await loadPersonalAiConfiguration(admin, userId);
    } catch {
      // Retain the deployment-owned provider while the per-user migration rolls out.
    }
    const provider = personalConfiguration
      ? { ok: true, configuration: personalConfiguration }
      : resolveWellnessProvider({
        WELLNESS_AI_PROVIDER: Deno.env.get('WELLNESS_AI_PROVIDER'),
        GEMINI_API_KEY: Deno.env.get('GEMINI_API_KEY'),
        GEMINI_MODEL: Deno.env.get('GEMINI_MODEL'),
        ANTHROPIC_API_KEY: Deno.env.get('ANTHROPIC_API_KEY'),
        ANTHROPIC_MODEL: Deno.env.get('ANTHROPIC_MODEL'),
      });
    if (!provider.ok) {
      return failure('AI_NOT_CONFIGURED', 'AI guidance is not configured yet.', false, 503, requestId);
    }

    let context;
    try {
      context = await loadLiveContext(userClient, userId, conversationId, profile);
    } catch {
      return failure('CONTEXT_UNAVAILABLE', 'Your recent context could not be loaded. Try again.', true, 503, requestId);
    }
    const safePlan = planBrief;
    let providerResult;
    try {
      providerResult = await requestWellnessGuidance(provider.configuration, {
        system: wellnessSystemPrompt(),
        prompt: wellnessUserPrompt(mode, userMessage.content, context, safePlan),
      });
    } catch (cause) {
      if (cause instanceof WellnessProviderError) {
        return failure(
          cause.code,
          cause.message,
          cause.retryable,
          cause.httpStatus,
          requestId,
        );
      }
      return failure('AI_PROVIDER_UNAVAILABLE', 'The AI service could not respond. Try again shortly.', true, 502, requestId);
    }

    const createdAt = new Date().toISOString();
    const assistantRow = {
      id: assistantMessageId,
      user_id: userId,
      conversation_id: conversationId,
      sequence: assistantSequence,
      role: 'assistant',
      content: providerResult.text.slice(0, 12_000),
      structured_content: { kind: mode, plan_brief_version: safePlan?.version ?? null },
      metadata: { request_id: requestId, provider: provider.configuration.provider },
      model: provider.configuration.model,
      provider_message_id: providerResult.providerMessageId,
      created_at: createdAt,
      client_updated_at: createdAt,
      deleted_at: null,
    };
    const { error: insertError } = await admin.from('ai_messages').upsert(assistantRow, { onConflict: 'id' });
    if (insertError) {
      return failure('RESPONSE_SAVE_FAILED', 'The guidance was generated but could not be saved. Retry the request.', true, 503, requestId);
    }
    await admin
      .from('ai_conversations')
      .update({ last_message_at: createdAt, client_updated_at: createdAt })
      .eq('id', conversationId)
      .eq('user_id', userId);

    return success({ message: mapMessage(assistantRow) }, requestId);
  } catch {
    return failure('UNEXPECTED_ERROR', 'The wellness service could not complete this request.', true, 500, requestId);
  }
});

async function loadLiveContext(client, userId, conversationId, profile) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const since14 = new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
  const [workoutResult, mealResult, wellnessResult, historyResult, targetResult] = await Promise.all([
    client.from('workouts').select('id, title, performed_on, completed_at').eq('user_id', userId).eq('status', 'completed').gte('performed_on', since30).is('deleted_at', null).order('performed_on', { ascending: false }).limit(20),
    client.from('meals').select('id, eaten_on').eq('user_id', userId).gte('eaten_on', since14).is('deleted_at', null).limit(100),
    client.from('wellness_logs').select('kind, logged_at, mood_score, energy_score, stress_score, soreness_score, motivation_score, sleep_duration_minutes, sleep_quality_score, injury_flags, notes').eq('user_id', userId).gte('logged_on', since30).is('deleted_at', null).order('logged_at', { ascending: false }).limit(30),
    client.from('ai_messages').select('role, content').eq('conversation_id', conversationId).is('deleted_at', null).order('sequence', { ascending: false }).limit(8),
    client.from('nutrition_targets').select('calories_kcal, protein_g, carbohydrate_g, fat_g').eq('user_id', userId).lte('effective_from', today).or(`effective_to.is.null,effective_to.gte.${today}`).is('deleted_at', null).order('effective_from', { ascending: false }).limit(1),
  ]);
  if (!contextQueriesSucceeded(workoutResult, mealResult, wellnessResult, historyResult, targetResult)) {
    throw new Error('CONTEXT_QUERY_FAILED');
  }
  const workouts = workoutResult.data ?? [];
  const workoutIds = workouts.map((row) => row.id);
  const meals = mealResult.data ?? [];
  const mealIds = meals.map((row) => row.id);
  const [setResult, foodResult] = await Promise.all([
    workoutIds.length
      ? client.from('sets').select('workout_id, exercise_id, reps, load_value, load_unit, rpe, kind').in('workout_id', workoutIds).is('deleted_at', null).limit(500)
      : Promise.resolve({ data: [], error: null }),
    mealIds.length
      ? client.from('food_items').select('meal_id, calories_kcal, protein_g, carbohydrate_g, fat_g').in('meal_id', mealIds).is('deleted_at', null).limit(600)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (!contextQueriesSucceeded(setResult, foodResult)) throw new Error('CONTEXT_QUERY_FAILED');
  const workingSets = (setResult.data ?? []).filter((set) => set.kind === 'working');
  const exerciseIds = [...new Set(workingSets.map((set) => set.exercise_id))];
  const exerciseResult = exerciseIds.length
    ? await client.from('exercises')
      .select('id, primary_muscle_group, secondary_muscle_groups')
      .eq('user_id', userId)
      .in('id', exerciseIds)
      .is('deleted_at', null)
      .limit(200)
    : { data: [], error: null };
  if (!contextQueriesSucceeded(exerciseResult)) throw new Error('CONTEXT_QUERY_FAILED');
  const volumeKg = workingSets.reduce((total, set) => total + Number(set.load_value) * Number(set.reps) * (set.load_unit === 'lb' ? 0.45359237 : 1), 0);
  const muscleContext = summarizeTrainingMuscleContext(workouts, workingSets, exerciseResult.data ?? []);
  const nutritionContext = summarizeLoggedNutrition(meals, foodResult.data ?? [], targetResult.data?.[0] ?? null);

  return {
    profile: {
      trainingExperience: profile.training_experience,
      equipment: profile.available_equipment,
      injuryFlags: profile.injury_flags,
      goals: profile.goals,
      dietPattern: profile.typical_diet_pattern,
      loadUnit: profile.preferred_load_unit,
    },
    training30Days: {
      workoutCount: workouts.length,
      workingSetCount: workingSets.length,
      volumeKg: round(volumeKg),
      recentSessions: workouts.slice(0, 8),
      bodyPartWorkload: muscleContext,
    },
    nutrition14Days: nutritionContext,
    recentWellness: (wellnessResult.data ?? []).slice(0, 12),
    recentConversation: (historyResult.data ?? []).reverse().slice(0, -1),
  };
}

function wellnessSystemPrompt() {
  return `You are JIEN's restrained wellness planning assistant. Use only the supplied user-owned context. Be concise, warm, and practical. Never diagnose, prescribe treatment, recommend max-effort or 1RM testing, or invent missing measurements. The deterministic plan brief is computed by the app and is the sole numeric source of truth for progression: explain it exactly and never replace its action, load, reps, or deload state. Body-part workload uses one primary working set and half credit for tagged assisting muscles; load-times-reps is descriptive work, never measured muscle growth. Treat a partially logged week or missing nutrition days as incomplete evidence, not a decline. Connect food or recovery to training only when the supplied history supports it, and state uncertainty plainly. If an active joint flag exists, prioritize caution and suggest a qualified clinician for concerning or persistent symptoms. End health-related guidance with a short "Not medical advice" reminder.`;
}

function wellnessUserPrompt(mode, userMessage, context, safePlan) {
  return `Request mode: ${mode}\nQuestion: ${String(userMessage).slice(0, 2_000)}\n\nLive structured context (last 7-30 days):\n${JSON.stringify(context)}\n\nDeterministic plan brief:\n${JSON.stringify(safePlan)}\n\nRespond in plain text with short paragraphs or compact bullet lines.`;
}

function safeRequestId(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{8,128}$/.test(clean) ? clean : crypto.randomUUID();
}

function round(value) { return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0; }
function mapMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sequence: row.sequence,
    content: row.content,
    createdAt: row.created_at,
    model: row.model ?? null,
  };
}
function success(data, requestId, status = 200) {
  return new Response(JSON.stringify({ data, requestId }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function failure(code, message, retryable, status, requestId) {
  return new Response(JSON.stringify({ error: { code, message, retryable }, requestId }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function contractFailure(code, requestId) {
  const failures = {
    INVALID_ENVELOPE: ['This app version sent an invalid request.', 400],
    INVALID_REQUEST: ['The conversation request is invalid.', 400],
    INVALID_SEQUENCE: ['The conversation sequence is invalid.', 400],
    INVALID_MODE: ['The requested guidance mode is invalid.', 400],
    INVALID_PLAN: ['The deterministic plan brief is invalid.', 400],
  };
  const [message, status] = failures[code] ?? ['The conversation request is invalid.', 400];
  return failure(code, message, false, status, requestId);
}
