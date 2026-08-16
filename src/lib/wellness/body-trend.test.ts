import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBodyWeightTrend } from './body-trend.ts';

const measurement = (day: number, bodyWeightKg: number, hour = 8) => ({
  id: `${day}-${hour}`,
  loggedAt: `2026-08-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00`,
  bodyWeightKg,
});

test('keeps the latest valid measurement per day and reports point-to-point change', () => {
  const trend = buildBodyWeightTrend([
    measurement(1, 80),
    measurement(2, 79.8, 7),
    measurement(2, 79.6, 19),
    { id: 'bad', loggedAt: 'invalid', bodyWeightKg: 0 },
  ]);

  assert.deepEqual(trend.points.map((point) => point.bodyWeightKg), [80, 79.6]);
  assert.equal(trend.latestKg, 79.6);
  assert.equal(trend.latestChangeKg, -0.4);
  assert.equal(trend.spanDays, 1);
});

test('compares adjacent seven-entry averages only after a useful prior sample', () => {
  const points = Array.from({ length: 14 }, (_, index) => measurement(index + 1, index < 7 ? 80 : 79));
  const trend = buildBodyWeightTrend(points);

  assert.equal(trend.previousAverageKg, 80);
  assert.equal(trend.recentAverageKg, 79);
  assert.equal(trend.averageChangeKg, -1);
});

test('returns a quiet empty baseline without inventing a trend', () => {
  assert.deepEqual(buildBodyWeightTrend([]), {
    points: [],
    latestKg: null,
    latestChangeKg: null,
    recentAverageKg: null,
    previousAverageKg: null,
    averageChangeKg: null,
    spanDays: 0,
  });
});
