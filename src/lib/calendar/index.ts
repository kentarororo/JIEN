import { toLocalDateKey } from '../time.ts';

export type MonthCell = {
  date: Date;
  dateKey: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
};

export type CalendarDayActivation = {
  dateKey: string;
  activatedAt: number;
};

export function isRepeatedCalendarDayActivation(
  previous: CalendarDayActivation | null,
  next: CalendarDayActivation,
  thresholdMs = 450,
): boolean {
  return previous?.dateKey === next.dateKey
    && next.activatedAt >= previous.activatedAt
    && next.activatedAt - previous.activatedAt <= thresholdMs;
}

export function buildMonthGrid(month: Date, today = new Date()): MonthCell[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return {
      date,
      dateKey: toLocalDateKey(date),
      dayNumber: date.getDate(),
      isCurrentMonth: date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear(),
      isToday: toLocalDateKey(date) === toLocalDateKey(today),
    };
  });
}

export function moveMonth(month: Date, delta: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + delta, 1);
}

export function moveMonthSelection(month: Date, selectedDate: string, delta: number): { month: Date; dateKey: string } {
  const nextMonth = moveMonth(month, delta);
  const requestedDay = Number(selectedDate.slice(-2));
  const lastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
  const safeDay = Number.isInteger(requestedDay) && requestedDay > 0 ? Math.min(requestedDay, lastDay) : 1;
  return {
    month: nextMonth,
    dateKey: toLocalDateKey(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), safeDay)),
  };
}

export function calendarSelectionForDate(dateKey: string): { month: Date; dateKey: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) return null;
  return {
    month: new Date(year, monthIndex, 1),
    dateKey: toLocalDateKey(date),
  };
}
