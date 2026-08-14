import type {
  MealPhotoAnalysisFailure,
  MealPhotoCapability,
} from './db/meal-photo-api';

export type PendingMealPhoto = {
  base64: string;
  mediaType: string;
  sourceLabel: string;
};

export type MealPhotoFlowState = {
  phase: 'idle' | 'ready' | 'analyzing' | 'failed' | 'succeeded';
  selection: PendingMealPhoto | null;
  description: string;
  capability: MealPhotoCapability | null;
  failure: MealPhotoAnalysisFailure | null;
  result: { requestId: string; itemCount: number; itemKeys: string[] } | null;
};

export type MealPhotoFlowEvent =
  | { type: 'selected'; selection: PendingMealPhoto }
  | { type: 'description_changed'; description: string }
  | { type: 'capability_checking' }
  | { type: 'capability_resolved'; capability: MealPhotoCapability }
  | { type: 'analysis_started' }
  | { type: 'analysis_failed'; failure: MealPhotoAnalysisFailure }
  | { type: 'analysis_succeeded'; requestId: string; itemKeys: string[] }
  | { type: 'dismissed' };

export const initialMealPhotoFlowState: MealPhotoFlowState = {
  phase: 'idle',
  selection: null,
  description: '',
  capability: null,
  failure: null,
  result: null,
};

export function reduceMealPhotoFlow(
  state: MealPhotoFlowState,
  event: MealPhotoFlowEvent,
): MealPhotoFlowState {
  switch (event.type) {
    case 'selected':
      return {
        phase: 'ready',
        selection: event.selection,
        description: '',
        capability: null,
        failure: null,
        result: null,
      };
    case 'description_changed':
      return state.selection ? { ...state, description: event.description } : state;
    case 'capability_checking':
      return state.selection
        ? { ...state, phase: 'ready', capability: null, failure: null }
        : state;
    case 'capability_resolved':
      return state.selection
        ? { ...state, phase: 'ready', capability: event.capability, failure: null }
        : state;
    case 'analysis_started':
      return state.selection && state.phase !== 'analyzing'
        ? { ...state, phase: 'analyzing', failure: null, result: null }
        : state;
    case 'analysis_failed':
      return state.selection
        ? { ...state, phase: 'failed', failure: event.failure, result: null }
        : state;
    case 'analysis_succeeded':
      return state.selection
        ? {
          ...state,
          phase: 'succeeded',
          failure: null,
          result: {
            requestId: event.requestId,
            itemCount: event.itemKeys.length,
            itemKeys: event.itemKeys,
          },
        }
        : state;
    case 'dismissed':
      return initialMealPhotoFlowState;
  }
}

export function applyPhotoAnalysisDrafts<T>(
  current: T[],
  drafts: T[],
  requestId: string,
  appliedRequestIds: string[],
  isBlank: (value: T) => boolean,
): { items: T[]; insertedItems: T[]; appliedRequestIds: string[] } {
  if (appliedRequestIds.includes(requestId)) {
    return { items: current, insertedItems: [], appliedRequestIds };
  }
  const base = current.length === 1 && current[0] != null && isBlank(current[0]) ? [] : current;
  return {
    items: [...base, ...drafts],
    insertedItems: drafts,
    appliedRequestIds: [...appliedRequestIds, requestId],
  };
}

export function serializeMealPhotoProvenance(
  analyses: Array<{ requestId: string; description: string; itemKeys: string[] }>,
  activeItemKeys: string[],
): string | null {
  const active = new Set(activeItemKeys);
  const retained = analyses.flatMap((analysis) => {
    const retainedCount = analysis.itemKeys.filter((key) => active.has(key)).length;
    return retainedCount > 0 ? [{
      requestId: analysis.requestId,
      description: analysis.description.trim() || null,
      retainedItemCount: retainedCount,
    }] : [];
  });
  return retained.length
    ? JSON.stringify({ version: 1, source: 'meal_photo_analysis', analyses: retained })
    : null;
}
