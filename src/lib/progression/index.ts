import type { LoadUnit, SetKind } from '../db/types.ts';

const POUNDS_TO_KG = 0.45359237;

export type ProgressionSet = {
  reps: number;
  loadValue: number;
  loadUnit: LoadUnit;
  rpe?: number | null;
  kind?: SetKind;
};

export type VolumeSet = ProgressionSet & {
  completedAt: string;
  movementPattern: string;
  primaryMuscleGroup: string;
  secondaryMuscleGroups: string[];
};

export type WeeklyVolume = {
  week: string;
  movementPatterns: Record<string, number>;
  muscleGroups: Record<string, number>;
  totalKg: number;
};

export type ProgressionSuggestion =
  | { action: 'start'; reason: string }
  | { action: 'hold'; loadValue: number; reason: string }
  | { action: 'add_reps'; loadValue: number; targetReps: number[]; reason: string }
  | { action: 'add_load'; loadValue: number; targetReps: number[]; reason: string };

export type DeloadSignal = {
  kind: 'none' | 'stagnation' | 'volume_drop';
  message: string;
};

export function loadToKg(value: number, unit: LoadUnit): number {
  return unit === 'lb' ? value * POUNDS_TO_KG : value;
}

export function calculateSetVolumeKg(set: ProgressionSet): number {
  if ((set.kind ?? 'working') !== 'working') return 0;
  return loadToKg(set.loadValue, set.loadUnit) * set.reps;
}

function isoWeekKey(value: string): string {
  const date = new Date(value);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function aggregateWeeklyVolume(sets: VolumeSet[]): WeeklyVolume[] {
  const weeks = new Map<string, WeeklyVolume>();
  for (const set of sets) {
    const volume = calculateSetVolumeKg(set);
    if (volume === 0) continue;
    const week = isoWeekKey(set.completedAt);
    const aggregate = weeks.get(week) ?? {
      week,
      movementPatterns: {},
      muscleGroups: {},
      totalKg: 0,
    };
    aggregate.totalKg += volume;
    aggregate.movementPatterns[set.movementPattern] =
      (aggregate.movementPatterns[set.movementPattern] ?? 0) + volume;
    aggregate.muscleGroups[set.primaryMuscleGroup] =
      (aggregate.muscleGroups[set.primaryMuscleGroup] ?? 0) + volume;
    for (const secondary of set.secondaryMuscleGroups) {
      aggregate.muscleGroups[secondary] = (aggregate.muscleGroups[secondary] ?? 0) + volume * 0.5;
    }
    weeks.set(week, aggregate);
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
}

export function suggestDoubleProgression(input: {
  sets: ProgressionSet[];
  repMin: number;
  repMax: number;
  loadIncrement: number;
  jointFlag?: boolean;
}): ProgressionSuggestion {
  const workingSets = input.sets.filter((set) => (set.kind ?? 'working') === 'working');
  if (workingSets.length === 0) {
    return { action: 'start', reason: `Start within ${input.repMin}-${input.repMax} controlled reps.` };
  }
  const loadValue = workingSets[0]?.loadValue ?? 0;
  if (input.jointFlag) {
    return { action: 'hold', loadValue, reason: 'Hold load while the joint flag is active.' };
  }
  if (workingSets.some((set) => (set.rpe ?? 0) > 9)) {
    return { action: 'hold', loadValue, reason: 'Hold load because the last effort exceeded RPE 9.' };
  }

  const allAtTop = workingSets.every((set) => set.reps >= input.repMax);
  if (allAtTop) {
    return {
      action: 'add_load',
      loadValue: loadValue + input.loadIncrement,
      targetReps: workingSets.map(() => input.repMin),
      reason: `Every working set reached ${input.repMax} reps; add the smallest load step.`,
    };
  }

  const targetReps = workingSets.map((set) => Math.min(input.repMax, set.reps));
  let lowestIndex = -1;
  let lowestReps = Number.POSITIVE_INFINITY;
  workingSets.forEach((set, index) => {
    if (set.reps < input.repMax && set.reps < lowestReps) {
      lowestIndex = index;
      lowestReps = set.reps;
    }
  });
  if (lowestIndex >= 0) targetReps[lowestIndex] = Math.min(input.repMax, targetReps[lowestIndex]! + 1);
  return {
    action: 'add_reps',
    loadValue,
    targetReps,
    reason: 'Keep the load and add one controlled rep to the lowest-rep set.',
  };
}

export function detectDeloadSignal(weeklyVolumes: number[]): DeloadSignal {
  if (weeklyVolumes.length < 2) {
    return { kind: 'none', message: 'More weekly history is needed.' };
  }
  const previous = weeklyVolumes.at(-2) ?? 0;
  const latest = weeklyVolumes.at(-1) ?? 0;
  if (previous > 0 && latest <= previous * 0.8) {
    return { kind: 'volume_drop', message: 'Weekly volume dropped by at least 20%; review recovery and intent.' };
  }
  if (weeklyVolumes.length >= 4) {
    const recent = weeklyVolumes.slice(-4);
    const changes = recent.slice(1).map((value, index) => {
      const base = recent[index] ?? 0;
      return base > 0 ? (value - base) / base : 0;
    });
    if (changes.every((change) => change < 0.02)) {
      return { kind: 'stagnation', message: 'Volume has not grown by 2% across three weekly transitions.' };
    }
  }
  return { kind: 'none', message: 'Volume trend is within the expected range.' };
}
