import { applyNotificationDeliveryWindow } from './delivery-window.ts';

export function getMealGapTrigger(input: {
  enabled: boolean;
  patternEstablished: boolean;
  mealCount: number;
  expectedMeals: number;
  checkHour: number;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  lastNotifiedAt?: string | null;
  minimumIntervalMinutes?: number;
  now: Date;
}): Date | null {
  if (!input.enabled || !input.patternEstablished || input.mealCount >= input.expectedMeals) return null;
  const hour = Math.max(0, Math.min(23, Math.floor(input.checkHour)));
  const triggerAt = new Date(input.now);
  triggerAt.setHours(hour, 0, 0, 0);
  if (triggerAt <= input.now) return null;
  const endOfDay = new Date(input.now);
  endOfDay.setHours(24, 0, 0, 0);
  return applyNotificationDeliveryWindow({
    candidate: triggerAt,
    deadline: endOfDay,
    quietHoursStart: input.quietHoursStart,
    quietHoursEnd: input.quietHoursEnd,
    lastNotifiedAt: input.lastNotifiedAt,
    minimumIntervalMinutes: input.minimumIntervalMinutes,
    now: input.now,
  });
}
