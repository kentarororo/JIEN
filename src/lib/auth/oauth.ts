export function normalizeBasePath(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed === '/') return '';
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}

export function buildWebOAuthRedirectUrl(origin: string, basePath?: string): string {
  const normalizedOrigin = origin.replace(/\/+$/g, '');
  return `${normalizedOrigin}${normalizeBasePath(basePath)}/?auth_callback=1`;
}
