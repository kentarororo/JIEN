export function toLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shiftLocalDateKey(dateKey: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error('Date movement must use whole days.');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error('Choose a valid calendar date.');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  if (toLocalDateKey(date) !== dateKey) throw new Error('Choose a valid calendar date.');
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
}

export function historicalDateKey(value: string | undefined, today = toLocalDateKey()): string {
  if (!value || value > today) return today;
  try {
    return shiftLocalDateKey(value, 0);
  } catch {
    return today;
  }
}

export function localTimestampForDate(dateKey: string, clock: Date = new Date()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error('Choose a valid calendar date.');
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    clock.getHours(),
    clock.getMinutes(),
    clock.getSeconds(),
    clock.getMilliseconds(),
  );
  if (toLocalDateKey(date) !== dateKey) throw new Error('Choose a valid calendar date.');
  return date.toISOString();
}

export function localTimestampForDateAndTime(dateKey: string, time: string): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!dateMatch || !timeMatch) throw new Error('Use a valid date and 24-hour time, such as 18:30.');
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error('Use a valid 24-hour time, such as 18:30.');
  }
  const date = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    hours,
    minutes,
    0,
    0,
  );
  if (toLocalDateKey(date) !== dateKey) throw new Error('Choose a valid calendar date.');
  return date.toISOString();
}

export function startOfIsoWeek(date: Date = new Date()): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

export function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(
    new Date(value),
  );
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}
