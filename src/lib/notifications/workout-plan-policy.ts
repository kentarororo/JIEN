import { applyNotificationDeliveryWindow } from './delivery-window.ts';

export function getWorkoutPlanTrigger(input: {
  enabled: boolean;
  scheduledAt: string;
  leadMinutes: number;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  lastNotifiedAt?: string | null;
  minimumIntervalMinutes?: number;
  now: Date;
}): Date | null {
  if (!input.enabled) return null;
  const scheduled = new Date(input.scheduledAt);
  if (!Number.isFinite(scheduled.getTime()) || scheduled <= input.now) return null;
  const leadMinutes = Math.max(0, Math.min(24 * 60, Math.floor(input.leadMinutes)));
  const desired = new Date(scheduled.getTime() - leadMinutes * 60_000);
  const candidate = desired > input.now ? desired : new Date(input.now.getTime() + 5_000);
  return applyNotificationDeliveryWindow({
    candidate,
    deadline: scheduled,
    quietHoursStart: input.quietHoursStart,
    quietHoursEnd: input.quietHoursEnd,
    lastNotifiedAt: input.lastNotifiedAt,
    minimumIntervalMinutes: input.minimumIntervalMinutes,
    now: input.now,
  });
}
