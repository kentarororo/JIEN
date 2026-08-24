import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildMonthGrid, calendarSelectionForDate, isRepeatedCalendarDayActivation, moveMonth, moveMonthSelection } from './index.ts';

const todayScreen = () => readFileSync(new URL('../../app/(tabs)/today.tsx', import.meta.url), 'utf8');

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

test('keeps calendar selection inside the newly visible month', () => {
  const september = moveMonthSelection(new Date(2026, 7, 1), '2026-08-31', 1);
  assert.equal(september.dateKey, '2026-09-30');

  const january = moveMonthSelection(new Date(2026, 11, 1), '2026-12-14', 1);
  assert.equal(january.dateKey, '2027-01-14');
});

test('an adjacent-month day moves the visible calendar with the selection', () => {
  const selection = calendarSelectionForDate('2026-09-01');
  assert.equal(selection?.dateKey, '2026-09-01');
  assert.equal(selection?.month.getFullYear(), 2026);
  assert.equal(selection?.month.getMonth(), 8);
  assert.equal(selection?.month.getDate(), 1);
  assert.equal(calendarSelectionForDate('2026-02-31'), null);
  assert.equal(calendarSelectionForDate('not-a-date'), null);
});

test('opens a day workspace only for a quick repeated activation of the same date', () => {
  const first = { dateKey: '2026-08-24', activatedAt: 1_000 };
  assert.equal(isRepeatedCalendarDayActivation(null, first), false);
  assert.equal(isRepeatedCalendarDayActivation(first, { ...first, activatedAt: 1_350 }), true);
  assert.equal(isRepeatedCalendarDayActivation(first, { dateKey: '2026-08-25', activatedAt: 1_200 }), false);
  assert.equal(isRepeatedCalendarDayActivation(first, { ...first, activatedAt: 1_600 }), false);
});

test('the calendar day workspace keeps itemized training and food edit routes date-aware', () => {
  const source = todayScreen();
  assert.match(source, /isRepeatedCalendarDayActivation/);
  assert.match(source, /Double-click or double-tap/);
  assert.match(source, /visible=\{dayWorkspaceOpen\}/);
  assert.match(source, /pathname: '\/workouts\/new', params: \{ date: selectedDate \}/);
  assert.match(source, /pathname: '\/meals\/new', params: \{ date: selectedDate \}/);
  assert.match(source, /pathname: '\/workouts\/\[id\]'/);
  assert.match(source, /href=\{`\/meals\/\$\{meal\.id\}` as Href\}/);
  assert.match(source, /Review · Edit/);
  assert.match(source, /Loading this day’s records/);
  assert.match(source, /CalendarLegendItem/);
  assert.match(source, /selectedRecordCompact/);
});
