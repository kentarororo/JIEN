/** Shared by SQLite readers, the local engine and Edge context builders. */
export const TRAINING_SET_KINDS = ['working', 'failure', 'drop'] as const;
export const PROGRESSION_SET_KINDS = ['working', 'failure'] as const;

// Missing kind means the historical default. Unknown explicit kinds never count.
export function countsTowardTraining(kind: string | null | undefined): boolean {
  return TRAINING_SET_KINDS.some((value) => value === (kind ?? 'working'));
}

export function countsTowardProgression(kind: string | null | undefined): boolean {
  return PROGRESSION_SET_KINDS.some((value) => value === (kind ?? 'working'));
}

export function isHighEffort(set: { kind?: string; rpe?: number | null }): boolean {
  return set.kind === 'failure' || (set.rpe != null && set.rpe > 9);
}

export function targetSetKind(kind: string | undefined): 'working' | 'warmup' | 'drop' {
  return kind === 'warmup' || kind === 'drop' ? kind : 'working';
}

export const FAILURE_HOLD_REASON = 'Completed reps count toward your training. A set reached failure; repeat these targets before adding reps or load.';

/** Column names come only from repository code, never user input. */
export function trainingSetSql(column: string): string {
  return kindSql(column, TRAINING_SET_KINDS);
}

export function progressionSetSql(column: string): string {
  return kindSql(column, PROGRESSION_SET_KINDS);
}

function kindSql(column: string, kinds: readonly string[]): string {
  if (!/^[a-z_]+\.[a-z_]+$/.test(column)) throw new Error('Invalid set-kind column.');
  return `${column} IN (${kinds.map((kind) => `'${kind}'`).join(', ')})`;
}
