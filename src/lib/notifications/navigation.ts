export type NotificationHref = '/meals/new' | '/settings' | '/train' | `/workouts/${string}`;

const allowedHrefs = new Set<NotificationHref>(['/meals/new', '/settings', '/train']);

export function getNotificationHref(data: unknown): NotificationHref | null {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return null;
  const href = (data as { href?: unknown }).href;
  if (typeof href !== 'string') return null;
  if (allowedHrefs.has(href as NotificationHref)) return href as NotificationHref;
  return /^\/workouts\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(href)
    ? href as NotificationHref
    : null;
}
