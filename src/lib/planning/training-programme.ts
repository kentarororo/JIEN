import { buildMuscleGroupAdvisory, MUSCLE_GROUP_OPTIONS, muscleGroupFamilyKey, muscleGroupFamilyLabel, type MuscleGroupCoverage, type VolumeSet } from '../progression/index.ts';
import { shiftLocalDateKey, toLocalDateKey } from '../time.ts';
import { countsTowardTraining } from '../../../supabase/functions/_shared/training-set-policy.ts';

export const PROGRAMME_GOALS = [
  { value: 'muscle', label: 'Build muscle' },
  { value: 'strength', label: 'Build strength' },
  { value: 'balanced', label: 'Both' },
] as const;
export const PROGRAMME_MUSCLES = [...new Set(MUSCLE_GROUP_OPTIONS.map((item) => muscleGroupFamilyKey(item.value)))];
export type TrainingProgramme = {
  version: 1;
  goal: typeof PROGRAMME_GOALS[number]['value'];
  sessionsPerWeek: number;
  targets: Array<{ muscleGroup: string; weeklySetCredits: number }>;
};

export function parseTrainingProgramme(value: unknown): TrainingProgramme | null {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return null; } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || !PROGRAMME_GOALS.some((goal) => goal.value === row.goal)
    || !Number.isInteger(row.sessionsPerWeek) || Number(row.sessionsPerWeek) < 1 || Number(row.sessionsPerWeek) > 7
    || !Array.isArray(row.targets) || row.targets.length < 1 || row.targets.length > 6) return null;
  const targets: TrainingProgramme['targets'] = [];
  for (const item of row.targets) {
    if (!item || typeof item !== 'object' || typeof item.muscleGroup !== 'string'
      || !PROGRAMME_MUSCLES.includes(item.muscleGroup) || targets.some((target) => target.muscleGroup === item.muscleGroup)
      || typeof item.weeklySetCredits !== 'number' || !Number.isFinite(item.weeklySetCredits)
      || item.weeklySetCredits < 0.5 || item.weeklySetCredits > 40 || !Number.isInteger(item.weeklySetCredits * 2)) return null;
    targets.push({ muscleGroup: item.muscleGroup, weeklySetCredits: item.weeklySetCredits });
  }
  return { version: 1, goal: row.goal as TrainingProgramme['goal'], sessionsPerWeek: Number(row.sessionsPerWeek), targets };
}

export type ProgrammeHistorySet = VolumeSet & { performedOn: string; workoutId: string };
export function buildProgrammeProgress(programme: TrainingProgramme, history: ProgrammeHistorySet[], now = new Date()) {
  const today = toLocalDateKey(now);
  const valid = history.filter((set) => validDay(set.performedOn) && set.performedOn <= today
    && countsTowardTraining(set.kind) && set.reps > 0 && Number.isFinite(set.reps) && set.loadValue >= 0 && Number.isFinite(set.loadValue));
  // Calendar days, not the timestamp when a retrospective record was saved.
  const advisory = buildMuscleGroupAdvisory(valid.map((set) => ({ ...set, completedAt: `${set.performedOn}T12:00:00Z` })), new Date(`${today}T12:00:00Z`));
  const rows = programme.targets.map((target) => {
    const actual = advisory.coverage.find((row) => row.muscleGroup === target.muscleGroup);
    const recent = valid.some((set) => {
      const age = now.getTime() - Date.parse(set.completedAt);
      return age >= 0 && age < 48 * 3_600_000 && [set.primaryMuscleGroup, ...set.secondaryMuscleGroups]
        .some((group) => muscleGroupFamilyKey(group) === target.muscleGroup);
    });
    return { ...target, label: muscleGroupFamilyLabel(target.muscleGroup),
      completed: actual?.currentSetCredits ?? 0,
      usual: advisory.baselineWeekCount ? actual?.baselineSetCredits ?? 0 : null,
      remaining: Math.max(0, target.weeklySetCredits - (actual?.currentSetCredits ?? 0)),
      trainedRecently: recent,
    };
  });
  const focus: MuscleGroupCoverage[] = rows.filter((row) => row.remaining > 0 && !row.trainedRecently).map((row) => ({
    muscleGroup: row.muscleGroup, label: row.label, currentSetCredits: row.completed,
    baselineSetCredits: row.usual ?? 0, remainingSetCredits: row.remaining,
    trainedWithin48Hours: row.trainedRecently, lastTrainedAt: null,
  }));
  return { rows, focus, baselineWeekCount: advisory.baselineWeekCount };
}

function validDay(value: string): boolean {
  try { return shiftLocalDateKey(value, 0) === value; } catch { return false; }
}
