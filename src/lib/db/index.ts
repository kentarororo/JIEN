export { getDashboardSummary } from './dashboard';
export { describeAiConnectionIssue, getAiConnectionStatus, removePersonalGeminiKey, savePersonalGeminiKey } from './ai-settings';
export type { AiConnectionIssue, AiConnectionStatus } from './ai-settings';
export { syncAccountData } from './cloud-sync';
export type { AccountSyncResult } from './cloud-sync';
export { resetLocalAccountData } from './account-data-reset';
export { deleteCloudAccount } from './account-deletion-api';
export { getAccountSyncHealth, subscribeToAccountSyncHealth } from './sync-health';
export type { AccountSyncHealth, AccountSyncHealthState } from './sync-health';
export { clearRuntimeDiagnostics, getRuntimeDiagnostics, recordRuntimeDiagnostic } from './runtime-diagnostics';
export type { RuntimeDiagnosticCode, RuntimeDiagnostics } from './runtime-diagnostics';
export { listCalendarActivity } from './calendar';
export {
  createCustomExercise,
  exerciseTargetsNeedReview,
  isStarterExerciseId,
  listExercises,
  normalizeExerciseTargets,
  updateExerciseTargets,
} from './exercises';
export type { UpdateExerciseTargetsInput } from './exercises';
export { getCompleteExportSnapshot } from './export';
export {
  analyzeMealPhoto,
  cacheFoodCatalogItems,
  getMealPhotoAnalysisCapability,
  lookupFoodBarcode,
  markFoodCatalogItemUsed,
  searchFoodDatabase,
  searchLocalFoodCatalog,
} from './food-catalog';
export { savePrivateFood } from './private-food';
export type { SavePrivateFoodInput } from './private-food';
export { classifyMealPhotoAnalysisError } from './meal-photo-api';
export type {
  MealPhotoAnalysisFailure,
  MealPhotoCapability,
  MealPhotoCapabilityStatus,
} from './meal-photo-api';
export {
  consumeQueuedMealPhotoResult,
  discardQueuedMealPhoto,
  externalizeLegacyMealPhotoPayloads,
  getMealPhotoQueueSummary,
  getQueuedMealPhotoResult,
  processPendingMealPhotoJobs,
  queueMealPhotoAnalysis,
  retryQueuedMealPhotos,
} from './meal-photo-queue';
export type { MealPhotoQueueSummary, QueuedMealPhotoResult } from './meal-photo-queue';
export { migrateDatabase } from './migrate';
export { getUserProfile, hasCompletedOnboarding, saveUserProfile } from './profile';
export {
  acknowledgeMedicalDisclaimer,
  deleteSleepLog,
  getLatestBodyMeasurement,
  getLatestWellnessCheckIn,
  getSleepLog,
  getWellnessHubSummary,
  listBodyMeasurements,
  listBodyMeasurementsForDate,
  listSleepLogs,
  listSleepLogsForDate,
  saveBodyMeasurement,
  saveSleepLog,
  saveWellnessCheckIn,
  updateSleepLog,
} from './wellness';
export { retryWellnessMessage, sendWellnessMessage } from './wellness-chat';
export {
  deleteMeal,
  ensureStartingNutritionTarget,
  getAdaptiveNutritionHistory,
  getDailyNutrition,
  getMealLoggingPattern,
  getMealDetail,
  getNutritionTarget,
  listMealsForDate,
  listNutritionExportRows,
  saveMeal,
  saveNutritionTarget,
  updateMeal,
} from './nutrition';
export {
  getNotificationPreference,
  getScheduledNotificationId,
  getSetting,
  listNotificationPreferences,
  markNotificationDelivered,
  saveNotificationPreference,
  setScheduledNotificationId,
  setSetting,
} from './settings';
export { getSupabaseClient } from './supabase';
export { getSyncStatus, syncPendingChanges } from './sync-queue';
export {
  completePlannedWorkout,
  deleteWorkout,
  getExerciseHistory,
  getExerciseSessionHistory,
  getNextPlannedWorkout,
  getRecentExerciseSessionSets,
  getWorkoutProgressComparison,
  getWorkoutDetail,
  listRecentWorkouts,
  listUpcomingPlannedWorkouts,
  listPlannedWorkoutsForDate,
  listWorkoutsForDate,
  listVolumeHistory,
  listWorkoutExportRows,
  saveWorkout,
  updateWorkout,
  savePlannedWorkout,
  skipPlannedWorkout,
} from './workouts';
export type * from './types';
