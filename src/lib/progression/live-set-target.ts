import type { LoadUnit } from '../db/types.ts';
import type { WorkoutEntrySet } from '../workout-draft.ts';
import type { ProgressionSet, SetProgressionPlan } from './index.ts';
import { countsTowardProgression } from '../../../supabase/functions/_shared/training-set-policy.ts';

export type LiveSetTarget = { loadValue: number; targetReps: number; label: string; reason: string };

/** Draft-aware display only. Entered values are never treated as completed history. */
export function liveSetTarget(input: {
  rows: WorkoutEntrySet[]; rowIndex: number; unit: LoadUnit;
  history: ProgressionSet[]; plan: SetProgressionPlan | null;
  allowIncrease: boolean; jointHold: boolean;
}): LiveSetTarget | null {
  const row = input.rows[input.rowIndex];
  if (!row || row.completed || row.kind === 'failure' || !countsTowardProgression(row.kind ?? 'working')) return null;
  const validNumber = (value: string, reps = false) => value.trim() !== '' && Number.isFinite(Number(value))
    && (reps ? Number.isInteger(Number(value)) && Number(value) > 0 : Number(value) >= 0);
  if ((row.load.trim() && !validNumber(row.load)) || (row.reps.trim() && !validNumber(row.reps, true))) return null;
  const workingIndex = input.rows.slice(0, input.rowIndex).filter((set) => countsTowardProgression(set.kind ?? 'working')).length;
  const history = input.history.filter((set) => countsTowardProgression(set.kind));
  const previous = history[workingIndex];
  const highEffort = input.rows.some((set) => countsTowardProgression(set.kind ?? 'working') && (
    set.kind === 'failure' || (set.rpe.trim() && (!Number.isFinite(Number(set.rpe)) || Number(set.rpe) < 1 || Number(set.rpe) > 9))));
  if (highEffort || input.jointHold) return null;
  const cue = input.allowIncrease && !input.jointHold && !highEffort
    ? input.plan?.cues.find((item) => item.workingSetIndex === workingIndex) : null;
  // A load change cannot be converted to an equivalent rep target by volume arithmetic.
  const loadMatches = (load: number) => !row.load.trim() || Math.abs(Number(row.load) - load) < 0.001;
  const compatibleCue = cue && (loadMatches(cue.loadValue) || (previous && loadMatches(previous.loadValue))) ? cue : null;
  let target: LiveSetTarget | null = compatibleCue ? {
    loadValue: compatibleCue.loadValue, targetReps: compatibleCue.targetReps,
    label: compatibleCue.label, reason: 'Optional target from completed sets of this exercise.',
  } : previous && loadMatches(previous.loadValue) && Number.isFinite(previous.loadValue) && previous.loadValue >= 0
    && Number.isInteger(previous.reps) && previous.reps > 0 ? {
      loadValue: previous.loadValue, targetReps: previous.reps,
      label: `Repeat ${previous.loadValue} ${input.unit} × ${previous.reps}`,
      reason: 'Previous matching set. No increase is suggested.',
    } : null;
  if (!target && !input.jointHold && !highEffort) {
    const first = input.rows.slice(0, input.rowIndex).find((set) => (set.kind ?? 'working') === 'working'
      && validNumber(set.load) && validNumber(set.reps, true));
    if (first && loadMatches(Number(first.load))) target = {
      loadValue: Number(first.load), targetReps: Number(first.reps),
      label: `Repeat ${first.load.trim()} ${input.unit} × ${first.reps.trim()}`,
      reason: 'From your entered set, not a progression baseline.',
    };
  }
  // Do not invite users to undo extra reps already entered or overwrite completed work.
  if (target && row.load.trim() && row.reps.trim() && Number(row.load) === target.loadValue && Number(row.reps) >= target.targetReps) return null;
  return target;
}
