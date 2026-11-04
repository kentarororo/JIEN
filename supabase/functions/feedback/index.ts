// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

import { parseFeedbackEnvelope } from '../_shared/feedback-contract.ts';
import { createFeedbackGithubIssue } from '../_shared/feedback-github.ts';
import { resolveSupabaseServerKey } from '../_shared/user-ai.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  const requestId = safeRequestId(request.headers.get('x-request-id'));
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return failure(requestId, 'METHOD_NOT_ALLOWED', 'Use POST to send feedback.', false, 405);

  try {
    const authHeader = request.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return failure(requestId, 'AUTH_REQUIRED', 'Sign in to send queued feedback.', false, 401);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serverKey = resolveSupabaseServerKey({
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      SUPABASE_SECRET_KEYS: Deno.env.get('SUPABASE_SECRET_KEYS'),
    });
    const githubToken = Deno.env.get('GITHUB_FEEDBACK_TOKEN');
    const repository = Deno.env.get('GITHUB_FEEDBACK_REPOSITORY');
    if (!url || !anonKey || !serverKey || !githubToken || !repository) {
      return failure(requestId, 'SERVICE_NOT_CONFIGURED', 'Feedback delivery is unavailable right now.', true, 503);
    }

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(url, serverKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return failure(requestId, 'AUTH_REQUIRED', 'Sign in to send queued feedback.', false, 401);

    const report = parseFeedbackEnvelope(await request.json().catch(() => null));
    if (!report) return failure(requestId, 'INVALID_REQUEST', 'Check the feedback fields and try again.', false, 400);
    const userId = userData.user.id;

    const { data: existing, error: existingError } = await admin
      .from('feedback')
      .select('github_issue_number, github_issue_url')
      .eq('id', report.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (existingError) return failure(requestId, 'FEEDBACK_LOOKUP_FAILED', 'Feedback could not be checked. Try again.', true, 503);
    if (existing?.github_issue_url) return success(requestId, { id: report.id, issueNumber: existing.github_issue_number });

    if (!existing) {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const { count, error: countError } = await admin
        .from('feedback')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', startOfDay.toISOString());
      if (countError) return failure(requestId, 'RATE_LIMIT_CHECK_FAILED', 'Feedback could not be checked. Try again.', true, 503);
      if ((count ?? 0) >= 10) return failure(requestId, 'RATE_LIMITED', 'You can send up to 10 feedback reports per day.', false, 429);

      const { error: insertError } = await admin.from('feedback').insert({
        id: report.id,
        user_id: userId,
        feedback_type: report.type,
        message: report.message,
        context: report.context,
        screenshot_base64: report.screenshotBase64,
        client_created_at: report.createdAt,
      });
      if (insertError) return failure(requestId, 'FEEDBACK_SAVE_FAILED', 'Feedback could not be saved. Try again.', true, 503);
    }

    let issue;
    try {
      issue = await createFeedbackGithubIssue(fetch, { token: githubToken, repository, report });
    } catch {
      return failure(requestId, 'GITHUB_ISSUE_FAILED', 'Feedback was saved but the issue could not be opened yet.', true, 502);
    }

    const { error: updateError } = await admin.from('feedback').update({
      github_issue_number: issue.number,
      github_issue_url: issue.url,
      delivered_at: new Date().toISOString(),
    }).eq('id', report.id).eq('user_id', userId);
    if (updateError) return failure(requestId, 'FEEDBACK_DELIVERY_SAVE_FAILED', 'Feedback was delivered but confirmation could not be saved.', true, 503);
    return success(requestId, { id: report.id, issueNumber: issue.number });
  } catch {
    return failure(requestId, 'INTERNAL_ERROR', 'Feedback could not be sent right now.', true, 500);
  }
});

function safeRequestId(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{8,128}$/.test(clean) ? clean : crypto.randomUUID();
}

function success(requestId, data, status = 200) {
  return new Response(JSON.stringify({ data, requestId }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function failure(requestId, code, message, retryable, status) {
  return new Response(JSON.stringify({ error: { code, message, retryable }, requestId }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
