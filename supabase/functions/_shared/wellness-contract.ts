export type WellnessChatMode = 'chat' | 'plan_explanation';

export type SafePlanExercise = {
  exerciseId: string;
  exerciseName: string;
  action: 'start' | 'hold' | 'add_reps' | 'add_load';
  loadValue: number | null;
  loadUnit: 'kg' | 'lb';
  targetReps: number[] | null;
  reason: string;
};

export type SafePlanBrief = {
  version: 1;
  generatedAt: string;
  sourceWorkoutId: string | null;
  sourceWorkoutTitle: string | null;
  activeJointFlag: boolean;
  weeklyVolumeKg: number[];
  deloadSignal: {
    kind: 'none' | 'stagnation' | 'volume_drop';
    message: string;
  };
  exercises: SafePlanExercise[];
};

export type WellnessChatRequest = {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  assistantSequence: number;
  mode: WellnessChatMode;
  planBrief: SafePlanBrief;
};

export type WellnessContractResult =
  | { ok: true; data: WellnessChatRequest }
  | { ok: false; code: 'INVALID_ENVELOPE' | 'INVALID_REQUEST' | 'INVALID_SEQUENCE' | 'INVALID_MODE' | 'INVALID_PLAN' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['start', 'hold', 'add_reps', 'add_load']);
const DELOAD_KINDS = new Set(['none', 'stagnation', 'volume_drop']);

export function contextQueriesSucceeded(
  ...results: Array<(Record<string, unknown> & { error?: unknown }) | null | undefined>
): boolean {
  return results.every((result) => result != null && !result.error);
}

export function storedReplyMatchesRequest(
  row: Record<string, unknown>,
  request: Pick<WellnessChatRequest, 'conversationId' | 'assistantMessageId' | 'assistantSequence'>,
): boolean {
  return row.id === request.assistantMessageId
    && row.user_id != null
    && row.conversation_id === request.conversationId
    && row.sequence === request.assistantSequence
    && row.role === 'assistant'
    && row.deleted_at == null;
}

/**
 * Parse the public v1 request without coercing provider-facing values. The
 * deterministic plan is client-computed, but it is still untrusted API input.
 */
export function parseWellnessChatRequest(value: unknown): WellnessContractResult {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  if (envelope?.version !== 1 || !data) return { ok: false, code: 'INVALID_ENVELOPE' };

  const conversationId = uuid(data.conversationId);
  const userMessageId = uuid(data.userMessageId);
  const assistantMessageId = uuid(data.assistantMessageId);
  if (!conversationId || !userMessageId || !assistantMessageId) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  if (!Number.isInteger(data.assistantSequence)
    || (data.assistantSequence as number) < 1
    || (data.assistantSequence as number) > 100_000) {
    return { ok: false, code: 'INVALID_SEQUENCE' };
  }
  if (data.mode !== 'chat' && data.mode !== 'plan_explanation') {
    return { ok: false, code: 'INVALID_MODE' };
  }
  const planBrief = parsePlanBrief(data.planBrief);
  if (!planBrief) return { ok: false, code: 'INVALID_PLAN' };

  return {
    ok: true,
    data: {
      conversationId,
      userMessageId,
      assistantMessageId,
      assistantSequence: data.assistantSequence as number,
      mode: data.mode,
      planBrief,
    },
  };
}

function parsePlanBrief(value: unknown): SafePlanBrief | null {
  const plan = asRecord(value);
  if (!plan || plan.version !== 1 || !validIsoTimestamp(plan.generatedAt)
    || typeof plan.activeJointFlag !== 'boolean'
    || !Array.isArray(plan.weeklyVolumeKg) || plan.weeklyVolumeKg.length > 10
    || !Array.isArray(plan.exercises) || plan.exercises.length > 20) return null;

  const sourceWorkoutId = plan.sourceWorkoutId == null ? null : uuid(plan.sourceWorkoutId);
  const sourceWorkoutTitle = plan.sourceWorkoutTitle == null
    ? null
    : boundedString(plan.sourceWorkoutTitle, 120);
  if ((plan.sourceWorkoutId != null && !sourceWorkoutId)
    || (plan.sourceWorkoutTitle != null && !sourceWorkoutTitle)) return null;

  const weeklyVolumeKg = plan.weeklyVolumeKg.map((item) => boundedNumber(item, 0, 1_000_000_000));
  if (weeklyVolumeKg.some((item) => item == null)) return null;

  const deload = asRecord(plan.deloadSignal);
  const deloadMessage = boundedString(deload?.message, 300);
  if (!deload || typeof deload.kind !== 'string' || !DELOAD_KINDS.has(deload.kind) || !deloadMessage) return null;

  const exercises: SafePlanExercise[] = [];
  for (const value of plan.exercises) {
    const exercise = parseExercise(value);
    if (!exercise) return null;
    exercises.push(exercise);
  }

  return {
    version: 1,
    generatedAt: plan.generatedAt as string,
    sourceWorkoutId,
    sourceWorkoutTitle,
    activeJointFlag: plan.activeJointFlag,
    weeklyVolumeKg: weeklyVolumeKg as number[],
    deloadSignal: {
      kind: deload.kind as SafePlanBrief['deloadSignal']['kind'],
      message: deloadMessage,
    },
    exercises,
  };
}

function parseExercise(value: unknown): SafePlanExercise | null {
  const exercise = asRecord(value);
  const exerciseId = uuid(exercise?.exerciseId);
  const exerciseName = boundedString(exercise?.exerciseName, 120);
  const reason = boundedString(exercise?.reason, 300);
  if (!exercise || !exerciseId || !exerciseName || !reason
    || typeof exercise.action !== 'string' || !ACTIONS.has(exercise.action)
    || (exercise.loadUnit !== 'kg' && exercise.loadUnit !== 'lb')) return null;

  const loadValue = exercise.loadValue == null
    ? null
    : boundedNumber(exercise.loadValue, 0, 100_000);
  if (exercise.loadValue != null && loadValue == null) return null;

  let targetReps: number[] | null = null;
  if (exercise.targetReps != null) {
    if (!Array.isArray(exercise.targetReps) || exercise.targetReps.length < 1 || exercise.targetReps.length > 20) return null;
    targetReps = exercise.targetReps.map((item) => Number.isInteger(item) && item >= 1 && item <= 100 ? item : -1);
    if (targetReps.some((item) => item < 1)) return null;
  }

  return {
    exerciseId,
    exerciseName,
    action: exercise.action as SafePlanExercise['action'],
    loadValue,
    loadUnit: exercise.loadUnit,
    targetReps,
    reason,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function uuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

function boundedString(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean && clean.length <= maximumLength ? clean : null;
}

function boundedNumber(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function validIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 40) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
