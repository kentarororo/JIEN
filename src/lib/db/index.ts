export { getDashboardSummary } from './dashboard';
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
  saveBodyMeasurement,
  saveWellnessCheckIn,
} from './wellness';
export { retryWellnessMessage, sendWellnessMessage } from './wellness-chat';
export {
  deleteMeal,
  ensureStartingNutritionTarget,
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
  saveNotificationPreference,
  setScheduledNotificationId,
  setSetting,
} from './settings';
export { getSupabaseClient } from './supabase';
export { getSyncStatus, syncPendingChanges } from './sync-queue';
export {
  deleteWorkout,
  getExerciseHistory,
  getLastExerciseSessionSets,
  getWorkoutProgressComparison,
  getWorkoutDetail,
  listRecentWorkouts,
  listWorkoutsForDate,
  listVolumeHistory,
  listWorkoutExportRows,
  saveWorkout,
} from './workouts';
export type * from './types';
