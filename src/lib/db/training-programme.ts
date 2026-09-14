import type { SQLiteDatabase } from 'expo-sqlite';
import { buildProgrammeProgress, parseTrainingProgramme, type ProgrammeHistorySet, type TrainingProgramme } from '../planning/training-programme.ts';
import { toLocalDateKey } from '../time.ts';
import { withExclusiveTransaction } from './exclusive-transaction';
import { getUserProfile } from './profile';
import { enqueueUpsert } from './sync-queue';

/** Profile and outbox change together; workout history is never rewritten. */
export async function saveTrainingProgramme(db: SQLiteDatabase, value: TrainingProgramme | null) {
  const programme = value === null ? null : parseTrainingProgramme(value);
  if (value !== null && !programme) throw new Error('Choose a goal, 1–7 sessions, and 1–6 muscles with targets from 0.5 to 40 in half-set steps.');
  await withExclusiveTransaction(db, async (tx) => {
    const row = await tx.getFirstAsync<Record<string, string | number | null>>(`SELECT * FROM user_profile WHERE id = 'current'`);
    if (!row) throw new Error('Complete your profile before setting training targets.');
    const now = new Date(Math.max(Date.now(), Date.parse(String(row.client_updated_at)) + 1 || 0)).toISOString();
    await tx.runAsync(`UPDATE user_profile SET training_programme = ?, updated_at = ?, client_updated_at = ? WHERE id = 'current'`,
      [programme ? JSON.stringify(programme) : null, now, now]);
    await enqueueUpsert(tx, 'users', 'current-profile', {
      training_programme: programme,
      training_experience: row.training_experience,
      available_equipment: JSON.parse(String(row.available_equipment)),
      injury_flags: JSON.parse(String(row.injury_flags)),
      goals: JSON.parse(String(row.goals)),
      typical_diet_pattern: row.typical_diet_pattern,
      preferred_load_unit: row.preferred_load_unit,
      ai_data_consent: row.ai_data_consent === 1,
      ai_data_consented_at: row.ai_data_consented_at,
      medical_disclaimer_acknowledged_at: row.medical_disclaimer_acknowledged_at,
      onboarding_completed_at: row.onboarding_completed_at,
      client_updated_at: now,
    });
  });
}

export async function getTrainingProgrammeProgress(db: SQLiteDatabase, now = new Date()) {
  const programme = (await getUserProfile(db))?.trainingProgramme;
  if (!programme) return null;
  const today = toLocalDateKey(now);
  const start = new Date(now);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const monday = toLocalDateKey(start);
  start.setDate(start.getDate() - 35);
  const history = await db.getAllAsync<ProgrammeHistorySet & { secondaryJson: string }>(
    `SELECT w.id AS workoutId, w.performed_on AS performedOn,
      COALESCE(w.started_at, w.performed_on || 'T12:00:00') AS completedAt,
      s.kind, s.reps, s.load_value AS loadValue, s.load_unit AS loadUnit,
      e.movement_pattern AS movementPattern,
      COALESCE(s.primary_muscle_group, e.primary_muscle_group) AS primaryMuscleGroup,
      COALESCE(s.secondary_muscle_groups, e.secondary_muscle_groups) AS secondaryJson
     FROM workout_sets s JOIN workouts w ON w.id = s.workout_id JOIN exercises e ON e.id = s.exercise_id
     WHERE w.status = 'completed' AND w.deleted_at IS NULL AND s.deleted_at IS NULL
       AND w.performed_on >= ? AND w.performed_on <= ?`, [toLocalDateKey(start), today]);
  const count = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM workouts w WHERE w.status = 'completed' AND w.deleted_at IS NULL
     AND w.performed_on >= ? AND w.performed_on <= ?
     AND EXISTS (SELECT 1 FROM workout_sets s WHERE s.workout_id = w.id AND s.deleted_at IS NULL
       AND s.kind IN ('working', 'failure', 'drop') AND s.reps > 0 AND s.load_value >= 0)`, [monday, today]);
  return { programme, completedSessions: count?.count ?? 0,
    ...buildProgrammeProgress(programme, history.map((row) => ({ ...row, secondaryMuscleGroups: JSON.parse(row.secondaryJson) as string[] })), now) };
}
