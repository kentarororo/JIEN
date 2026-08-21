export type NormalizedSleepInput = {
  sleepDurationMinutes: number | null;
  sleepQualityScore: number | null;
  notes: string;
};

export function normalizeSleepInput(input: NormalizedSleepInput): NormalizedSleepInput {
  const duration = input.sleepDurationMinutes;
  const quality = input.sleepQualityScore;
  const notes = input.notes.trim().slice(0, 2_000);

  if (duration != null && (!Number.isInteger(duration) || duration < 0 || duration > 1_440)) {
    throw new Error('Sleep duration must be between 0 and 24 hours.');
  }
  if (quality != null && (!Number.isInteger(quality) || quality < 1 || quality > 5)) {
    throw new Error('Sleep quality must be a whole number from 1 to 5.');
  }
  if (duration == null && quality == null && !notes) {
    throw new Error('Add sleep duration, quality, or a short note.');
  }

  return { sleepDurationMinutes: duration, sleepQualityScore: quality, notes };
}

export function formatSleepDuration(minutes: number | null): string {
  if (minutes == null) return 'Duration not entered';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder} min`;
  if (remainder === 0) return `${hours} hr`;
  return `${hours} hr ${remainder} min`;
}

export function averageSleepDuration(logs: Array<{ sleepDurationMinutes: number | null }>): number | null {
  const durations = logs
    .map((log) => log.sleepDurationMinutes)
    .filter((duration): duration is number => duration != null);
  if (!durations.length) return null;
  return Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length);
}
