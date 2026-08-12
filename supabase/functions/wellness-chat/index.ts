// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
};

Deno.serve(async (request) => {
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
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
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
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

    const body = await request.json().catch(() => null);
    if (body?.version !== 1 || !body.data) {
      return failure('INVALID_ENVELOPE', 'This app version sent an invalid request.', false, 400, requestId);
    }
    const {
      conversationId,
      userMessageId,
      assistantMessageId,
      assistantSequence,
      mode = 'chat',
      planBrief,
    } = body.data;
    if (![conversationId, userMessageId, assistantMessageId].every(isUuid)) {
      return failure('INVALID_REQUEST', 'The conversation request is invalid.', false, 400, requestId);
    }
    if (!Number.isInteger(assistantSequence) || assistantSequence < 1 || assistantSequence > 100_000) {
      return failure('INVALID_SEQUENCE', 'The conversation sequence is invalid.', false, 400, requestId);
    }
    if (!['chat', 'plan_explanation'].includes(mode)) {
      return failure('INVALID_MODE', 'The requested guidance mode is invalid.', false, 400, requestId);
    }

    const { data: profile, error: profileError } = await userClient
      .from('users')
      .select('training_experience, available_equipment, injury_flags, goals, typical_diet_pattern, preferred_load_unit, ai_data_consent, medical_disclaimer_acknowledged_at')
      .eq('id', userId)
      .single();
    if (profileError || !profile) {
      return failure('PROFILE_REQUIRED', 'Complete onboarding before requesting AI guidance.', false, 409, requestId);
    }
    if (!profile.ai_data_consent) {
      return failure('AI_CONSENT_REQUIRED', 'AI data consent is required before requesting guidance.', false, 403, requestId);
    }
    if (!profile.medical_disclaimer_acknowledged_at) {
      return failure('DISCLAIMER_REQUIRED', 'Acknowledge the health guidance notice before using AI.', false, 403, requestId);
    }

    const { data: existingReply } = await admin
      .from('ai_messages')
      .select('id, conversation_id, sequence, content, created_at, model')
      .eq('id', assistantMessageId)
      .eq('user_id', userId)
      .maybeSingle();
    if (existingReply) return success({ message: mapMessage(existingReply) }, requestId);

    const [{ data: conversation }, { data: userMessage }] = await Promise.all([
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
    if (!conversation || !userMessage) {
      return failure('MESSAGE_NOT_SYNCED', 'Sync the question before requesting an AI reply.', true, 409, requestId);
    }
    if (assistantSequence !== userMessage.sequence + 1) {
      return failure('INVALID_SEQUENCE', 'The reply sequence does not follow the question.', false, 409, requestId);
    }

    const context = await loadLiveContext(userClient, userId, conversationId, profile);
    const safePlan = normalizePlanBrief(planBrief);
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    const model = Deno.env.get('ANTHROPIC_MODEL');
    if (!apiKey || !model) {
      return failure('AI_NOT_CONFIGURED', 'AI guidance is not configured yet.', true, 503, requestId);
    }

    const providerResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 900,
        temperature: 0.2,
        system: `You are JIEN's restrained wellness planning assistant. Use only the supplied user-owned context. Be concise, warm, and practical. Never diagnose, prescribe treatment, recommend max-effort or 1RM testing, or invent missing measurements. The deterministic plan brief is computed by the app and is the sole numeric source of truth for progression: explain it exactly and never replace its action, load, reps, or deload state. If an active joint flag exists, prioritize caution and suggest a qualified clinician for concerning or persistent symptoms. State uncertainty plainly. End health-related guidance with a short "Not medical advice" reminder.`,
        messages: [{
          role: 'user',
          content: `Request mode: ${mode}\nQuestion: ${String(userMessage.content).slice(0, 2_000)}\n\nLive structured context (last 7-30 days):\n${JSON.stringify(context)}\n\nDeterministic plan brief:\n${JSON.stringify(safePlan)}\n\nRespond in plain text with short paragraphs or compact bullet lines.`,
        }],
      }),
    });
    if (!providerResponse.ok) {
      return failure('AI_PROVIDER_UNAVAILABLE', 'The AI service could not respond. Try again shortly.', true, 502, requestId);
    }
    const providerMessage = await providerResponse.json();
    const content = String(providerMessage.content?.find((part) => part.type === 'text')?.text ?? '').trim();
    if (!content) {
      return failure('AI_EMPTY_RESPONSE', 'The AI service returned an empty response. Try again.', true, 502, requestId);
    }

    const createdAt = new Date().toISOString();
    const assistantRow = {
      id: assistantMessageId,
      user_id: userId,
      conversation_id: conversationId,
      sequence: assistantSequence,
      role: 'assistant',
      content: content.slice(0, 12_000),
      structured_content: { kind: mode, plan_brief_version: safePlan?.version ?? null },
      metadata: { request_id: requestId },
      model,
      provider_message_id: providerMessage.id ?? null,
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
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const since14 = new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
  const [workoutResult, mealResult, wellnessResult, historyResult] = await Promise.all([
    client.from('workouts').select('id, title, performed_on, completed_at').eq('user_id', userId).eq('status', 'completed').gte('performed_on', since30).is('deleted_at', null).order('performed_on', { ascending: false }).limit(20),
    client.from('meals').select('id, eaten_on').eq('user_id', userId).gte('eaten_on', since14).is('deleted_at', null).limit(100),
    client.from('wellness_logs').select('kind, logged_at, mood_score, energy_score, stress_score, soreness_score, motivation_score, sleep_duration_minutes, sleep_quality_score, injury_flags, notes').eq('user_id', userId).gte('logged_on', since30).is('deleted_at', null).order('logged_at', { ascending: false }).limit(30),
    client.from('ai_messages').select('role, content').eq('conversation_id', conversationId).is('deleted_at', null).order('sequence', { ascending: false }).limit(8),
  ]);
  const workouts = workoutResult.data ?? [];
  const workoutIds = workouts.map((row) => row.id);
  const meals = mealResult.data ?? [];
  const mealIds = meals.map((row) => row.id);
  const [setResult, foodResult] = await Promise.all([
    workoutIds.length
      ? client.from('sets').select('workout_id, exercise_id, reps, load_value, load_unit, rpe, kind').in('workout_id', workoutIds).is('deleted_at', null).limit(500)
      : Promise.resolve({ data: [] }),
    mealIds.length
      ? client.from('food_items').select('meal_id, calories_kcal, protein_g, carbohydrate_g, fat_g').in('meal_id', mealIds).is('deleted_at', null).limit(600)
      : Promise.resolve({ data: [] }),
  ]);
  const workingSets = (setResult.data ?? []).filter((set) => set.kind === 'working');
  const volumeKg = workingSets.reduce((total, set) => total + Number(set.load_value) * Number(set.reps) * (set.load_unit === 'lb' ? 0.45359237 : 1), 0);
  const foods = foodResult.data ?? [];
  const foodTotals = foods.reduce((sum, item) => ({
    caloriesKcal: sum.caloriesKcal + Number(item.calories_kcal || 0),
    proteinG: sum.proteinG + Number(item.protein_g || 0),
    carbohydrateG: sum.carbohydrateG + Number(item.carbohydrate_g || 0),
    fatG: sum.fatG + Number(item.fat_g || 0),
  }), { caloriesKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 });

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
    },
    nutrition14Days: {
      daysLogged: new Set(meals.map((meal) => meal.eaten_on)).size,
      mealCount: meals.length,
      totals: mapRounded(foodTotals),
    },
    recentWellness: (wellnessResult.data ?? []).slice(0, 12),
    recentConversation: (historyResult.data ?? []).reverse().slice(0, -1),
  };
}

function normalizePlanBrief(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.exercises)) return null;
  return {
    version: 1,
    generatedAt: String(value.generatedAt ?? ''),
    sourceWorkoutId: value.sourceWorkoutId ?? null,
    sourceWorkoutTitle: String(value.sourceWorkoutTitle ?? '').slice(0, 120) || null,
    activeJointFlag: Boolean(value.activeJointFlag),
    weeklyVolumeKg: (value.weeklyVolumeKg ?? []).slice(-10).map((item) => round(Number(item))),
    deloadSignal: value.deloadSignal ?? { kind: 'none', message: 'No signal supplied.' },
    exercises: value.exercises.slice(0, 20).map((exercise) => ({
      exerciseName: String(exercise.exerciseName ?? '').slice(0, 120),
      action: exercise.action,
      loadValue: exercise.loadValue == null ? null : round(Number(exercise.loadValue)),
      loadUnit: exercise.loadUnit,
      targetReps: Array.isArray(exercise.targetReps) ? exercise.targetReps.slice(0, 10).map(Number) : null,
      reason: String(exercise.reason ?? '').slice(0, 300),
    })),
  };
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function round(value) { return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0; }
function mapRounded(value) { return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, round(Number(item))])); }
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
