import type { LoadUnit } from './db/types';

const DRAFT_VERSION = 1;

export type RecoverableWorkoutDraft = {
  version: typeof DRAFT_VERSION;
  ownerUserId: string;
  workoutId: string;
  context: string;
  title: string;
  unit: LoadUnit;
  startedAt: string | null;
  updatedAt: string;
  blocks: Array<{
    exerciseId: string;
    sets: Array<{ id?: string; load: string; reps: string; rpe: string }>;
  }>;
};

export function workoutDraftStorageKey(ownerUserId: string, context = 'default'): string {
  return `jien:workout-draft:v${DRAFT_VERSION}:${ownerUserId.toLowerCase()}:${encodeURIComponent(context)}`;
}

export function parseWorkoutDraft(
  value: string | null,
  ownerUserId: string,
  context: string,
): RecoverableWorkoutDraft | null {
  if (!value) return null;
  try {
    const draft = JSON.parse(value) as Partial<RecoverableWorkoutDraft>;
    if (draft.version !== DRAFT_VERSION
      || draft.ownerUserId !== ownerUserId
      || draft.context !== context
      || typeof draft.workoutId !== 'string'
      || typeof draft.title !== 'string'
      || (draft.unit !== 'kg' && draft.unit !== 'lb')
      || (draft.startedAt != null && typeof draft.startedAt !== 'string')
      || typeof draft.updatedAt !== 'string'
      || !Array.isArray(draft.blocks)
      || draft.blocks.length > 40) return null;
    const blocks = draft.blocks.map((block) => {
      if (!block || typeof block.exerciseId !== 'string' || !Array.isArray(block.sets) || block.sets.length > 50) {
        throw new Error('invalid draft block');
      }
      return {
        exerciseId: block.exerciseId,
        sets: block.sets.map((set) => {
          if (!set || typeof set.load !== 'string' || typeof set.reps !== 'string' || typeof set.rpe !== 'string') {
            throw new Error('invalid draft set');
          }
          return {
            id: typeof set.id === 'string' ? set.id : undefined,
            load: set.load.slice(0, 20), reps: set.reps.slice(0, 20), rpe: set.rpe.slice(0, 20),
          };
        }),
      };
    });
    return { ...draft, blocks } as RecoverableWorkoutDraft;
  } catch {
    return null;
  }
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
