import type { LoadUnit, SetKind } from './db/types';

const DRAFT_VERSION = 2;

export type RecoverableWorkoutDraft = {
  version: typeof DRAFT_VERSION;
  ownerUserId: string;
  workoutId: string;
  context: string;
  title: string;
  unit: LoadUnit;
  startedAt: string | null;
  updatedAt: string;
  restTimerSeconds: number;
  restEndsAt: number | null;
  blocks: Array<{
    exerciseId: string;
    sets: Array<{
      id?: string;
      load: string;
      reps: string;
      rpe: string;
      kind: SetKind;
      completed: boolean;
    }>;
  }>;
};

export type WorkoutEntrySet = {
  load: string;
  reps: string;
  rpe: string;
  kind?: SetKind;
  completed?: boolean;
};

export type WorkoutDraftSummary = {
  completedSetCount: number;
  needsAttentionCount: number;
  blankSetCount: number;
  work: number;
};

export function latestValidWorkoutLoad(sets: WorkoutEntrySet[]): string | null {
  for (let index = sets.length - 1; index >= 0; index -= 1) {
    const load = sets[index]!.load.trim();
    const numeric = Number(load);
    if (load && Number.isFinite(numeric) && numeric >= 0) return load;
  }
  return null;
}

export function fillBlankWorkoutLoads<T extends WorkoutEntrySet>(sets: T[]): {
  sets: T[];
  copiedLoad: string | null;
  filledCount: number;
} {
  const copiedLoad = sets.find((set) => {
    const load = set.load.trim();
    const numeric = Number(load);
    return load.length > 0 && Number.isFinite(numeric) && numeric >= 0;
  })?.load.trim() ?? null;
  if (copiedLoad == null) return { sets, copiedLoad: null, filledCount: 0 };
  let filledCount = 0;
  let previousValidLoad: string | null = null;
  const nextSets = sets.map((set) => {
    const load = set.load.trim();
    const numeric = Number(load);
    if (load.length > 0) {
      if (Number.isFinite(numeric) && numeric >= 0) previousValidLoad = load;
      return set;
    }
    filledCount += 1;
    return { ...set, load: previousValidLoad ?? copiedLoad };
  });
  return { copiedLoad, sets: nextSets, filledCount };
}

export function prefillWorkoutSetFromHistory<T extends WorkoutEntrySet>(
  existing: T,
  source: { load: string; reps: string; kind?: SetKind },
): T {
  if (existing.load.trim() || existing.reps.trim() || existing.rpe.trim()) return existing;
  return {
    ...existing,
    load: source.load,
    reps: source.reps,
    rpe: '',
    kind: source.kind ?? 'working',
    completed: false,
  };
}

export function summarizeWorkoutDraft(blocks: Array<{ sets: WorkoutEntrySet[] }>): WorkoutDraftSummary {
  const summary: WorkoutDraftSummary = { completedSetCount: 0, needsAttentionCount: 0, blankSetCount: 0, work: 0 };
  for (const { sets } of blocks) {
    for (const set of sets) {
      const loadText = set.load.trim();
      const repsText = set.reps.trim();
      const rpeText = set.rpe.trim();
      if (!loadText && !repsText && !rpeText) {
        summary.blankSetCount += 1;
        continue;
      }
      const load = Number(loadText);
      const reps = Number(repsText);
      const rpe = rpeText ? Number(rpeText) : null;
      const valid = loadText.length > 0
        && repsText.length > 0
        && Number.isFinite(load)
        && load >= 0
        && Number.isInteger(reps)
        && reps > 0
        && (rpe == null || (Number.isFinite(rpe) && rpe >= 1 && rpe <= 10));
      if (!valid) {
        summary.needsAttentionCount += 1;
        continue;
      }
      if (set.completed === false) {
        summary.needsAttentionCount += 1;
        continue;
      }
      summary.completedSetCount += 1;
      if ((set.kind ?? 'working') === 'working') summary.work += load * reps;
    }
  }
  return summary;
}

export function workoutDraftStorageKey(ownerUserId: string, context = 'default'): string {
  return `jien:workout-draft:v${DRAFT_VERSION}:${ownerUserId.toLowerCase()}:${encodeURIComponent(context)}`;
}

export function legacyWorkoutDraftStorageKey(ownerUserId: string, context = 'default'): string {
  return `jien:workout-draft:v1:${ownerUserId.toLowerCase()}:${encodeURIComponent(context)}`;
}

export function parseWorkoutDraft(
  value: string | null,
  ownerUserId: string,
  context: string,
): RecoverableWorkoutDraft | null {
  if (!value) return null;
  try {
    const draft = JSON.parse(value) as Omit<Partial<RecoverableWorkoutDraft>, 'version' | 'blocks'> & {
      version?: number;
      blocks?: unknown;
    };
    if ((draft.version !== 1 && draft.version !== DRAFT_VERSION)
      || draft.ownerUserId !== ownerUserId
      || draft.context !== context
      || typeof draft.workoutId !== 'string'
      || typeof draft.title !== 'string'
      || (draft.unit !== 'kg' && draft.unit !== 'lb')
      || (draft.startedAt != null && typeof draft.startedAt !== 'string')
      || typeof draft.updatedAt !== 'string'
      || !Array.isArray(draft.blocks)
      || draft.blocks.length > 40) return null;
    const blocks = draft.blocks.map((rawBlock) => {
      const block = rawBlock as Record<string, unknown> | null;
      if (!block || typeof block.exerciseId !== 'string' || !Array.isArray(block.sets) || block.sets.length > 50) {
        throw new Error('invalid draft block');
      }
      return {
        exerciseId: block.exerciseId,
        sets: block.sets.map((rawSet) => {
          const set = rawSet as Record<string, unknown> | null;
          if (!set || typeof set.load !== 'string' || typeof set.reps !== 'string' || typeof set.rpe !== 'string') {
            throw new Error('invalid draft set');
          }
          return {
            id: typeof set.id === 'string' ? set.id : undefined,
            load: set.load.slice(0, 20), reps: set.reps.slice(0, 20), rpe: set.rpe.slice(0, 20),
            kind: isSetKind(set.kind) ? set.kind : 'working',
            completed: draft.version === 1 ? false : set.completed === true,
          };
        }),
      };
    });
    return {
      ...draft,
      version: DRAFT_VERSION,
      restTimerSeconds: normalizeRestTimerSeconds(draft.restTimerSeconds),
      restEndsAt: typeof draft.restEndsAt === 'number' && Number.isFinite(draft.restEndsAt)
        ? draft.restEndsAt
        : null,
      blocks,
    } as RecoverableWorkoutDraft;
  } catch {
    return null;
  }
}

function isSetKind(value: unknown): value is SetKind {
  return value === 'working' || value === 'warmup' || value === 'drop' || value === 'failure';
}

export function normalizeRestTimerSeconds(value: unknown): number {
  return value === 60 || value === 90 || value === 120 || value === 180 ? value : 0;
}

export function workoutDraftContext(input: {
  date?: string;
  templateWorkoutId?: string;
  planWorkoutId?: string;
  editWorkoutId?: string;
}): string {
  if (input.editWorkoutId) return `edit:${input.editWorkoutId}`;
  if (input.planWorkoutId) return `plan:${input.planWorkoutId}`;
  if (input.templateWorkoutId) return `template:${input.templateWorkoutId}`;
  return `new:${input.date ?? 'today'}`;
}
