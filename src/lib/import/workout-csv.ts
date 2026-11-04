import type { LoadUnit, SetKind } from '../db/types.ts';

export type WorkoutImportSource = 'hevy' | 'strong';

export type ImportedWorkoutSet = {
  exerciseName: string;
  setOrder: number;
  kind: SetKind;
  reps: number;
  loadValue: number;
  loadUnit: LoadUnit;
  rpe: number | null;
};

export type ImportedWorkout = {
  sourceKey: string;
  title: string;
  startedAt: string;
  performedOn: string;
  notes: string | null;
  sets: ImportedWorkoutSet[];
};

export type WorkoutImportPreview = {
  source: WorkoutImportSource;
  workouts: ImportedWorkout[];
  workoutCount: number;
  setCount: number;
  firstDate: string;
  lastDate: string;
  exerciseNames: string[];
};

export class WorkoutCsvError extends Error {}

export function parseWorkoutCsv(csv: string): WorkoutImportPreview {
  const table = parseCsvTable(csv.replace(/^\uFEFF/, ''));
  if (table.length < 2) throw new WorkoutCsvError('This CSV does not contain any workout rows.');
  const rawHeaders = table[0]!.map((value) => value.trim());
  const headers = rawHeaders.map(normalizeHeader);
  const source = detectSource(headers);
  const rows = table.slice(1).filter((row) => row.some((value) => value.trim()));
  const workouts = new Map<string, ImportedWorkout>();

  for (const row of rows) {
    const get = (...aliases: string[]) => valueFor(row, headers, aliases);
    const title = source === 'hevy' ? get('title', 'workout_title') : get('workout_name', 'workout');
    const exerciseName = source === 'hevy' ? get('exercise_title', 'exercise_name') : get('exercise_name', 'exercise');
    const rawStartedAt = source === 'hevy' ? get('start_time', 'date') : get('date', 'start_time');
    const reps = parsePositiveInteger(get('reps', 'repetitions'));
    if (!exerciseName || !rawStartedAt || reps == null) continue;
    const parsedDate = parseWorkoutDate(rawStartedAt);
    if (!parsedDate) throw new WorkoutCsvError(`A workout has an unsupported date: ${rawStartedAt}`);
    const load = parseLoad(row, headers, source);
    const setOrder = parseNonNegativeInteger(get('set_index', 'set_order', 'set')) ?? 0;
    const sourceKey = `${source}\u001f${rawStartedAt.trim()}\u001f${title.trim() || 'Workout'}`;
    const workout = workouts.get(sourceKey) ?? {
      sourceKey,
      title: title.trim() || 'Imported workout',
      startedAt: parsedDate.startedAt,
      performedOn: parsedDate.performedOn,
      notes: nullable(source === 'hevy' ? get('description', 'workout_notes') : get('workout_notes', 'notes')),
      sets: [],
    };
    workout.sets.push({
      exerciseName: exerciseName.trim(),
      setOrder,
      kind: parseSetKind(get('set_type', 'type')),
      reps,
      loadValue: load.value,
      loadUnit: load.unit,
      rpe: parseRpe(get('rpe')),
    });
    workouts.set(sourceKey, workout);
  }

  const parsed = [...workouts.values()]
    .filter((workout) => workout.sets.length > 0)
    .map((workout) => ({ ...workout, sets: workout.sets.sort((a, b) => a.setOrder - b.setOrder) }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (!parsed.length) throw new WorkoutCsvError('No completed strength sets were found in this CSV.');
  const exerciseNames = [...new Set(parsed.flatMap((workout) => workout.sets.map((set) => set.exerciseName)))].sort((a, b) => a.localeCompare(b));
  return {
    source,
    workouts: parsed,
    workoutCount: parsed.length,
    setCount: parsed.reduce((sum, workout) => sum + workout.sets.length, 0),
    firstDate: parsed[0]!.performedOn,
    lastDate: parsed.at(-1)!.performedOn,
    exerciseNames,
  };
}

export function autoMatchImportedExercises(importedNames: readonly string[], catalogue: readonly { id: string; name: string }[]): Record<string, string> {
  const exact = new Map(catalogue.map((exercise) => [canonicalExerciseName(exercise.name), exercise.id]));
  const result: Record<string, string> = {};
  for (const importedName of importedNames) {
    const match = exact.get(canonicalExerciseName(importedName));
    if (match) result[importedName] = match;
  }
  return result;
}

export function importedExerciseSearchText(value: string): string {
  return value.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

export function deterministicImportUuid(value: string): string {
  const chunks = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].map((seed) => fnv1a(value, seed).toString(16).padStart(8, '0'));
  const hex = chunks.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

function detectSource(headers: string[]): WorkoutImportSource {
  if (headers.includes('exercise_title') && (headers.includes('start_time') || headers.includes('title'))) return 'hevy';
  if (headers.includes('exercise_name') && (headers.includes('workout_name') || headers.includes('date'))) return 'strong';
  throw new WorkoutCsvError('Unknown workout CSV format. Choose a workout export from Hevy or Strong.');
}

function parseCsvTable(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]!;
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && csv[index + 1] === '\n') index += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += character;
  }
  if (quoted) throw new WorkoutCsvError('This CSV has an unfinished quoted value.');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseLoad(row: string[], headers: string[], source: WorkoutImportSource): { value: number; unit: LoadUnit } {
  const pounds = valueFor(row, headers, ['weight_lbs', 'weight_lb', 'load_lbs']);
  if (pounds) return { value: parseNonNegativeNumber(pounds), unit: 'lb' };
  const kilograms = valueFor(row, headers, ['weight_kg', 'load_kg']);
  if (kilograms) return { value: parseNonNegativeNumber(kilograms), unit: 'kg' };
  const raw = valueFor(row, headers, ['weight', 'load']);
  const declaredUnit = valueFor(row, headers, ['weight_unit', 'unit']).toLowerCase();
  const unit: LoadUnit = declaredUnit.includes('lb') || /\blbs?\b/i.test(raw) ? 'lb' : 'kg';
  const value = parseNonNegativeNumber(raw.replace(/\s*(kg|lbs?)\s*$/i, ''));
  // Strong's direct English export uses kilograms when no unit column is present.
  return { value, unit: source === 'strong' && !declaredUnit && !/\blbs?\b/i.test(raw) ? 'kg' : unit };
}

function parseWorkoutDate(raw: string): { startedAt: string; performedOn: string } | null {
  const trimmed = raw.trim();
  const isoLike = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i.exec(trimmed);
  if (isoLike) {
    const performedOn = `${isoLike[1]}-${isoLike[2]}-${isoLike[3]}`;
    if (!isCalendarDate(performedOn)) return null;
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
    const localIso = `${performedOn}T${isoLike[4] ?? '12'}:${isoLike[5] ?? '00'}:${isoLike[6] ?? '00'}`;
    const date = new Date(hasZone ? trimmed : localIso);
    return Number.isFinite(date.getTime()) ? { startedAt: date.toISOString(), performedOn } : null;
  }
  const date = new Date(trimmed);
  if (!Number.isFinite(date.getTime())) return null;
  const performedOn = localDateKey(date);
  return { startedAt: date.toISOString(), performedOn };
}

function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year!, month! - 1, day!, 12);
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseSetKind(raw: string): SetKind {
  const value = raw.trim().toLowerCase();
  if (['warmup', 'warm-up', 'warm up', 'w'].includes(value)) return 'warmup';
  if (['drop', 'drop_set', 'dropset', 'd'].includes(value)) return 'drop';
  if (['failure', 'to_failure', 'f'].includes(value)) return 'failure';
  return 'working';
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\(([^)]*)\)/g, '_$1').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function normalizeExerciseName(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function canonicalExerciseName(value: string): string {
  return normalizeExerciseName(value).split(' ').filter(Boolean).sort().join(' ');
}

function valueFor(row: string[], headers: string[], aliases: string[]): string {
  for (const alias of aliases) {
    const index = headers.indexOf(alias);
    if (index >= 0) return row[index]?.trim() ?? '';
  }
  return '';
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNonNegativeNumber(value: string): number {
  if (!value.trim()) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new WorkoutCsvError(`A set has an invalid weight: ${value}`);
  return parsed;
}

function parseRpe(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 10 ? parsed : null;
}

function nullable(value: string): string | null {
  return value.trim() || null;
}

function fnv1a(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
