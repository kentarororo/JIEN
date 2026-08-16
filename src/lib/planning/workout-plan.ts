import type {
  Exercise,
  LoadUnit,
  PlannedWorkoutExercise,
  PlannedWorkoutPlan,
  WorkoutSet,
} from '../db/types.ts';
import {
  buildSetProgressionPlan,
  STORED_JOINT_CONSIDERATION_HOLD_REASON,
} from '../progression/index.ts';

const DEFAULT_WORKING_SETS = 3;

/**
 * Onboarding currently stores joint and injury considerations as free-form
 * profile notes. Until those notes have an explicit exercise-level scope, a
 * non-empty consideration conservatively pauses numeric progression cues.
 */
export function hasStoredJointConsideration(flags: string[] | null | undefined): boolean {
  return flags?.some((flag) => flag.trim().length > 0) ?? false;
}

/** Apply a current profile hold to a previously saved plan without mutating it. */
export function applyStoredJointConsiderationHold(
  plan: PlannedWorkoutPlan | null,
  active: boolean,
): PlannedWorkoutPlan | null {
  if (!plan || !active) return plan;
  return {
    ...plan,
    exercises: plan.exercises.map((exercise) => {
      const hasPreviousValues = exercise.sets.some(
        (set) => set.loadValue != null || set.reps != null,
      );
      if (!hasPreviousValues) return exercise;
      return {
        ...exercise,
        progression: {
          action: 'hold',
          reason: STORED_JOINT_CONSIDERATION_HOLD_REASON,
          cues: [],
        },
      };
    }),
  };
}

export function buildPlannedWorkoutExercise(input: {
  exercise: Exercise;
  history: WorkoutSet[];
  preferredLoadUnit: LoadUnit;
  jointFlag?: boolean;
}): PlannedWorkoutExercise {
  const history = input.history.filter((set) => set.kind === 'working');
  const loadUnit = history[0]?.loadUnit ?? input.preferredLoadUnit;
  const progression = buildSetProgressionPlan({
    sets: history,
    repMin: input.exercise.targetRepMin,
    repMax: input.exercise.targetRepMax,
    loadIncrement: loadUnit === 'lb'
      ? Math.max(5, input.exercise.loadIncrement)
      : input.exercise.loadIncrement,
    jointFlag: input.jointFlag,
  });

  return {
    exerciseId: input.exercise.id,
    exerciseName: input.exercise.name,
    primaryMuscleGroup: input.exercise.primaryMuscleGroup,
    targetRepMin: input.exercise.targetRepMin,
    targetRepMax: input.exercise.targetRepMax,
    sets: history.length
      ? history.map((set) => ({
        loadValue: set.loadValue,
        loadUnit: set.loadUnit,
        reps: set.reps,
      }))
      : Array.from({ length: DEFAULT_WORKING_SETS }, () => ({
        loadValue: null,
        loadUnit,
        reps: null,
      })),
    progression,
  };
}

export function parsePlannedWorkoutPlan(value: unknown): PlannedWorkoutPlan | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.exercises)) return null;
  const exercises = parsed.exercises.map(parseExercise);
  return exercises.every((exercise): exercise is PlannedWorkoutExercise => exercise != null)
    ? { version: 1, exercises }
    : null;
}

function parseExercise(value: unknown): PlannedWorkoutExercise | null {
  if (!isRecord(value)
    || !isNonEmptyString(value.exerciseId)
    || !isNonEmptyString(value.exerciseName)
    || !isNonEmptyString(value.primaryMuscleGroup)
    || !isPositiveInteger(value.targetRepMin)
    || !isPositiveInteger(value.targetRepMax)
    || value.targetRepMax < value.targetRepMin
    || !Array.isArray(value.sets)
    || value.sets.length === 0
    || !isRecord(value.progression)) return null;

  const sets = value.sets.map((set) => {
    if (!isRecord(set)
      || (set.loadUnit !== 'kg' && set.loadUnit !== 'lb')
      || !isNullableNonNegativeNumber(set.loadValue)
      || !isNullablePositiveInteger(set.reps)) return null;
    return { loadValue: set.loadValue, loadUnit: set.loadUnit, reps: set.reps };
  });
  if (sets.some((set) => set == null)) return null;

  const progression = value.progression;
  if (!isProgressionAction(progression.action)
    || !isNonEmptyString(progression.reason)
    || !Array.isArray(progression.cues)) return null;
  const cues = progression.cues.map((cue) => {
    if (!isRecord(cue)
      || !Number.isInteger(cue.workingSetIndex)
      || Number(cue.workingSetIndex) < 0
      || (cue.action !== 'add_reps' && cue.action !== 'add_load')
      || !isNonNegativeNumber(cue.loadValue)
      || !isPositiveInteger(cue.targetReps)
      || !(cue.changePercent == null || isFiniteNumber(cue.changePercent))
      || !isNonEmptyString(cue.label)) return null;
    return {
      workingSetIndex: Number(cue.workingSetIndex),
      action: cue.action,
      loadValue: cue.loadValue,
      targetReps: cue.targetReps,
      changePercent: cue.changePercent,
      label: cue.label,
    };
  });
  if (cues.some((cue) => cue == null)) return null;

  return {
    exerciseId: value.exerciseId,
    exerciseName: value.exerciseName,
    primaryMuscleGroup: value.primaryMuscleGroup,
    targetRepMin: value.targetRepMin,
    targetRepMax: value.targetRepMax,
    sets: sets as PlannedWorkoutExercise['sets'],
    progression: {
      action: progression.action,
      reason: progression.reason,
      cues: cues as PlannedWorkoutExercise['progression']['cues'],
    },
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || isNonNegativeNumber(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isNullablePositiveInteger(value: unknown): value is number | null {
  return value === null || isPositiveInteger(value);
}

function isProgressionAction(value: unknown): value is PlannedWorkoutExercise['progression']['action'] {
  return value === 'start' || value === 'hold' || value === 'add_reps' || value === 'add_load';
}
