import { applyNotificationDeliveryWindow } from './delivery-window.ts';

export function getSyncAttentionTrigger(input: {
  enabled: boolean;
  actionRequiredCount: number;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  lastNotifiedAt?: string | null;
  minimumIntervalMinutes?: number;
  now: Date;
}): Date | null {
  if (!input.enabled || input.actionRequiredCount < 1) return null;
  return applyNotificationDeliveryWindow({
    candidate: new Date(input.now.getTime() + 5_000),
    quietHoursStart: input.quietHoursStart,
    quietHoursEnd: input.quietHoursEnd,
    lastNotifiedAt: input.lastNotifiedAt,
    minimumIntervalMinutes: input.minimumIntervalMinutes,
    now: input.now,
  });
}
