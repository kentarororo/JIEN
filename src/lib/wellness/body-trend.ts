export type BodyWeightPoint = {
  id: string;
  loggedAt: string;
  bodyWeightKg: number;
};

export type BodyWeightTrend = {
  points: Array<BodyWeightPoint & { date: string }>;
  latestKg: number | null;
  latestChangeKg: number | null;
  recentAverageKg: number | null;
  previousAverageKg: number | null;
  averageChangeKg: number | null;
  spanDays: number;
};

/**
 * Produces a descriptive weight trend without judging whether movement is good or
 * bad. Only the latest valid measurement from each local calendar day is used so
 * repeated same-day entries cannot overpower the series.
 */
export function buildBodyWeightTrend(input: BodyWeightPoint[]): BodyWeightTrend {
  const byDate = new Map<string, BodyWeightPoint & { date: string }>();
  for (const measurement of input) {
    const timestamp = new Date(measurement.loggedAt);
    if (!Number.isFinite(timestamp.getTime()) || !Number.isFinite(measurement.bodyWeightKg) || measurement.bodyWeightKg <= 0) continue;
    const date = localDateKey(timestamp);
    const current = byDate.get(date);
    if (!current || new Date(current.loggedAt).getTime() < timestamp.getTime()) {
      byDate.set(date, { ...measurement, date });
    }
  }

  const points = [...byDate.values()].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  const latest = points.at(-1) ?? null;
  const previous = points.at(-2) ?? null;
  const recent = points.slice(-7);
  const prior = points.slice(-14, -7);
  const recentAverageKg = recent.length ? mean(recent.map((point) => point.bodyWeightKg)) : null;
  const previousAverageKg = prior.length >= 3 ? mean(prior.map((point) => point.bodyWeightKg)) : null;
  const firstTime = points[0] ? new Date(points[0].loggedAt).getTime() : 0;
  const latestTime = latest ? new Date(latest.loggedAt).getTime() : 0;

  return {
    points,
    latestKg: latest?.bodyWeightKg ?? null,
    latestChangeKg: latest && previous ? round(latest.bodyWeightKg - previous.bodyWeightKg, 2) : null,
    recentAverageKg: recentAverageKg == null ? null : round(recentAverageKg, 2),
    previousAverageKg: previousAverageKg == null ? null : round(previousAverageKg, 2),
    averageChangeKg: recentAverageKg != null && previousAverageKg != null
      ? round(recentAverageKg - previousAverageKg, 2)
      : null,
    spanDays: latest && points[0] ? Math.max(0, Math.round((latestTime - firstTime) / 86_400_000)) : 0,
  };
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
