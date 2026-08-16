import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { toLocalDateKey } from '@/lib/time';
import {
  aggregateWeeklyVolume,
  calculateOverloadChangePercent,
  detectDeloadSignal,
  isoWeekKey,
  suggestDoubleProgression,
} from '@/lib/progression';

import { withExclusiveTransaction } from './exclusive-transaction';
import { enqueueUpsert } from './sync-queue';
import { getWorkoutDetail, listRecentWorkouts, listVolumeHistory } from './workouts';
import type {
  AiMessage,
  BodyMeasurement,
  DeterministicPlanBrief,
  SaveBodyMeasurementInput,
  WellnessCheckIn,
  WellnessCheckInInput,
  WellnessHubSummary,
} from './types';

export async function getLatestBodyMeasurement(db: SQLiteDatabase): Promise<BodyMeasurement | null> {
  const row = await db.getFirstAsync<{
    id: string;
    logged_at: string;
    body_weight_kg: number;
    metadata: string;
  }>(
    `SELECT id, logged_at, body_weight_kg, metadata
     FROM wellness_logs
     WHERE kind = 'body_measurement' AND deleted_at IS NULL
     ORDER BY logged_at DESC
     LIMIT 1`,
  );
  if (!row) return null;
  const metadata = JSON.parse(row.metadata) as {
    height_cm?: number;
    body_fat_percent?: number | null;
    body_fat_is_estimated?: boolean | null;
  };
  return {
    id: row.id,
    loggedAt: row.logged_at,
    heightCm: metadata.height_cm ?? 0,
    bodyWeightKg: row.body_weight_kg,
    bodyFatPercent: metadata.body_fat_percent ?? null,
    bodyFatIsEstimated: metadata.body_fat_is_estimated ?? null,
  };
}

export async function insertBodyMeasurement(
  db: SQLiteDatabase,
  input: SaveBodyMeasurementInput,
  now = new Date().toISOString(),
): Promise<BodyMeasurement> {
  validateBodyMeasurement(input);
  const id = Crypto.randomUUID();
  const metadata = {
    height_cm: input.heightCm,
    body_fat_percent: input.bodyFatPercent,
    body_fat_is_estimated: input.bodyFatIsEstimated,
  };
  const payload = {
    id,
    kind: 'body_measurement',
    logged_on: toLocalDateKey(new Date(now)),
    logged_at: now,
    source: 'manual',
    mood_score: null,
    energy_score: null,
    stress_score: null,
    soreness_score: null,
    motivation_score: null,
    sleep_duration_minutes: null,
    sleep_quality_score: null,
    body_weight_kg: input.bodyWeightKg,
    injury_flags: [],
    notes: null,
    metadata,
    created_at: now,
    client_updated_at: now,
    deleted_at: null,
  };
  await db.runAsync(
    `INSERT INTO wellness_logs (
      id, kind, logged_on, logged_at, source, body_weight_kg, injury_flags,
      metadata, created_at, updated_at, client_updated_at
    ) VALUES (?, 'body_measurement', ?, ?, 'manual', ?, '[]', ?, ?, ?, ?)`,
    [id, payload.logged_on, now, input.bodyWeightKg, JSON.stringify(metadata), now, now, now],
  );
  await enqueueUpsert(db, 'wellness_logs', id, payload);
  return { id, loggedAt: now, ...input };
}

export async function saveBodyMeasurement(db: SQLiteDatabase, input: SaveBodyMeasurementInput): Promise<BodyMeasurement> {
  let measurement: BodyMeasurement | null = null;
  await withExclusiveTransaction(db, async (db) => {
    measurement = await insertBodyMeasurement(db, input);
  });
  if (!measurement) throw new Error('Body measurement was not saved.');
  return measurement;
}

type WellnessRow = {
  id: string;
  logged_at: string;
  mood_score: number | null;
  energy_score: number | null;
  stress_score: number | null;
  soreness_score: number | null;
  motivation_score: number | null;
  sleep_duration_minutes: number | null;
  sleep_quality_score: number | null;
  injury_flags: string;
  notes: string | null;
};

function mapWellnessCheckIn(row: WellnessRow): WellnessCheckIn {
  return {
    id: row.id,
    loggedAt: row.logged_at,
    moodScore: row.mood_score,
    energyScore: row.energy_score,
    stressScore: row.stress_score,
    sorenessScore: row.soreness_score,
    motivationScore: row.motivation_score,
    sleepDurationMinutes: row.sleep_duration_minutes,
    sleepQualityScore: row.sleep_quality_score,
    injuryFlags: JSON.parse(row.injury_flags) as string[],
    notes: row.notes ?? '',
  };
}

export async function getLatestWellnessCheckIn(db: SQLiteDatabase): Promise<WellnessCheckIn | null> {
  const row = await db.getFirstAsync<WellnessRow>(
    `SELECT id, logged_at, mood_score, energy_score, stress_score, soreness_score,
      motivation_score, sleep_duration_minutes, sleep_quality_score, injury_flags, notes
     FROM wellness_logs
     WHERE kind = 'check_in' AND deleted_at IS NULL
     ORDER BY logged_at DESC
     LIMIT 1`,
  );
  return row ? mapWellnessCheckIn(row) : null;
}

export async function saveWellnessCheckIn(
  db: SQLiteDatabase,
  input: WellnessCheckInInput,
): Promise<WellnessCheckIn> {
  validateWellnessCheckIn(input);
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  const cleanedFlags = input.injuryFlags.map((flag) => flag.trim()).filter(Boolean).slice(0, 8);
  const notes = input.notes.trim().slice(0, 2_000);
  const payload = {
    id,
    kind: 'check_in',
    logged_on: toLocalDateKey(new Date(now)),
    logged_at: now,
    source: 'manual',
    mood_score: input.moodScore,
    energy_score: input.energyScore,
    stress_score: input.stressScore,
    soreness_score: input.sorenessScore,
    motivation_score: input.motivationScore,
    sleep_duration_minutes: input.sleepDurationMinutes,
    sleep_quality_score: input.sleepQualityScore,
    body_weight_kg: null,
    injury_flags: cleanedFlags,
    notes: notes || null,
    metadata: {},
    created_at: now,
    client_updated_at: now,
    deleted_at: null,
  };

  await withExclusiveTransaction(db, async (db) => {
    await db.runAsync(
      `INSERT INTO wellness_logs (
        id, kind, logged_on, logged_at, source, mood_score, energy_score,
        stress_score, soreness_score, motivation_score, sleep_duration_minutes,
        sleep_quality_score, injury_flags, notes, metadata, created_at,
        updated_at, client_updated_at
      ) VALUES (?, 'check_in', ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
      [
        id,
        payload.logged_on,
        now,
        input.moodScore,
        input.energyScore,
        input.stressScore,
        input.sorenessScore,
        input.motivationScore,
        input.sleepDurationMinutes,
        input.sleepQualityScore,
        JSON.stringify(cleanedFlags),
        notes || null,
        now,
        now,
        now,
      ],
    );
    await enqueueUpsert(db, 'wellness_logs', id, payload);
  });

  return { id, loggedAt: now, ...input, injuryFlags: cleanedFlags, notes };
}

export async function acknowledgeMedicalDisclaimer(db: SQLiteDatabase): Promise<string> {
  const row = await db.getFirstAsync<{
    training_experience: string;
    available_equipment: string;
    injury_flags: string;
    goals: string;
    typical_diet_pattern: string;
    preferred_load_unit: string;
    ai_data_consent: number;
    ai_data_consented_at: string | null;
    onboarding_completed_at: string;
    medical_disclaimer_acknowledged_at: string | null;
  }>(`SELECT training_experience, available_equipment, injury_flags, goals,
      typical_diet_pattern, preferred_load_unit, ai_data_consent,
      ai_data_consented_at, onboarding_completed_at,
      medical_disclaimer_acknowledged_at
    FROM user_profile WHERE id = 'current'`);
  if (!row) throw new Error('Complete onboarding before using AI guidance.');
  if (row.medical_disclaimer_acknowledged_at) return row.medical_disclaimer_acknowledged_at;

  const acknowledgedAt = new Date().toISOString();
  const payload = {
    training_experience: row.training_experience,
    available_equipment: JSON.parse(row.available_equipment),
    injury_flags: JSON.parse(row.injury_flags),
    goals: JSON.parse(row.goals),
    typical_diet_pattern: row.typical_diet_pattern,
    preferred_load_unit: row.preferred_load_unit,
    ai_data_consent: row.ai_data_consent === 1,
    ai_data_consented_at: row.ai_data_consented_at,
    onboarding_completed_at: row.onboarding_completed_at,
    medical_disclaimer_acknowledged_at: acknowledgedAt,
    client_updated_at: acknowledgedAt,
  };
  await withExclusiveTransaction(db, async (db) => {
    await db.runAsync(
      `UPDATE user_profile
       SET medical_disclaimer_acknowledged_at = ?, updated_at = ?, client_updated_at = ?
       WHERE id = 'current'`,
      [acknowledgedAt, acknowledgedAt, acknowledgedAt],
    );
    await enqueueUpsert(db, 'users', 'current-profile', payload);
  });
  return acknowledgedAt;
}

export async function getWellnessHubSummary(db: SQLiteDatabase): Promise<WellnessHubSummary> {
  const now = new Date();
  const today = toLocalDateKey(now);
  const start7 = toLocalDateKey(new Date(now.getTime() - 6 * 86_400_000));
  const startPrevious7 = toLocalDateKey(new Date(now.getTime() - 13 * 86_400_000));
  const latestCheckIn = await getLatestWellnessCheckIn(db);
  const [training, nutrition, plan, messages] = await Promise.all([
    db.getFirstAsync<{
      workout_count_7: number;
      volume_7: number;
      volume_previous_7: number;
    }>(
      `SELECT
        COUNT(DISTINCT CASE WHEN w.performed_on >= ? THEN w.id END) AS workout_count_7,
        COALESCE(SUM(CASE WHEN w.performed_on >= ? AND s.kind = 'working'
          THEN s.load_value * CASE WHEN s.load_unit = 'lb' THEN 0.45359237 ELSE 1 END * s.reps
          ELSE 0 END), 0) AS volume_7,
        COALESCE(SUM(CASE WHEN w.performed_on >= ? AND w.performed_on < ? AND s.kind = 'working'
          THEN s.load_value * CASE WHEN s.load_unit = 'lb' THEN 0.45359237 ELSE 1 END * s.reps
          ELSE 0 END), 0) AS volume_previous_7
       FROM workouts w
       LEFT JOIN workout_sets s ON s.workout_id = w.id AND s.deleted_at IS NULL
       WHERE w.status = 'completed' AND w.deleted_at IS NULL AND w.performed_on >= ?`,
      [start7, start7, startPrevious7, start7, startPrevious7],
    ),
    db.getFirstAsync<{
      days_logged: number;
      calories_total: number;
      protein_total: number;
    }>(
      `SELECT COUNT(DISTINCT m.eaten_on) AS days_logged,
        COALESCE(SUM(f.calories_kcal), 0) AS calories_total,
        COALESCE(SUM(f.protein_g), 0) AS protein_total
       FROM meals m
       LEFT JOIN food_items f ON f.meal_id = m.id AND f.deleted_at IS NULL
       WHERE m.eaten_on >= ? AND m.eaten_on <= ? AND m.deleted_at IS NULL`,
      [start7, today],
    ),
    buildDeterministicPlanBrief(db, latestCheckIn),
    listCachedAiMessages(db),
  ]);

  const currentVolume = training?.volume_7 ?? 0;
  const previousVolume = training?.volume_previous_7 ?? 0;
  return {
    workoutCount7Days: training?.workout_count_7 ?? 0,
    trainingVolume7DaysKg: currentVolume,
    trainingVolumePrevious7DaysKg: previousVolume,
    trainingVolumeChangePercent: calculateOverloadChangePercent(currentVolume, previousVolume),
    nutritionDaysLogged: nutrition?.days_logged ?? 0,
    averageCalories7Days: (nutrition?.calories_total ?? 0) / 7,
    averageProtein7Days: (nutrition?.protein_total ?? 0) / 7,
    latestCheckIn,
    plan,
    messages,
  };
}

async function buildDeterministicPlanBrief(
  db: SQLiteDatabase,
  latestCheckIn: WellnessCheckIn | null,
): Promise<DeterministicPlanBrief> {
  const generatedAt = new Date().toISOString();
  const latestWorkout = (await listRecentWorkouts(db, 1))[0] ?? null;
  const detail = latestWorkout ? await getWorkoutDetail(db, latestWorkout.id) : null;
  const volumeHistory = await listVolumeHistory(db);
  const weekly = aggregateWeeklyVolume(volumeHistory);
  const currentWeek = isoWeekKey(generatedAt);
  const completedVolumes = weekly
    .filter((entry) => entry.week !== currentWeek)
    .map((entry) => entry.totalKg);
  const activeJointFlag = Boolean(
    latestCheckIn
      && Date.now() - new Date(latestCheckIn.loggedAt).getTime() <= 72 * 60 * 60 * 1_000
      && latestCheckIn.injuryFlags.length > 0,
  );

  const grouped = new Map<string, NonNullable<typeof detail>['sets']>();
  for (const set of detail?.sets ?? []) {
    const sets = grouped.get(set.exerciseId) ?? [];
    sets.push(set);
    grouped.set(set.exerciseId, sets);
  }
  const exercises = [...grouped.entries()].map(([exerciseId, sets]) => {
    const first = sets[0]!;
    const suggestion = suggestDoubleProgression({
      sets,
      repMin: first.targetRepMin,
      repMax: first.targetRepMax,
      loadIncrement: first.loadIncrement,
      jointFlag: activeJointFlag,
    });
    return {
      exerciseId,
      exerciseName: first.exerciseName,
      action: suggestion.action,
      loadValue: 'loadValue' in suggestion ? suggestion.loadValue : null,
      loadUnit: first.loadUnit,
      targetReps: 'targetReps' in suggestion ? suggestion.targetReps : null,
      reason: suggestion.reason,
    };
  });

  return {
    version: 1,
    generatedAt,
    sourceWorkoutId: detail?.id ?? null,
    sourceWorkoutTitle: detail?.title ?? null,
    activeJointFlag,
    weeklyVolumeKg: weekly.map((entry) => entry.totalKg),
    deloadSignal: detectDeloadSignal(completedVolumes),
    exercises,
  };
}

async function listCachedAiMessages(db: SQLiteDatabase): Promise<AiMessage[]> {
  const conversation = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM ai_conversations
     WHERE purpose = 'wellness' AND status = 'active' AND deleted_at IS NULL
     ORDER BY last_message_at DESC, created_at DESC LIMIT 1`,
  );
  if (!conversation) return [];
  const rows = await db.getAllAsync<{
    id: string;
    conversation_id: string;
    sequence: number;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
    local_status: 'pending' | 'complete' | 'failed';
    metadata: string;
  }>(
    `SELECT id, conversation_id, sequence, role, content, created_at,
      local_status, metadata
     FROM ai_messages
     WHERE conversation_id = ? AND deleted_at IS NULL AND role IN ('user', 'assistant')
     ORDER BY sequence DESC LIMIT 40`,
    [conversation.id],
  );
  return rows.reverse().map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    sequence: row.sequence,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    localStatus: row.local_status,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  }));
}

function validateBodyMeasurement(input: SaveBodyMeasurementInput): void {
  if (!Number.isFinite(input.heightCm) || input.heightCm < 100 || input.heightCm > 250) {
    throw new Error('Enter a height between 100 and 250 cm.');
  }
  if (!Number.isFinite(input.bodyWeightKg) || input.bodyWeightKg < 25 || input.bodyWeightKg > 400) {
    throw new Error('Enter a weight between 25 and 400 kg.');
  }
  if (input.bodyFatPercent != null && (!Number.isFinite(input.bodyFatPercent) || input.bodyFatPercent < 2 || input.bodyFatPercent > 70)) {
    throw new Error('Enter body fat between 2% and 70%, or leave it blank.');
  }
}

function validateWellnessCheckIn(input: WellnessCheckInInput): void {
  const scores = [
    input.moodScore,
    input.energyScore,
    input.stressScore,
    input.sorenessScore,
    input.motivationScore,
    input.sleepQualityScore,
  ];
  if (scores.some((score) => score != null && (!Number.isInteger(score) || score < 1 || score > 5))) {
    throw new Error('Wellness ratings must be whole numbers from 1 to 5.');
  }
  if (
    input.sleepDurationMinutes != null
    && (!Number.isInteger(input.sleepDurationMinutes)
      || input.sleepDurationMinutes < 0
      || input.sleepDurationMinutes > 1_440)
  ) {
    throw new Error('Sleep duration must be between 0 and 24 hours.');
  }
  if (
    scores.every((score) => score == null)
    && input.sleepDurationMinutes == null
    && input.injuryFlags.every((flag) => !flag.trim())
    && !input.notes.trim()
  ) {
    throw new Error('Add at least one rating or a short note.');
  }
}
