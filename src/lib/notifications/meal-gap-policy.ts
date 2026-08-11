export function getMealGapTrigger(input: {
  enabled: boolean;
  mealCount: number;
  expectedMeals: number;
  checkHour: number;
  now: Date;
}): Date | null {
  if (!input.enabled || input.mealCount >= input.expectedMeals) return null;
  const hour = Math.max(0, Math.min(23, Math.floor(input.checkHour)));
  const triggerAt = new Date(input.now);
  triggerAt.setHours(hour, 0, 0, 0);
  return triggerAt > input.now ? triggerAt : null;
}
