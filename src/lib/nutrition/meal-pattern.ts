export type MealLoggingPattern = {
  established: boolean;
  expectedMeals: number | null;
  sampleDays: number;
};

export function inferMealLoggingPattern(values: number[]): MealLoggingPattern {
  const counts = values
    .filter((count) => Number.isFinite(count) && count > 0)
    .map((count) => Math.floor(count))
    .sort((left, right) => left - right);
  if (counts.length < 4) return { established: false, expectedMeals: null, sampleDays: counts.length };
  const middle = Math.floor(counts.length / 2);
  const median = counts.length % 2
    ? counts[middle]!
    : Math.round((counts[middle - 1]! + counts[middle]!) / 2);
  return {
    established: median >= 2,
    expectedMeals: median >= 2 ? Math.min(5, median) : null,
    sampleDays: counts.length,
  };
}
