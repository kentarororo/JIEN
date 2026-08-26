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
  muscleGroupSets: Record<string, number>;
  totalKg: number;
};

export type MuscleGroupTrend = {
  muscleGroup: string;
  label: string;
  currentWeek: string;
  previousWeek: string | null;
  currentWorkKg: number;
  previousWorkKg: number;
  currentSetEquivalents: number;
  previousSetEquivalents: number;
  workChangePercent: number | null;
  activeWeeks: number;
  isPartialWeek: boolean;
  status: 'new' | 'up' | 'steady' | 'down' | 'inactive' | 'partial';
};

export const MUSCLE_GROUP_OPTIONS = [
  { value: 'chest', label: 'Chest', section: 'Chest' },
  { value: 'upper_chest', label: 'Upper chest', section: 'Chest' },
  { value: 'lats', label: 'Lats', section: 'Back' },
  { value: 'upper_back', label: 'Upper back (general)', section: 'Back' },
  { value: 'upper_traps', label: 'Upper traps', section: 'Back' },
  { value: 'middle_traps', label: 'Middle traps', section: 'Back' },
  { value: 'lower_traps', label: 'Lower traps', section: 'Back' },
  { value: 'rhomboids', label: 'Rhomboids', section: 'Back' },
  { value: 'lower_back', label: 'Spinal erectors / lower back', section: 'Back' },
  { value: 'front_delts', label: 'Front delts', section: 'Shoulders' },
  { value: 'side_delts', label: 'Side delts', section: 'Shoulders' },
  { value: 'rear_delts', label: 'Rear delts', section: 'Shoulders' },
  { value: 'rotator_cuff', label: 'Rotator cuff', section: 'Shoulders' },
  { value: 'biceps', label: 'Biceps', section: 'Arms' },
  { value: 'brachialis', label: 'Brachialis', section: 'Arms' },
  { value: 'triceps', label: 'Triceps', section: 'Arms' },
  { value: 'forearms', label: 'Forearms / grip', section: 'Arms' },
  { value: 'quads', label: 'Quadriceps', section: 'Legs' },
  { value: 'hamstrings', label: 'Hamstrings', section: 'Legs' },
  { value: 'glutes', label: 'Glutes', section: 'Legs' },
  { value: 'adductors', label: 'Adductors', section: 'Legs' },
  { value: 'hip_abductors', label: 'Hip abductors', section: 'Legs' },
  { value: 'hip_flexors', label: 'Hip flexors', section: 'Legs' },
  { value: 'calves', label: 'Calves', section: 'Legs' },
  { value: 'tibialis_anterior', label: 'Tibialis anterior', section: 'Legs' },
  { value: 'abs', label: 'Abs', section: 'Trunk' },
  { value: 'obliques', label: 'Obliques', section: 'Trunk' },
  { value: 'core', label: 'Core (general)', section: 'Trunk' },
  { value: 'serratus_anterior', label: 'Serratus anterior', section: 'Trunk' },
  { value: 'neck', label: 'Neck', section: 'Other' },
] as const;

export const MUSCLE_GROUP_SECTIONS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Trunk', 'Other'] as const;

export type ProgressionSuggestion =
  | { action: 'start'; reason: string }
  | { action: 'hold'; loadValue: number; reason: string }
  | { action: 'add_reps'; loadValue: number; targetReps: number[]; reason: string }
  | { action: 'add_load'; loadValue: number; targetReps: number[]; reason: string };

export type SetProgressionCue = {
  workingSetIndex: number;
  action: 'add_reps' | 'add_load';
  loadValue: number;
  targetReps: number;
  changePercent: number | null;
  label: string;
};

export type SetProgressionPlan = {
  action: 'start' | 'hold' | 'add_reps' | 'add_load';
  reason: string;
  cues: SetProgressionCue[];
};

export type CompletedExerciseVolumeFeedback = {
  status: 'baseline' | 'hold' | 'target_reached' | 'progress';
  targetPercent: number;
  currentVolumeKg: number;
  previousVolumeKg: number | null;
  targetVolumeKg: number | null;
  changePercent: number | null;
  projectedChangePercent: number | null;
  cueTiming: 'current_session' | 'next_session' | null;
  reason: string;
  cues: SetProgressionCue[];
};

export type DeloadSignal = {
  kind: 'none' | 'stagnation' | 'volume_drop';
  message: string;
};

export const STORED_JOINT_CONSIDERATION_HOLD_REASON =
  'A saved joint or injury consideration is active. Previous sets remain visible, but no load or rep increase is suggested.';

export function loadToKg(value: number, unit: LoadUnit): number {
  return unit === 'lb' ? value * POUNDS_TO_KG : value;
}

export function calculateSetVolumeKg(set: ProgressionSet): number {
  if ((set.kind ?? 'working') !== 'working') return 0;
  return loadToKg(set.loadValue, set.loadUnit) * set.reps;
}

export function calculateOverloadChangePercent(currentVolumeKg: number, previousVolumeKg: number): number | null {
  if (!Number.isFinite(currentVolumeKg) || !Number.isFinite(previousVolumeKg) || previousVolumeKg <= 0) return null;
  return ((currentVolumeKg - previousVolumeKg) / previousVolumeKg) * 100;
}

export function isoWeekKey(value: string): string {
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
    if ((set.kind ?? 'working') !== 'working') continue;
    const volume = calculateSetVolumeKg(set);
    const week = isoWeekKey(set.completedAt);
    const aggregate = weeks.get(week) ?? {
      week,
      movementPatterns: {},
      muscleGroups: {},
      muscleGroupSets: {},
      totalKg: 0,
    };
    const primary = normalizeMuscleGroupKey(set.primaryMuscleGroup);
    const secondaryGroups = [...new Set(set.secondaryMuscleGroups.map(normalizeMuscleGroupKey))]
      .filter((secondary) => secondary !== primary);
    aggregate.totalKg += volume;
    aggregate.movementPatterns[set.movementPattern] =
      (aggregate.movementPatterns[set.movementPattern] ?? 0) + volume;
    aggregate.muscleGroups[primary] = (aggregate.muscleGroups[primary] ?? 0) + volume;
    aggregate.muscleGroupSets[primary] = (aggregate.muscleGroupSets[primary] ?? 0) + 1;
    for (const secondary of secondaryGroups) {
      aggregate.muscleGroups[secondary] = (aggregate.muscleGroups[secondary] ?? 0) + volume * 0.5;
      aggregate.muscleGroupSets[secondary] = (aggregate.muscleGroupSets[secondary] ?? 0) + 0.5;
    }
    weeks.set(week, aggregate);
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
}

export function buildMuscleGroupTrends(
  weeks: WeeklyVolume[],
  lookbackWeeks = 4,
  asOf = new Date(),
): MuscleGroupTrend[] {
  const recent = weeks.slice(-Math.max(2, lookbackWeeks));
  const current = recent.at(-1);
  if (!current) return [];
  const previous = recent.at(-2) ?? null;
  const isPartialWeek = current.week === isoWeekKey(asOf.toISOString());
  const groups = new Set<string>();
  for (const week of recent) {
    Object.keys(week.muscleGroupSets).forEach((group) => groups.add(group));
    Object.keys(week.muscleGroups).forEach((group) => groups.add(group));
  }
  return [...groups].map((muscleGroup): MuscleGroupTrend => {
    const currentWorkKg = current.muscleGroups[muscleGroup] ?? 0;
    const previousWorkKg = previous?.muscleGroups[muscleGroup] ?? 0;
    const currentSetEquivalents = current.muscleGroupSets[muscleGroup] ?? 0;
    const previousSetEquivalents = previous?.muscleGroupSets[muscleGroup] ?? 0;
    const workChangePercent = calculateOverloadChangePercent(currentWorkKg, previousWorkKg);
    const status = currentSetEquivalents <= 0
      ? isPartialWeek && previousSetEquivalents > 0 ? 'partial' : 'inactive'
      : previousSetEquivalents <= 0
        ? 'new'
        : isPartialWeek && (workChangePercent == null || workChangePercent < 2)
          ? 'partial'
          : workChangePercent != null && workChangePercent <= -20
          ? 'down'
          : workChangePercent != null && workChangePercent >= 2
            ? 'up'
            : 'steady';
    return {
      muscleGroup,
      label: muscleGroupLabel(muscleGroup),
      currentWeek: current.week,
      previousWeek: previous?.week ?? null,
      currentWorkKg,
      previousWorkKg,
      currentSetEquivalents,
      previousSetEquivalents,
      workChangePercent,
      activeWeeks: recent.filter((week) => (week.muscleGroupSets[muscleGroup] ?? 0) > 0).length,
      isPartialWeek,
      status,
    };
  }).sort((a, b) => b.currentSetEquivalents - a.currentSetEquivalents
    || b.activeWeeks - a.activeWeeks
    || a.label.localeCompare(b.label));
}

export function normalizeMuscleGroupKey(value: string): string {
  const clean = value.trim().toLocaleLowerCase().replaceAll(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (clean === 'quadriceps') return 'quads';
  if (clean === 'shoulders') return 'front_delts';
  if (clean === 'traps' || clean === 'trapezius') return 'upper_traps';
  if (clean === 'mid_traps') return 'middle_traps';
  if (clean === 'external_rotators') return 'rotator_cuff';
  if (clean === 'erectors' || clean === 'spinal_erectors') return 'lower_back';
  return clean || 'other';
}

export function muscleGroupLabel(value: string): string {
  const normalized = normalizeMuscleGroupKey(value);
  return MUSCLE_GROUP_OPTIONS.find((option) => option.value === normalized)?.label
    ?? normalized.replaceAll('_', ' ').replace(/^./, (character) => character.toLocaleUpperCase());
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
    return {
      action: 'hold',
      loadValue,
      reason: STORED_JOINT_CONSIDERATION_HOLD_REASON,
    };
  }
  if (workingSets.some((set) => (set.rpe ?? 0) > 9)) {
    return { action: 'hold', loadValue, reason: 'Hold load because the last effort exceeded RPE 9.' };
  }

  const allAtTop = workingSets.every((set) => set.reps >= input.repMax);
  const hasCompleteEffort = workingSets.every((set) => set.rpe != null && Number.isFinite(set.rpe));
  if (allAtTop && !hasCompleteEffort) {
    return {
      action: 'hold',
      loadValue,
      reason: 'Repeat this load or add effort ratings before increasing it.',
    };
  }
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

/**
 * Builds an explainable, per-set overlay from the last completed exposure.
 * It never mutates or replaces the recorded sets; callers decide whether to apply a cue.
 */
export function buildSetProgressionPlan(input: {
  sets: ProgressionSet[];
  repMin: number;
  repMax: number;
  loadIncrement: number;
  jointFlag?: boolean;
}): SetProgressionPlan {
  const workingSets = input.sets.filter((set) => (set.kind ?? 'working') === 'working');
  if (workingSets.length === 0) {
    return {
      action: 'start',
      reason: `Start within ${input.repMin}-${input.repMax} controlled reps.`,
      cues: [],
    };
  }
  if (workingSets.some((set) => !Number.isFinite(set.loadValue) || !Number.isFinite(set.reps) || set.reps <= 0)) {
    return { action: 'hold', reason: 'Complete every load and rep field before progressing.', cues: [] };
  }
  if (input.jointFlag) {
    return {
      action: 'hold',
      reason: STORED_JOINT_CONSIDERATION_HOLD_REASON,
      cues: [],
    };
  }
  if (workingSets.some((set) => set.rpe != null && set.rpe > 9)) {
    return { action: 'hold', reason: 'Repeat the work: at least one set exceeded RPE 9.', cues: [] };
  }

  const allAtTop = workingSets.every((set) => set.reps >= input.repMax);
  const hasCompleteEffort = workingSets.every((set) => set.rpe != null && Number.isFinite(set.rpe));
  if (allAtTop && !hasCompleteEffort) {
    return {
      action: 'hold',
      reason: 'All sets reached the rep ceiling. Add RPE estimates next time before increasing load.',
      cues: [],
    };
  }
  if (allAtTop) {
    return {
      action: 'add_load',
      reason: `All ${workingSets.length} sets reached ${input.repMax} reps at RPE 9 or below.`,
      cues: workingSets.map((set, workingSetIndex) => {
        const loadValue = set.loadValue + input.loadIncrement;
        const changePercent = set.loadValue > 0 ? (input.loadIncrement / set.loadValue) * 100 : null;
        return {
          workingSetIndex,
          action: 'add_load' as const,
          loadValue,
          targetReps: input.repMin,
          changePercent,
          label: changePercent == null
            ? `Try ${formatProgressionNumber(loadValue)} ${set.loadUnit} x ${input.repMin}`
            : `Try ${formatProgressionNumber(loadValue)} ${set.loadUnit} x ${input.repMin} · +${formatProgressionNumber(changePercent)}% load`,
        };
      }),
    };
  }

  let lowestIndex = -1;
  let lowestReps = Number.POSITIVE_INFINITY;
  workingSets.forEach((set, index) => {
    if (set.reps < input.repMax && set.reps < lowestReps) {
      lowestIndex = index;
      lowestReps = set.reps;
    }
  });
  if (lowestIndex < 0) {
    return { action: 'hold', reason: 'Repeat the last completed sets.', cues: [] };
  }
  const set = workingSets[lowestIndex]!;
  return {
    action: 'add_reps',
    reason: 'Keep every load the same and add one controlled rep to the lowest-rep set.',
    cues: [{
      workingSetIndex: lowestIndex,
      action: 'add_reps',
      loadValue: set.loadValue,
      targetReps: Math.min(input.repMax, set.reps + 1),
      changePercent: null,
      label: `Try ${formatProgressionNumber(set.loadValue)} ${set.loadUnit} x ${Math.min(input.repMax, set.reps + 1)} · +1 rep`,
    }],
  };
}

/**
 * Reviews a completed exercise against its latest completed exposure.
 * The five-percent target is a guide; safe double progression determines
 * the smallest opt-in change and logged sets are never mutated here.
 */
export function buildCompletedExerciseVolumeFeedback(input: {
  currentSets: ProgressionSet[];
  previousSets?: ProgressionSet[] | null;
  repMin: number;
  repMax: number;
  loadIncrement: number;
  jointFlag?: boolean;
  targetPercent?: number;
}): CompletedExerciseVolumeFeedback {
  const requestedTargetPercent = input.targetPercent;
  const targetPercent = requestedTargetPercent != null && Number.isFinite(requestedTargetPercent) && requestedTargetPercent > 0
    ? requestedTargetPercent
    : 5;
  const currentSets = input.currentSets.filter((set) => (set.kind ?? 'working') === 'working');
  const currentVolumeKg = currentSets.reduce((total, set) => total + calculateSetVolumeKg(set), 0);
  const previousSets = (input.previousSets ?? []).filter((set) => (set.kind ?? 'working') === 'working');
  const previousVolumeKg = previousSets.length > 0
    ? previousSets.reduce((total, set) => total + calculateSetVolumeKg(set), 0)
    : null;
  const hasInvalidCurrentSet = currentSets.length === 0 || currentSets.some((set) => (
    !Number.isFinite(set.loadValue)
    || set.loadValue < 0
    || !Number.isFinite(set.reps)
    || set.reps <= 0
  ));

  if (hasInvalidCurrentSet) {
    return {
      status: 'hold',
      targetPercent,
      currentVolumeKg,
      previousVolumeKg,
      targetVolumeKg: previousVolumeKg != null && previousVolumeKg > 0
        ? previousVolumeKg * (1 + targetPercent / 100)
        : null,
      changePercent: previousVolumeKg != null
        ? calculateOverloadChangePercent(currentVolumeKg, previousVolumeKg)
        : null,
      projectedChangePercent: null,
      cueTiming: null,
      reason: 'Complete every load and rep field before reviewing progression.',
      cues: [],
    };
  }

  if (previousVolumeKg == null || previousVolumeKg <= 0) {
    return {
      status: 'baseline',
      targetPercent,
      currentVolumeKg,
      previousVolumeKg: null,
      targetVolumeKg: null,
      changePercent: null,
      projectedChangePercent: null,
      cueTiming: null,
      reason: 'Baseline saved. The next completed exposure can be compared with this work.',
      cues: [],
    };
  }

  const targetVolumeKg = previousVolumeKg * (1 + targetPercent / 100);
  const changePercent = calculateOverloadChangePercent(currentVolumeKg, previousVolumeKg);
  if (input.jointFlag || currentSets.some((set) => set.rpe != null && set.rpe > 9)) {
    const hold = buildSetProgressionPlan({
      sets: currentSets,
      repMin: input.repMin,
      repMax: input.repMax,
      loadIncrement: input.loadIncrement,
      jointFlag: input.jointFlag,
    });
    return {
      status: 'hold',
      targetPercent,
      currentVolumeKg,
      previousVolumeKg,
      targetVolumeKg,
      changePercent,
      projectedChangePercent: null,
      cueTiming: null,
      reason: hold.reason,
      cues: [],
    };
  }
  if (currentVolumeKg >= targetVolumeKg) {
    return {
      status: 'target_reached',
      targetPercent,
      currentVolumeKg,
      previousVolumeKg,
      targetVolumeKg,
      changePercent,
      projectedChangePercent: changePercent,
      cueTiming: null,
      reason: `Volume is at least ${formatProgressionNumber(targetPercent)}% above the latest completed exposure.`,
      cues: [],
    };
  }

  const plan = buildSetProgressionPlan({
    sets: currentSets,
    repMin: input.repMin,
    repMax: input.repMax,
    loadIncrement: input.loadIncrement,
    jointFlag: input.jointFlag,
  });
  if (plan.cues.length === 0) {
    return {
      status: 'hold',
      targetPercent,
      currentVolumeKg,
      previousVolumeKg,
      targetVolumeKg,
      changePercent,
      projectedChangePercent: null,
      cueTiming: null,
      reason: plan.reason,
      cues: [],
    };
  }

  const projectedSets = currentSets.map((set, workingSetIndex) => {
    const cue = plan.cues.find((candidate) => candidate.workingSetIndex === workingSetIndex);
    return cue == null ? set : { ...set, loadValue: cue.loadValue, reps: cue.targetReps };
  });
  const projectedVolumeKg = projectedSets.reduce((total, set) => total + calculateSetVolumeKg(set), 0);
  return {
    status: 'progress',
    targetPercent,
    currentVolumeKg,
    previousVolumeKg,
    targetVolumeKg,
    changePercent,
    projectedChangePercent: calculateOverloadChangePercent(projectedVolumeKg, previousVolumeKg),
    cueTiming: 'next_session',
    reason: plan.action === 'add_load'
      ? 'The rep ceiling is complete. Use the smallest load step at the bottom of the rep range next session.'
      : 'One controlled rep next time is the smallest safe step toward the volume guide.',
    cues: plan.cues,
  };
}

function formatProgressionNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
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
