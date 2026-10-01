export const CARDIO_ACTIVITIES = [
  ['walk', 'Walk'], ['run', 'Run'], ['treadmill_walk', 'Treadmill walk'],
  ['treadmill_run', 'Treadmill run'], ['cycle', 'Cycle'], ['stationary_bike', 'Stationary bike'],
  ['rower', 'Rowing machine'], ['elliptical', 'Elliptical'], ['stairs', 'Stair climber'], ['swim', 'Swim'],
] as const;
export type CardioActivity = typeof CARDIO_ACTIVITIES[number][0];
export type CardioInput = { activity: CardioActivity; minutes: number; distanceKm: number | null; effort: number | null };
export type CardioSession = CardioInput & { id: string; loggedOn: string; loggedAt: string; notes: string };
export const cardioLabel = (activity: CardioActivity) => CARDIO_ACTIVITIES.find(([key]) => key === activity)?.[1] ?? 'Cardio';

export function validateCardio(input: CardioInput): CardioInput {
  if (!CARDIO_ACTIVITIES.some(([key]) => key === input.activity)) throw new Error('Choose a supported cardio activity.');
  if (!Number.isFinite(input.minutes) || input.minutes <= 0 || input.minutes > 1440) throw new Error('Enter a duration greater than 0 and no more than 1,440 minutes.');
  if (input.distanceKm != null && (!Number.isFinite(input.distanceKm) || input.distanceKm <= 0 || input.distanceKm > 1000)) throw new Error('Enter a distance greater than 0 and no more than 1,000 km, or leave it blank.');
  if (input.effort != null && (!Number.isFinite(input.effort) || input.effort < 1 || input.effort > 10)) throw new Error('Enter effort from 1 to 10, or leave it blank.');
  return { activity: input.activity, minutes: input.minutes, distanceKm: input.distanceKm ?? null, effort: input.effort ?? null };
}

export function parseCardioMetadata(value: unknown): CardioInput | null {
  try {
    const data = typeof value === 'string' ? JSON.parse(value) : value;
    if (!data || data.version !== 1) return null;
    return validateCardio(data);
  } catch { return null; }
}

/** A description of recent duration, not a prescription or fitness score. */
export function cardioBaseline(sessions: CardioSession[], activity: CardioActivity, beforeDay: string, excludeId?: string) {
  const matching = sessions.filter((row) => row.activity === activity && row.id !== excludeId && row.loggedOn <= beforeDay)
    .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt) || b.id.localeCompare(a.id)).slice(0, 3);
  const values = matching.map((row) => row.minutes).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const medianMinutes = values.length ? values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2 : null;
  return { count: matching.length, medianMinutes };
}
