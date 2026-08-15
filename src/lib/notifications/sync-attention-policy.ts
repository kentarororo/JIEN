export function getSyncAttentionTrigger(input: {
  enabled: boolean;
  actionRequiredCount: number;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  now: Date;
}): Date | null {
  if (!input.enabled || input.actionRequiredCount < 1) return null;
  const trigger = new Date(input.now.getTime() + 5_000);
  const quietStart = parseClock(input.quietHoursStart);
  const quietEnd = parseClock(input.quietHoursEnd);
  if (quietStart == null || quietEnd == null || quietStart === quietEnd) return trigger;
  const currentMinutes = input.now.getHours() * 60 + input.now.getMinutes();
  const inQuietHours = quietStart < quietEnd
    ? currentMinutes >= quietStart && currentMinutes < quietEnd
    : currentMinutes >= quietStart || currentMinutes < quietEnd;
  if (!inQuietHours) return trigger;

  const endHour = Math.floor(quietEnd / 60);
  const endMinute = quietEnd % 60;
  const nextAllowed = new Date(input.now);
  nextAllowed.setHours(endHour, endMinute, 0, 0);
  if (nextAllowed <= input.now) nextAllowed.setDate(nextAllowed.getDate() + 1);
  return nextAllowed;
}

function parseClock(value: string | null): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
    ? hours * 60 + minutes
    : null;
}
