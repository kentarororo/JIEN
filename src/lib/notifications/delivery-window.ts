export function applyNotificationDeliveryWindow(input: {
  candidate: Date;
  deadline?: Date | null;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  lastNotifiedAt?: string | null;
  minimumIntervalMinutes?: number;
  now: Date;
}): Date | null {
  if (!Number.isFinite(input.candidate.getTime()) || input.candidate <= input.now) return null;

  let allowedAt = new Date(input.candidate);
  const lastNotifiedAt = input.lastNotifiedAt ? new Date(input.lastNotifiedAt) : null;
  const minimumIntervalMinutes = Number.isFinite(input.minimumIntervalMinutes)
    ? Math.max(0, Math.floor(input.minimumIntervalMinutes ?? 0))
    : 0;
  if (lastNotifiedAt && Number.isFinite(lastNotifiedAt.getTime())) {
    const cooldownEndsAt = new Date(lastNotifiedAt.getTime() + minimumIntervalMinutes * 60_000);
    if (cooldownEndsAt > allowedAt) allowedAt = cooldownEndsAt;
  }

  allowedAt = moveAfterQuietHours(
    allowedAt,
    input.quietHoursStart ?? null,
    input.quietHoursEnd ?? null,
  );
  if (allowedAt <= input.now) return null;
  if (input.deadline && allowedAt >= input.deadline) return null;
  return allowedAt;
}

function moveAfterQuietHours(value: Date, startValue: string | null, endValue: string | null): Date {
  const quietStart = parseClock(startValue);
  const quietEnd = parseClock(endValue);
  if (quietStart == null || quietEnd == null || quietStart === quietEnd) return value;
  const timeOfDay = value.getHours() * 3_600_000
    + value.getMinutes() * 60_000
    + value.getSeconds() * 1_000
    + value.getMilliseconds();
  const isQuiet = quietStart < quietEnd
    ? timeOfDay >= quietStart && timeOfDay < quietEnd
    : timeOfDay >= quietStart || timeOfDay < quietEnd;
  if (!isQuiet) return value;

  const next = new Date(value);
  const endHours = Math.floor(quietEnd / 3_600_000);
  const afterHours = quietEnd % 3_600_000;
  const endMinutes = Math.floor(afterHours / 60_000);
  const afterMinutes = afterHours % 60_000;
  const endSeconds = Math.floor(afterMinutes / 1_000);
  const endMilliseconds = afterMinutes % 1_000;
  next.setHours(endHours, endMinutes, endSeconds, endMilliseconds);
  if (next <= value) next.setDate(next.getDate() + 1);
  return next;
}

function parseClock(value: string | null): number | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/.exec(value ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  const milliseconds = Number((match[4] ?? '').padEnd(3, '0').slice(0, 3) || 0);
  return hours >= 0 && hours <= 23
    && minutes >= 0 && minutes <= 59
    && seconds >= 0 && seconds <= 59
    ? hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + milliseconds
    : null;
}
