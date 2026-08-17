export { getDashboardSummary } from './dashboard';
export { describeAiConnectionIssue, getAiConnectionStatus, removePersonalGeminiKey, savePersonalGeminiKey } from './ai-settings';
export type { AiConnectionIssue, AiConnectionStatus } from './ai-settings';
export { syncAccountData } from './cloud-sync';
export type { AccountSyncResult } from './cloud-sync';
export { listCalendarActivity } from './calendar';
export { createCustomExercise, listExercises } from './exercises';
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
export { classifyMealPhotoAnalysisError } from './meal-photo-api';
export type {
  MealPhotoAnalysisFailure,
  MealPhotoCapability,
  MealPhotoCapabilityStatus,
} from './meal-photo-api';
export {
  consumeQueuedMealPhotoResult,
  discardQueuedMealPhoto,
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
  getLatestBodyMeasurement,
  getLatestWellnessCheckIn,
  getWellnessHubSummary,
  listBodyMeasurements,
  listBodyMeasurementsForDate,
  saveBodyMeasurement,
  saveWellnessCheckIn,
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
  getNextPlannedWorkout,
  getLastExerciseSessionSets,
  getWorkoutProgressComparison,
  getWorkoutDetail,
  listRecentWorkouts,
  listUpcomingPlannedWorkouts,
  listPlannedWorkoutsForDate,
  listWorkoutsForDate,
  listVolumeHistory,
  listWorkoutExportRows,
  saveWorkout,
  savePlannedWorkout,
  skipPlannedWorkout,
} from './workouts';
export type * from './types';
