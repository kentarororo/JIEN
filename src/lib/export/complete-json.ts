import type { CompleteExportSnapshot, ExportDatabaseRow } from '@/lib/db/export';

export const COMPLETE_EXPORT_SCHEMA_VERSION = 1;

type JsonObject = Record<string, unknown>;

function value(row: ExportDatabaseRow, key: string): unknown {
  return row[key] ?? null;
}

function booleanValue(row: ExportDatabaseRow, key: string): boolean {
  return row[key] === true || row[key] === 1;
}

export function decodeExportJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return (raw ?? fallback) as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function compare(...keys: string[]): (left: ExportDatabaseRow, right: ExportDatabaseRow) => number {
  return (left, right) => {
    for (const key of keys) {
      const leftValue = left[key] ?? '';
      const rightValue = right[key] ?? '';
      const order = typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue) < String(rightValue) ? -1 : String(leftValue) > String(rightValue) ? 1 : 0;
      if (order !== 0) return order;
    }
    return 0;
  };
}

function mapProfile(row: ExportDatabaseRow | null): JsonObject | null {
  if (!row) return null;
  return {
    trainingExperience: value(row, 'training_experience'),
    availableEquipment: decodeExportJson(row.available_equipment, []),
    injuryFlags: decodeExportJson(row.injury_flags, []),
    goals: decodeExportJson(row.goals, []),
    typicalDietPattern: value(row, 'typical_diet_pattern'),
    preferredLoadUnit: value(row, 'preferred_load_unit'),
    aiDataConsent: booleanValue(row, 'ai_data_consent'),
    aiDataConsentedAt: value(row, 'ai_data_consented_at'),
    medicalDisclaimerAcknowledgedAt: value(row, 'medical_disclaimer_acknowledged_at'),
    onboardingCompletedAt: value(row, 'onboarding_completed_at'),
    createdAt: value(row, 'created_at'),
    updatedAt: value(row, 'updated_at'),
    clientUpdatedAt: value(row, 'client_updated_at'),
  };
}

function mapExercise(row: ExportDatabaseRow): JsonObject {
  return {
    id: value(row, 'id'),
    scope: row.user_id == null ? 'built_in' : 'user',
    name: value(row, 'name'),
    movementPattern: value(row, 'movement_pattern'),
    primaryMuscleGroup: value(row, 'primary_muscle_group'),
    secondaryMuscleGroups: decodeExportJson(row.secondary_muscle_groups, []),
    equipment: value(row, 'equipment'),
    targetRepMin: value(row, 'target_rep_min'),
    targetRepMax: value(row, 'target_rep_max'),
    loadIncrement: value(row, 'load_increment'),
    notes: value(row, 'notes'),
    isArchived: booleanValue(row, 'is_archived'),
    createdAt: value(row, 'created_at'),
    updatedAt: value(row, 'updated_at'),
    clientUpdatedAt: value(row, 'client_updated_at'),
    deletedAt: value(row, 'deleted_at'),
  };
}

function mapWorkout(row: ExportDatabaseRow): JsonObject {
  return {
    id: value(row, 'id'), title: value(row, 'title'), status: value(row, 'status'),
    performedOn: value(row, 'performed_on'), startedAt: value(row, 'started_at'),
    completedAt: value(row, 'completed_at'), notes: value(row, 'notes'),
    createdAt: value(row, 'created_at'), updatedAt: value(row, 'updated_at'),
    clientUpdatedAt: value(row, 'client_updated_at'), deletedAt: value(row, 'deleted_at'),
  };
}

function mapWorkoutSet(row: ExportDatabaseRow): JsonObject {
  return {
    id: value(row, 'id'), workoutId: value(row, 'workout_id'), exerciseId: value(row, 'exercise_id'),
    sortOrder: value(row, 'sort_order'), kind: value(row, 'kind'), reps: value(row, 'reps'),
    loadValue: value(row, 'load_value'), loadUnit: value(row, 'load_unit'), rpe: value(row, 'rpe'),
    completedAt: value(row, 'completed_at'), notes: value(row, 'notes'),
    createdAt: value(row, 'created_at'), updatedAt: value(row, 'updated_at'),
    clientUpdatedAt: value(row, 'client_updated_at'), deletedAt: value(row, 'deleted_at'),
  };
}

function mapMeal(row: ExportDatabaseRow): JsonObject {
  return {
    id: value(row, 'id'), name: value(row, 'name'), type: value(row, 'type'),
    eatenOn: value(row, 'eaten_on'), eatenAt: value(row, 'eaten_at'), source: value(row, 'source'),
    notes: value(row, 'notes'), isUserEdited: booleanValue(row, 'is_user_edited'),
    createdAt: value(row, 'created_at'), updatedAt: value(row, 'updated_at'),
    clientUpdatedAt: value(row, 'client_updated_at'), deletedAt: value(row, 'deleted_at'),
  };
}

function mapFoodItem(row: ExportDatabaseRow): JsonObject {
  return {
    id: value(row, 'id'), mealId: value(row, 'meal_id'), sortOrder: value(row, 'sort_order'),
    name: value(row, 'name'), quantity: value(row, 'quantity'), unit: value(row, 'unit'),
    caloriesKcal: value(row, 'calories_kcal'), proteinG: value(row, 'protein_g'),
    carbohydrateG: value(row, 'carbohydrate_g'), fatG: value(row, 'fat_g'), fibreG: value(row, 'fibre_g'),
    source: value(row, 'source'), confidence: value(row, 'confidence'),
    originalSource: value(row, 'original_source'), originalConfidence: value(row, 'original_confidence'),
    isUserEdited: booleanValue(row, 'is_user_edited'), createdAt: value(row, 'created_at'),
    updatedAt: value(row, 'updated_at'), clientUpdatedAt: value(row, 'client_updated_at'),
    deletedAt: value(row, 'deleted_at'),
  };
}

function mapNutritionTarget(row: ExportDatabaseRow): JsonObject {
  return {
    id: value(row, 'id'), effectiveFrom: value(row, 'effective_from'), effectiveTo: value(row, 'effective_to'),
    caloriesKcal: value(row, 'calories_kcal'), proteinG: value(row, 'protein_g'),
    carbohydrateG: value(row, 'carbohydrate_g'), fatG: value(row, 'fat_g'), fibreG: value(row, 'fibre_g'),
    source: value(row, 'source'), rationale: value(row, 'rationale'), createdAt: value(row, 'created_at'),
    updatedAt: value(row, 'updated_at'), clientUpdatedAt: value(row, 'client_updated_at'), deletedAt: value(row, 'deleted_at'),
  };
}

function mapWellnessLog(row: ExportDatabaseRow): JsonObject {
  return {
    id: value(row, 'id'), kind: value(row, 'kind'), loggedOn: value(row, 'logged_on'), loggedAt: value(row, 'logged_at'),
    source: value(row, 'source'), moodScore: value(row, 'mood_score'), energyScore: value(row, 'energy_score'),
    stressScore: value(row, 'stress_score'), sorenessScore: value(row, 'soreness_score'),
    motivationScore: value(row, 'motivation_score'), sleepDurationMinutes: value(row, 'sleep_duration_minutes'),
    sleepQualityScore: value(row, 'sleep_quality_score'), bodyWeightKg: value(row, 'body_weight_kg'),
    injuryFlags: decodeExportJson(row.injury_flags, []), notes: value(row, 'notes'),
    metadata: decodeExportJson(row.metadata, {}), createdAt: value(row, 'created_at'),
    updatedAt: value(row, 'updated_at'), clientUpdatedAt: value(row, 'client_updated_at'), deletedAt: value(row, 'deleted_at'),
  };
}

function mapAiConversation(row: ExportDatabaseRow): JsonObject {
  return {
    id: value(row, 'id'), purpose: value(row, 'purpose'), title: value(row, 'title'), status: value(row, 'status'),
    lastMessageAt: value(row, 'last_message_at'), createdAt: value(row, 'created_at'), updatedAt: value(row, 'updated_at'),
    clientUpdatedAt: value(row, 'client_updated_at'), deletedAt: value(row, 'deleted_at'),
  };
}

function mapAiMessage(row: ExportDatabaseRow): JsonObject {
  return {
    id: value(row, 'id'), conversationId: value(row, 'conversation_id'), sequence: value(row, 'sequence'),
    role: value(row, 'role'), content: value(row, 'content'), structuredContent: decodeExportJson(row.structured_content, {}),
    metadata: decodeExportJson(row.metadata, {}), model: value(row, 'model'), providerMessageId: value(row, 'provider_message_id'),
    localStatus: value(row, 'local_status'), createdAt: value(row, 'created_at'), updatedAt: value(row, 'updated_at'),
    clientUpdatedAt: value(row, 'client_updated_at'), deletedAt: value(row, 'deleted_at'),
  };
}

function mapNotificationPreference(row: ExportDatabaseRow): JsonObject {
  return {
    id: value(row, 'id'), type: value(row, 'type'), enabled: booleanValue(row, 'enabled'),
    quietHoursStart: value(row, 'quiet_hours_start'), quietHoursEnd: value(row, 'quiet_hours_end'),
    timezone: value(row, 'timezone'), minimumIntervalMinutes: value(row, 'minimum_interval_minutes'),
    lastNotifiedAt: value(row, 'last_notified_at'), conditions: decodeExportJson(row.conditions, {}),
    createdAt: value(row, 'created_at'), updatedAt: value(row, 'updated_at'),
    clientUpdatedAt: value(row, 'client_updated_at'), deletedAt: value(row, 'deleted_at'),
  };
}

export function buildCompleteJsonExport(
  snapshot: CompleteExportSnapshot,
  generatedAt = new Date().toISOString(),
): JsonObject {
  return {
    schemaVersion: COMPLETE_EXPORT_SCHEMA_VERSION,
    generatedAt,
    recordPolicy: {
      scope: 'active_records_only',
      tombstonesIncluded: false,
      description: 'Deleted records and internal sync queue entries are excluded.',
    },
    app: { databaseSchemaVersion: snapshot.databaseSchemaVersion },
    account: { cloudOwnerUserId: snapshot.cloudOwnerUserId },
    profile: mapProfile(snapshot.profile),
    exercises: [...snapshot.exercises].sort(compare('name', 'id')).map(mapExercise),
    workouts: [...snapshot.workouts].sort(compare('performed_on', 'started_at', 'id')).map(mapWorkout),
    workoutSets: [...snapshot.workoutSets].sort(compare('workout_id', 'sort_order', 'id')).map(mapWorkoutSet),
    meals: [...snapshot.meals].sort(compare('eaten_on', 'eaten_at', 'id')).map(mapMeal),
    foodItems: [...snapshot.foodItems].sort(compare('meal_id', 'sort_order', 'id')).map(mapFoodItem),
    nutritionTargets: [...snapshot.nutritionTargets].sort(compare('effective_from', 'id')).map(mapNutritionTarget),
    wellnessLogs: [...snapshot.wellnessLogs].sort(compare('logged_at', 'id')).map(mapWellnessLog),
    ai: {
      conversations: [...snapshot.aiConversations].sort(compare('created_at', 'id')).map(mapAiConversation),
      messages: [...snapshot.aiMessages].sort(compare('conversation_id', 'sequence', 'id')).map(mapAiMessage),
    },
    notificationPreferences: [...snapshot.notificationPreferences].sort(compare('type', 'id')).map(mapNotificationPreference),
  };
}

export function stringifyCompleteJsonExport(exportData: JsonObject): string {
  return JSON.stringify(exportData, null, 2);
}
