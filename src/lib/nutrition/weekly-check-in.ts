import type { NutritionTarget } from '@/lib/db/types';

import type { AdaptiveNutritionEvaluation } from './adaptive-targets';

export const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type WeeklyNutritionCheckIn = {
  state: 'off' | 'not_due' | 'need_more_data' | 'hold' | 'ready';
  scheduledDay: number | null;
  suggestedCaloriesKcal: number;
  suggestedProteinG: number;
  reason: AdaptiveNutritionEvaluation['recommendation']['reason'] | 'off' | 'not_due';
};

/** Review-only state. Applying the returned values remains a separate user action. */
export function buildWeeklyNutritionCheckIn(
  target: NutritionTarget,
  evaluation: AdaptiveNutritionEvaluation,
  today = new Date(),
): WeeklyNutritionCheckIn {
  if (target.weeklyCheckInDay == null) {
    return result('off', target, 'off');
  }
  if (today.getDay() !== target.weeklyCheckInDay) {
    return result('not_due', target, 'not_due');
  }
  if (!evaluation.dataSufficiency.sufficient) {
    return result('need_more_data', target, evaluation.recommendation.reason);
  }
  if (evaluation.action === 'hold') {
    return result('hold', target, evaluation.recommendation.reason);
  }
  return {
    state: 'ready',
    scheduledDay: target.weeklyCheckInDay,
    suggestedCaloriesKcal: evaluation.recommendation.suggestedCaloriesKcal,
    // Weight-rate evidence sizes the calorie change; it does not justify inventing
    // a new protein prescription, so the confirmed protein target is carried forward.
    suggestedProteinG: target.proteinG,
    reason: evaluation.recommendation.reason,
  };
}

export function formatWeeklyCheckInDay(day: number | null): string {
  return day == null ? 'Off' : WEEKDAY_LABELS[day] ?? 'Off';
}

function result(
  state: WeeklyNutritionCheckIn['state'],
  target: NutritionTarget,
  reason: WeeklyNutritionCheckIn['reason'],
): WeeklyNutritionCheckIn {
  return {
    state,
    scheduledDay: target.weeklyCheckInDay,
    suggestedCaloriesKcal: target.caloriesKcal,
    suggestedProteinG: target.proteinG,
    reason,
  };
}
