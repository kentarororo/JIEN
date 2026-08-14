export { getDashboardSummary } from './dashboard';
export { syncAccountData } from './cloud-sync';
export type { AccountSyncResult } from './cloud-sync';
export { listCalendarActivity } from './calendar';
export { createCustomExercise, listExercises } from './exercises';
export {
  analyzeMealPhoto,
  cacheFoodCatalogItems,
  lookupFoodBarcode,
  markFoodCatalogItemUsed,
  searchFoodDatabase,
  searchLocalFoodCatalog,
} from './food-catalog';
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
  ensureStartingNutritionTarget,
  getDailyNutrition,
  getNutritionTarget,
  listNutritionExportRows,
  saveMeal,
  saveNutritionTarget,
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
  getExerciseHistory,
  getLastExerciseSessionSets,
  getWorkoutProgressComparison,
  getWorkoutDetail,
  listRecentWorkouts,
  listVolumeHistory,
  listWorkoutExportRows,
  saveWorkout,
} from './workouts';
export type * from './types';
