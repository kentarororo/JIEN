export function normalizeBasePath(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed === '/') return '';
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}

export function buildWebOAuthRedirectUrl(origin: string, basePath?: string): string {
  const normalizedOrigin = origin.replace(/\/+$/g, '');
  return `${normalizedOrigin}${normalizeBasePath(basePath)}/?auth_callback=1`;
}

export type OAuthCallbackRequest = {
  code: string | null;
  errorCode: string | null;
  errorDescription: string | null;
};

export type OAuthCallbackPlan =
  | { kind: 'exchange'; code: string }
  | { kind: 'error'; message: string };

const PROVIDER_EXCHANGE_MESSAGE = 'Google sign-in reached Supabase, but JIEN\'s Google connection could not complete the secure token exchange. No local data was changed. Please try once more; if it repeats, the app owner must refresh the Google client secret in Supabase.';
const DIRECT_GOOGLE_CODE_MESSAGE = 'Google returned to JIEN directly instead of through Supabase. No code was exchanged. The Google OAuth redirect URI must use this Supabase project\'s /auth/v1/callback URL.';

export function isGoogleExternalAuthorizationCode(value: string): boolean {
  return /^4\/[A-Za-z0-9._~-]+$/.test(value.trim());
}

/**
 * Separates Supabase's PKCE callback from provider-side failures. OAuth error
 * descriptions can contain a one-time Google code, so they must not be shown
 * verbatim or passed to exchangeCodeForSession.
 */
export function planOAuthCallback(request: OAuthCallbackRequest): OAuthCallbackPlan {
  if (request.errorDescription || request.errorCode) {
    if (/unable to exchange external code/i.test(request.errorDescription ?? '')) {
      return { kind: 'error', message: PROVIDER_EXCHANGE_MESSAGE };
    }
    if (request.errorCode === 'access_denied') {
      return { kind: 'error', message: 'Google sign-in was cancelled. Your local data was not changed.' };
    }
    return { kind: 'error', message: 'Google sign-in did not finish. Your local data was not changed. Please try again.' };
  }
  if (!request.code) {
    return { kind: 'error', message: 'Google did not return a Supabase sign-in code. Please try again.' };
  }
  if (isGoogleExternalAuthorizationCode(request.code)) {
    return { kind: 'error', message: DIRECT_GOOGLE_CODE_MESSAGE };
  }
  return { kind: 'exchange', code: request.code };
}

export function parseWebOAuthCallbackUrl(url: string): OAuthCallbackRequest | null {
  const parsed = new URL(url);
  if (parsed.searchParams.get('auth_callback') !== '1') return null;
  return {
    code: parsed.searchParams.get('code'),
    errorCode: parsed.searchParams.get('error'),
    errorDescription: parsed.searchParams.get('error_description'),
  };
}

export function isNativeOAuthCallbackPath(pathname: string): boolean {
  return pathname.replace(/\/+$/g, '').endsWith('/auth/callback');
}

export function buildCleanWebAppUrl(origin: string, basePath?: string): string {
  const normalizedOrigin = origin.replace(/\/+$/g, '');
  return `${normalizedOrigin}${normalizeBasePath(basePath)}/`;
}
