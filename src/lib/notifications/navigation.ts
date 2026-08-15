export type NotificationHref = '/meals/new' | '/settings' | '/train';

const allowedHrefs = new Set<NotificationHref>(['/meals/new', '/settings', '/train']);

export function getNotificationHref(data: unknown): NotificationHref | null {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return null;
  const href = (data as { href?: unknown }).href;
  return typeof href === 'string' && allowedHrefs.has(href as NotificationHref)
    ? href as NotificationHref
    : null;
}
