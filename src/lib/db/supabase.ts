import 'react-native-url-polyfill/auto';
import 'expo-sqlite/localStorage/install';

import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';

let client: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (client) {
    return client;
  }

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error('Supabase is not configured. Set the EXPO_PUBLIC_SUPABASE_* variables.');
  }

  client = createClient(url, publishableKey, {
    auth: {
      storage: globalThis.localStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
      lock: processLock,
    },
  });

  return client;
}

type EdgeFunctionFailure = {
  error?: { code?: string; message?: string; retryable?: boolean };
  requestId?: string;
};

export class EdgeFunctionError extends Error {
  code: string;
  retryable: boolean;

  constructor(message: string, code = 'EDGE_FUNCTION_FAILED', retryable = false) {
    super(message);
    this.name = 'EdgeFunctionError';
    this.code = code;
    this.retryable = retryable;
  }
}

export async function invokeEdgeFunction<T>(
  name: string,
  data: Record<string, unknown>,
  timeoutMs = 25_000,
): Promise<T> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new EdgeFunctionError(
      'This AI feature needs Supabase configuration. Your local logs remain available.',
      'NOT_CONFIGURED',
    );
  }
  const { data: sessionData, error: sessionError } = await getSupabaseClient().auth.getSession();
  if (sessionError || !sessionData.session) {
    throw new EdgeFunctionError('Sign in to request new AI guidance.', 'AUTH_REQUIRED');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const requestId = Crypto.randomUUID();
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/${name}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionData.session.access_token}`,
        apikey: publishableKey,
        'x-request-id': requestId,
      },
      body: JSON.stringify({ version: 1, data }),
    });
    const payload = await response.json().catch(() => ({})) as EdgeFunctionFailure & { data?: T };
    if (!response.ok || payload.error || payload.data == null) {
      throw new EdgeFunctionError(
        payload.error?.message ?? 'The AI service is unavailable right now.',
        payload.error?.code ?? `HTTP_${response.status}`,
        payload.error?.retryable ?? response.status >= 500,
      );
    }
    return payload.data;
  } catch (error) {
    if (error instanceof EdgeFunctionError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new EdgeFunctionError('The AI request timed out. You can retry it.', 'REQUEST_TIMEOUT', true);
    }
    throw new EdgeFunctionError('AI needs a working connection. Your message is cached for retry.', 'NETWORK_REQUIRED', true);
  } finally {
    clearTimeout(timeout);
  }
}
