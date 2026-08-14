import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMonthGrid, moveMonth } from './index.ts';

test('builds a stable six-week Monday-first month grid', () => {
  const cells = buildMonthGrid(new Date(2026, 7, 1), new Date(2026, 7, 14));
  assert.equal(cells.length, 42);
  assert.equal(cells[0]?.dateKey, '2026-07-27');
  assert.equal(cells.at(-1)?.dateKey, '2026-09-06');
  assert.equal(cells.find((cell) => cell.isToday)?.dateKey, '2026-08-14');
});

test('moves across year boundaries without date overflow', () => {
  const next = moveMonth(new Date(2026, 11, 31), 1);
  assert.equal(next.getFullYear(), 2027);
  assert.equal(next.getMonth(), 0);
  assert.equal(next.getDate(), 1);
});
