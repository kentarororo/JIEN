import type { SessionApproach, WorkoutSet } from '../db/types.ts';
import { buildSetProgressionPlan } from '../progression/index.ts';
import { countsTowardProgression, isHighEffort } from '../../../supabase/functions/_shared/training-set-policy.ts';

export type SessionReviewFeedback = 'unsure' | 'as_expected' | 'harder' | 'returning';
export const SESSION_REVIEW_OPTIONS = [
  { id: 'unsure', label: 'Not sure' },
  { id: 'as_expected', label: 'As expected' },
  { id: 'harder', label: 'Harder than expected' },
  { id: 'returning', label: 'Returning after a break' },
] as const;

// Comparison freshness, not a physiological detraining/recovery threshold.
export const SESSION_REFERENCE_MAX_AGE_DAYS = 14;
export type NextSessionRecommendation = {
  approach: SessionApproach | null;
  reason: string;
  code: 'no_main_sets' | 'invalid_values' | 'joint_review' | 'lighter_requested'
    | 'single_sets' | 'old_reference' | 'failure' | 'high_effort' | 'missing_effort' | 'eligible' | 'hold';
};

/** A whole-session default; never supplies numbers or overwrites exercise cues. */
export function recommendNextSession(input: {
  sets: WorkoutSet[];
  startedAt?: string | null;
  completedAt: string | null;
  now: Date;
  jointFlag?: boolean;
  feedback?: SessionReviewFeedback;
}): NextSessionRecommendation {
  const mainSets = input.sets.filter((set) => countsTowardProgression(set.kind));
  if (!mainSets.length) return {
    approach: null, code: 'no_main_sets',
    reason: 'No working or failure sets were recorded. Log those sets before building a matching next-session plan.',
  };
  if (mainSets.some((set) => !Number.isFinite(set.loadValue) || set.loadValue < 0
    || !Number.isInteger(set.reps) || set.reps <= 0
    || !Number.isInteger(set.targetRepMin) || set.targetRepMin <= 0
    || !Number.isInteger(set.targetRepMax) || set.targetRepMax < set.targetRepMin
    || !Number.isFinite(set.loadIncrement) || set.loadIncrement <= 0
    || (set.loadUnit !== 'kg' && set.loadUnit !== 'lb'))) return {
    approach: null, code: 'invalid_values', reason: 'Some set values or exercise settings need review before a next-session plan can be suggested.',
  };
  if (input.jointFlag) return {
    approach: 'repeat', code: 'joint_review',
    reason: 'Your profile includes a joint or injury consideration. Keep increase cues off by default and review the exercises. This is not clearance to train.',
  };
  const grouped = new Map<string, WorkoutSet[]>();
  for (const set of mainSets) grouped.set(set.exerciseId, [...(grouped.get(set.exerciseId) ?? []), set]);
  if (input.feedback === 'harder' || input.feedback === 'returning') {
    const reducible = [...grouped.values()].some((sets) => sets.length > 1);
    return reducible ? {
      approach: 'ease_off', code: 'lighter_requested',
      reason: input.feedback === 'returning'
        ? 'You reported returning after a break. Preview a plan with one fewer main set per exercise where possible, then review its loads before starting.'
        : 'You reported a harder-than-expected session. Preview one fewer main set per exercise where possible; loads and reps stay editable.',
    } : {
      approach: 'repeat', code: 'single_sets',
      reason: 'Each exercise has only one main set, so Ease off cannot remove a set. Repeat without increase cues and adjust the draft to suit you.',
    };
  }
  const referenceAt = input.startedAt ?? input.completedAt;
  const age = referenceAt == null ? NaN : input.now.getTime() - Date.parse(referenceAt);
  if (!Number.isFinite(age) || age < 0 || age > SESSION_REFERENCE_MAX_AGE_DAYS * 86_400_000) return {
    approach: 'repeat', code: 'old_reference',
    reason: 'This workout is older than 14 days or has an uncertain date. Use its values as references, not a current readiness assessment.',
  };
  if (mainSets.some((set) => set.kind === 'failure')) return {
    approach: 'repeat', code: 'failure',
    reason: 'A set reached failure. Its completed reps count; repeat the targets before an increase is suggested.',
  };
  if (mainSets.some(isHighEffort)) return {
    approach: 'repeat', code: 'high_effort',
    reason: 'At least one main set exceeded RPE 9. Keep the targets without an increase cue.',
  };
  if (mainSets.some((set) => set.rpe == null || !Number.isFinite(set.rpe) || set.rpe < 1 || set.rpe > 10)) return {
    approach: 'repeat', code: 'missing_effort',
    reason: 'Some main sets have no valid effort rating. Repeat as a starting point and record fresh RPE next time; the session check-in does not replace it.',
  };
  const plans = [...grouped.values()].map((sets) => buildSetProgressionPlan({
    sets, repMin: sets[0]!.targetRepMin, repMax: sets[0]!.targetRepMax,
    loadIncrement: sets[0]!.loadUnit === 'lb' ? Math.max(5, sets[0]!.loadIncrement) : sets[0]!.loadIncrement,
  }));
  if (plans.every((plan) => plan.action === 'add_reps' || plan.action === 'add_load')) return {
    approach: 'progress', code: 'eligible',
    reason: 'Recorded effort is within the progression limits. Review the optional rep or load cue for each exercise; no increase is applied automatically.',
  };
  return { approach: 'repeat', code: 'hold', reason: 'Not every exercise has an eligible increase. Repeat the targets and review individual exercise cues in the plan.' };
}
