export function getWorkoutPlanTrigger(input: {
  enabled: boolean;
  scheduledAt: string;
  leadMinutes: number;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  now: Date;
}): Date | null {
  if (!input.enabled) return null;
  const scheduled = new Date(input.scheduledAt);
  if (!Number.isFinite(scheduled.getTime()) || scheduled <= input.now) return null;
  const leadMinutes = Math.max(0, Math.min(24 * 60, Math.floor(input.leadMinutes)));
  const desired = new Date(scheduled.getTime() - leadMinutes * 60_000);
  const trigger = desired > input.now ? desired : new Date(input.now.getTime() + 5_000);
  const quietStart = parseClock(input.quietHoursStart);
  const quietEnd = parseClock(input.quietHoursEnd);
  if (quietStart == null || quietEnd == null || quietStart === quietEnd) return trigger;
  const triggerMinutes = trigger.getHours() * 60 + trigger.getMinutes();
  const inQuietHours = quietStart < quietEnd
    ? triggerMinutes >= quietStart && triggerMinutes < quietEnd
    : triggerMinutes >= quietStart || triggerMinutes < quietEnd;
  if (!inQuietHours) return trigger;

  const nextAllowed = new Date(trigger);
  nextAllowed.setHours(Math.floor(quietEnd / 60), quietEnd % 60, 0, 0);
  if (nextAllowed <= trigger) nextAllowed.setDate(nextAllowed.getDate() + 1);
  return nextAllowed < scheduled ? nextAllowed : null;
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
