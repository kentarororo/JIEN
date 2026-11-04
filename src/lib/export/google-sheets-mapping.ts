import type { GoogleSheetTabValues, GoogleSheetsExportData } from '@/lib/db';

export function buildGoogleSheetsTabs(data: GoogleSheetsExportData): GoogleSheetTabValues[] {
  return [
    {
      title: 'Workouts',
      values: [
        ['Date', 'Workout', 'Exercise', 'Set', 'Weight (kg)', 'Reps', 'RPE', 'Volume (kg·reps)'],
        ...data.workouts.map((row) => {
          const loadKg = row.unit === 'lb' ? row.load * 0.45359237 : row.load;
          return [
            googleDateSerial(row.performedOn),
            row.workoutTitle,
            row.exercise,
            row.setNumber,
            round(loadKg),
            row.reps,
            row.rpe ?? '',
            round(row.volumeKg),
          ];
        }),
      ],
    },
    {
      title: 'Nutrition',
      values: [
        ['Date', 'Day state', 'Kcal', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Weigh-in (kg)'],
        ...data.nutrition.map((row) => [
          googleDateSerial(row.date),
          row.dayState,
          round(row.caloriesKcal),
          round(row.proteinG),
          round(row.carbohydrateG),
          round(row.fatG),
          row.bodyWeightKg == null ? '' : round(row.bodyWeightKg),
        ]),
      ],
    },
  ];
}

function googleDateSerial(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('An export date is invalid. Check the saved record and try again.');
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return timestamp / 86_400_000 + 25_569;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
