import type { SQLiteDatabase } from 'expo-sqlite';

import { withExclusiveTransaction } from './exclusive-transaction';
import { enqueueUpsert } from './sync-queue';
import { insertBodyMeasurement } from './wellness';
import type { FitnessGoal, LoadUnit, SaveBodyMeasurementInput, SaveUserProfileInput, TrainingExperience, UserProfile } from './types';

type ProfileRow = {
  training_experience: TrainingExperience;
  available_equipment: string;
  injury_flags: string;
  goals: string;
  typical_diet_pattern: string;
  preferred_load_unit: LoadUnit;
  ai_data_consent: number;
  ai_data_consented_at: string | null;
  medical_disclaimer_acknowledged_at: string | null;
  onboarding_completed_at: string;
};

function mapProfile(row: ProfileRow): UserProfile {
  return {
    trainingExperience: row.training_experience,
    availableEquipment: JSON.parse(row.available_equipment) as string[],
    injuryFlags: JSON.parse(row.injury_flags) as string[],
    goals: JSON.parse(row.goals) as FitnessGoal[],
    typicalDietPattern: row.typical_diet_pattern,
    preferredLoadUnit: row.preferred_load_unit,
    aiDataConsent: row.ai_data_consent === 1,
    aiDataConsentedAt: row.ai_data_consented_at,
    medicalDisclaimerAcknowledgedAt: row.medical_disclaimer_acknowledged_at,
    onboardingCompletedAt: row.onboarding_completed_at,
  };
}

export async function getUserProfile(db: SQLiteDatabase): Promise<UserProfile | null> {
  const row = await db.getFirstAsync<ProfileRow>(
    `SELECT training_experience, available_equipment, injury_flags, goals,
      typical_diet_pattern, preferred_load_unit, ai_data_consent,
      ai_data_consented_at, medical_disclaimer_acknowledged_at, onboarding_completed_at
     FROM user_profile WHERE id = 'current'`,
  );
  return row ? mapProfile(row) : null;
}

export async function hasCompletedOnboarding(db: SQLiteDatabase): Promise<boolean> {
  return (await db.getFirstAsync<{ completed: number }>(
    `SELECT 1 AS completed FROM user_profile
     WHERE id = 'current' AND onboarding_completed_at IS NOT NULL`,
  )) != null;
}

export async function saveUserProfile(
  db: SQLiteDatabase,
  input: SaveUserProfileInput,
  bodyMeasurement?: SaveBodyMeasurementInput,
): Promise<UserProfile> {
  if (input.goals.length === 0) throw new Error('Choose at least one goal.');
  if (input.availableEquipment.length === 0) throw new Error('Choose at least one equipment option.');
  if (!input.typicalDietPattern.trim()) throw new Error('Choose a typical diet pattern.');

  const now = new Date().toISOString();
  const existing = await db.getFirstAsync<{
    created_at: string;
    ai_data_consent: number;
    ai_data_consented_at: string | null;
    medical_disclaimer_acknowledged_at: string | null;
    onboarding_completed_at: string;
  }>(
    `SELECT created_at, ai_data_consent, ai_data_consented_at,
      medical_disclaimer_acknowledged_at, onboarding_completed_at
     FROM user_profile WHERE id = 'current'`,
  );
  const consentedAt = input.aiDataConsent
    ? existing?.ai_data_consent === 1 ? existing.ai_data_consented_at ?? now : now
    : null;
  const onboardingCompletedAt = existing?.onboarding_completed_at ?? now;
  const payload = {
    training_experience: input.trainingExperience,
    available_equipment: input.availableEquipment,
    injury_flags: input.injuryFlags,
    goals: input.goals,
    typical_diet_pattern: input.typicalDietPattern.trim(),
    preferred_load_unit: input.preferredLoadUnit,
    ai_data_consent: input.aiDataConsent,
    ai_data_consented_at: consentedAt,
    medical_disclaimer_acknowledged_at: existing?.medical_disclaimer_acknowledged_at ?? null,
    onboarding_completed_at: onboardingCompletedAt,
    client_updated_at: now,
  };

  await withExclusiveTransaction(db, async (db) => {
    await db.runAsync(
      `INSERT INTO user_profile (
        id, training_experience, available_equipment, injury_flags, goals,
        typical_diet_pattern, preferred_load_unit, ai_data_consent,
        ai_data_consented_at, medical_disclaimer_acknowledged_at,
        onboarding_completed_at, created_at, updated_at,
        client_updated_at
      ) VALUES ('current', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        training_experience = excluded.training_experience,
        available_equipment = excluded.available_equipment,
        injury_flags = excluded.injury_flags,
        goals = excluded.goals,
        typical_diet_pattern = excluded.typical_diet_pattern,
        preferred_load_unit = excluded.preferred_load_unit,
        ai_data_consent = excluded.ai_data_consent,
        ai_data_consented_at = excluded.ai_data_consented_at,
        medical_disclaimer_acknowledged_at = excluded.medical_disclaimer_acknowledged_at,
        onboarding_completed_at = excluded.onboarding_completed_at,
        updated_at = excluded.updated_at,
        client_updated_at = excluded.client_updated_at`,
      [
        input.trainingExperience,
        JSON.stringify(input.availableEquipment),
        JSON.stringify(input.injuryFlags),
        JSON.stringify(input.goals),
        input.typicalDietPattern.trim(),
        input.preferredLoadUnit,
        input.aiDataConsent ? 1 : 0,
        consentedAt,
        existing?.medical_disclaimer_acknowledged_at ?? null,
        onboardingCompletedAt,
        existing?.created_at ?? now,
        now,
        now,
      ],
    );
    await enqueueUpsert(db, 'users', 'current-profile', payload);
    if (bodyMeasurement) await insertBodyMeasurement(db, bodyMeasurement, now);
  });

  return {
    ...input,
    typicalDietPattern: input.typicalDietPattern.trim(),
    aiDataConsentedAt: consentedAt,
    medicalDisclaimerAcknowledgedAt: existing?.medical_disclaimer_acknowledged_at ?? null,
    onboardingCompletedAt,
  };
}
