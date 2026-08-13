import type { FitnessGoal, MacroTotals } from '@/lib/db/types';

export function calculateStartingNutritionTarget(input: {
  bodyWeightKg: number;
  goals: FitnessGoal[];
}): MacroTotals {
  if (!Number.isFinite(input.bodyWeightKg) || input.bodyWeightKg <= 0) {
    throw new Error('A valid body weight is needed for a starting macro estimate.');
  }

  const combinesStrengthAndComposition = input.goals.includes('both')
    || (input.goals.includes('strength') && input.goals.includes('composition'));
  const goal = combinesStrengthAndComposition
    ? 'both'
    : input.goals.includes('composition')
      ? 'composition'
      : input.goals.includes('strength')
        ? 'strength'
        : 'general_wellness';
  const calorieMultiplier = goal === 'composition' ? 28 : goal === 'strength' ? 32 : goal === 'both' ? 30 : 29;
  const proteinMultiplier = goal === 'general_wellness' ? 1.6 : 1.8;
  const caloriesKcal = roundTo(input.bodyWeightKg * calorieMultiplier, 10);
  const proteinG = Math.round(input.bodyWeightKg * proteinMultiplier);
  const fatG = Math.round(input.bodyWeightKg * 0.8);
  const carbohydrateG = Math.max(0, Math.round((caloriesKcal - proteinG * 4 - fatG * 9) / 4));
  const fibreG = Math.max(25, Math.round((caloriesKcal / 1000) * 14));

  return { caloriesKcal, proteinG, carbohydrateG, fatG, fibreG };
}

function roundTo(value: number, increment: number): number {
  return Math.round(value / increment) * increment;
}
