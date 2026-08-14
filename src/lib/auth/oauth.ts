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
  errorDescription: string | null;
};

export function parseWebOAuthCallbackUrl(url: string): OAuthCallbackRequest | null {
  const parsed = new URL(url);
  if (parsed.searchParams.get('auth_callback') !== '1') return null;
  return {
    code: parsed.searchParams.get('code'),
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
