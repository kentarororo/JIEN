import type { MuscleGroupAdvisory } from '@/lib/progression';

export type LoadUnit = 'kg' | 'lb';
export type SetKind = 'working' | 'warmup' | 'drop' | 'failure';
export type WorkoutStatus = 'planned' | 'in_progress' | 'completed' | 'skipped';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';
export type MealSource = 'manual' | 'ai_photo' | 'imported';
export type WellnessSource = 'manual' | 'healthkit' | 'health_connect';
export type NotificationType = 'meal_gap' | 'workout_plan' | 'sync_issue';
export type TrainingExperience = 'beginner' | 'intermediate' | 'advanced';
export type FitnessGoal = 'composition' | 'strength' | 'both' | 'general_wellness';

export type UserProfile = {
  trainingExperience: TrainingExperience;
  availableEquipment: string[];
  injuryFlags: string[];
  goals: FitnessGoal[];
  typicalDietPattern: string;
  preferredLoadUnit: LoadUnit;
  aiDataConsent: boolean;
  aiDataConsentedAt: string | null;
  medicalDisclaimerAcknowledgedAt: string | null;
  onboardingCompletedAt: string;
};

export type SaveUserProfileInput = Omit<UserProfile, 'aiDataConsentedAt' | 'medicalDisclaimerAcknowledgedAt' | 'onboardingCompletedAt'>;

export type SaveBodyMeasurementInput = {
  heightCm: number;
  bodyWeightKg: number;
  bodyFatPercent: number | null;
  bodyFatIsEstimated: boolean | null;
};

export type BodyMeasurement = SaveBodyMeasurementInput & {
  id: string;
  loggedAt: string;
};

export type WellnessCheckInInput = {
  moodScore: number | null;
  energyScore: number | null;
  stressScore: number | null;
  sorenessScore: number | null;
  motivationScore: number | null;
  sleepDurationMinutes: number | null;
  sleepQualityScore: number | null;
  injuryFlags: string[];
  notes: string;
};

export type WellnessCheckIn = WellnessCheckInInput & {
  id: string;
  loggedAt: string;
};

export type SleepLogInput = {
  sleepDurationMinutes: number | null;
  sleepQualityScore: number | null;
  notes: string;
};

export type SleepLog = SleepLogInput & {
  id: string;
  loggedOn: string;
  loggedAt: string;
  source: WellnessSource;
};

export type AiMessageRole = 'user' | 'assistant';
export type AiMessageLocalStatus = 'pending' | 'complete' | 'failed';

export type AiMessage = {
  id: string;
  conversationId: string;
  sequence: number;
  role: AiMessageRole;
  content: string;
  createdAt: string;
  localStatus: AiMessageLocalStatus;
  metadata: Record<string, unknown>;
};

export type PlanBriefExercise = {
  exerciseId: string;
  exerciseName: string;
  action: 'start' | 'hold' | 'add_reps' | 'add_load';
  loadValue: number | null;
  loadUnit: LoadUnit;
  targetReps: number[] | null;
  reason: string;
};

export type DeterministicPlanBrief = {
  version: 1;
  generatedAt: string;
  sourceWorkoutId: string | null;
  sourceWorkoutTitle: string | null;
  activeJointFlag: boolean;
  weeklyVolumeKg: number[];
  deloadSignal: { kind: 'none' | 'stagnation' | 'volume_drop'; message: string };
  exercises: PlanBriefExercise[];
};

export type WellnessHubSummary = {
  workoutCount7Days: number;
  trainingVolume7DaysKg: number;
  trainingVolumePrevious7DaysKg: number;
  trainingVolumeChangePercent: number | null;
  nutritionDaysLogged: number;
  averageCalories7Days: number;
  averageProtein7Days: number;
  latestCheckIn: WellnessCheckIn | null;
  plan: DeterministicPlanBrief;
  messages: AiMessage[];
};

export type Exercise = {
  id: string;
  name: string;
  movementPattern: string;
  primaryMuscleGroup: string;
  secondaryMuscleGroups: string[];
  equipment: string | null;
  targetRepMin: number;
  targetRepMax: number;
  loadIncrement: number;
  notes: string | null;
  isArchived: boolean;
};

export type WorkoutSetInput = {
  id?: string;
  reps: number;
  loadValue: number;
  loadUnit: LoadUnit;
  rpe?: number | null;
  kind?: SetKind;
};

export type UpdateWorkoutInput = SaveWorkoutInput;

export type SaveWorkoutInput = {
  id?: string;
  /** Device-only recovery key removed in the same transaction as the saved workout. */
  recoveryDraftKey?: string;
  title: string;
  startedAt: string;
  notes?: string;
  exercises: Array<{
    exercise: Exercise;
    sets: WorkoutSetInput[];
  }>;
};

export type PlannedWorkoutSet = {
  loadValue: number | null;
  loadUnit: LoadUnit;
  reps: number | null;
  rpe?: number | null;
};

export type PlannedWorkoutExercise = {
  exerciseId: string;
  exerciseName: string;
  primaryMuscleGroup: string;
  targetRepMin: number;
  targetRepMax: number;
  sets: PlannedWorkoutSet[];
  progression: {
    action: 'start' | 'hold' | 'add_reps' | 'add_load';
    reason: string;
    cues: Array<{
      workingSetIndex: number;
      action: 'add_reps' | 'add_load';
      loadValue: number;
      targetReps: number;
      changePercent: number | null;
      label: string;
    }>;
  };
};

export type PlannedWorkoutPlan = {
  version: 1;
  exercises: PlannedWorkoutExercise[];
  jointProgressionChoice?: 'hold' | 'continue';
  programContext?: TrainingProgramContext;
};

export type TrainingSplitId = 'push_pull_legs' | 'upper_lower' | 'full_body';

export type TrainingProgramContext = {
  splitId: TrainingSplitId;
  sessionIndex: number;
  availableMinutes: 30 | 45 | 60 | 90;
  missedSessionPolicy: 'reschedule' | 'skip';
};

export type SavePlannedWorkoutInput = {
  id?: string;
  title: string;
  performedOn: string;
  scheduledAt: string | null;
  notes?: string;
  exercises: PlannedWorkoutExercise[];
  jointProgressionChoice?: 'hold' | 'continue';
  programContext?: TrainingProgramContext;
};

export type WorkoutSummary = {
  id: string;
  title: string;
  performedOn: string;
  startedAt: string | null;
  completedAt: string | null;
  status: WorkoutStatus;
  setCount: number;
  exerciseCount: number;
  totalVolumeKg: number;
  muscleGroups: string[];
  exerciseNames: string[];
  scheduledAt: string | null;
};

export type ExerciseHistorySet = {
  id: string;
  reps: number;
  loadValue: number;
  loadUnit: LoadUnit;
  rpe: number | null;
};

export type ExerciseHistorySession = {
  workoutId: string;
  workoutTitle: string;
  performedOn: string;
  completedAt: string;
  volumeKg: number;
  sets: ExerciseHistorySet[];
};

export type ExerciseSessionHistory = {
  exerciseId: string;
  exerciseName: string;
  primaryMuscleGroup: string;
  targetRepMin: number;
  targetRepMax: number;
  sessions: ExerciseHistorySession[];
};

export type WorkoutSet = WorkoutSetInput & {
  id: string;
  exerciseId: string;
  exerciseName: string;
  primaryMuscleGroup: string;
  secondaryMuscleGroups: string[];
  targetRepMin: number;
  targetRepMax: number;
  loadIncrement: number;
  completedAt: string;
  sortOrder: number;
};

export type WorkoutDetail = WorkoutSummary & {
  notes: string | null;
  sets: WorkoutSet[];
  plan: PlannedWorkoutPlan | null;
};

export type ExerciseProgressComparison = {
  exerciseId: string;
  exerciseName: string;
  currentVolumeKg: number;
  baselineVolumeKg: number | null;
  baselineSessionCount: number;
  changePercent: number | null;
};

export type WorkoutProgressComparison = {
  workoutId: string;
  comparableExerciseCount: number;
  improvedExerciseCount: number;
  currentComparableVolumeKg: number;
  baselineComparableVolumeKg: number;
  overallChangePercent: number | null;
  exercises: ExerciseProgressComparison[];
};

export type FoodItemInput = {
  name: string;
  quantity: number;
  unit: string;
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fibreG?: number | null;
  source?: MealSource;
  confidence?: number | null;
};

export type FoodCatalogItem = {
  id: string;
  name: string;
  brand: string | null;
  servingQuantity: number;
  servingUnit: string;
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fibreG: number | null;
  source: 'starter' | 'custom' | 'usda_fdc' | 'open_food_facts' | 'fatsecret' | 'ai_photo';
  sourceRef: string | null;
  barcode: string | null;
  confidence: number | null;
};

export type SaveMealInput = {
  name: string;
  type: MealType;
  eatenAt: string;
  notes?: string;
  aiContext?: string | null;
  items: FoodItemInput[];
};

export type MacroTotals = {
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fibreG: number;
};

export type MealSummary = MacroTotals & {
  id: string;
  name: string;
  type: MealType | null;
  eatenAt: string;
  itemCount: number;
};

export type MealItemSnapshot = Omit<FoodItemInput, 'fibreG' | 'source' | 'confidence'> & {
  id: string;
  sortOrder: number;
  fibreG: number | null;
  source: MealSource;
  confidence: number | null;
  originalSource: MealSource;
  originalConfidence: number | null;
  isUserEdited: boolean;
};

export type MealDetail = MealSummary & {
  eatenOn: string;
  source: MealSource;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  isUserEdited: boolean;
  items: MealItemSnapshot[];
};

export type UpdateMealInput = {
  name: string;
  eatenAt: string;
  items: Array<Pick<
    MealItemSnapshot,
    'id' | 'name' | 'quantity' | 'unit' | 'caloriesKcal' | 'proteinG' | 'carbohydrateG' | 'fatG' | 'fibreG'
  >>;
};

export type NutritionTarget = MacroTotals & {
  id: string;
  effectiveFrom: string;
  desiredWeeklyWeightChangePercent: number;
};

export type DailyNutrition = {
  date: string;
  totals: MacroTotals;
  target: NutritionTarget | null;
  meals: MealSummary[];
};

export type CalendarDayActivity = {
  date: string;
  workoutCount: number;
  plannedWorkoutCount: number;
  workingSetCount: number;
  trainingWorkKg: number;
  mealCount: number;
  caloriesKcal: number;
  proteinG: number;
  bodyMeasurementCount: number;
  sleepLogCount: number;
  sleepDurationMinutes: number;
};

export type NotificationPreference = {
  id: string;
  type: NotificationType;
  enabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string;
  minimumIntervalMinutes: number;
  lastNotifiedAt: string | null;
  conditions: Record<string, unknown>;
};

export type SyncStatus = {
  pendingCount: number;
  failedCount: number;
  actionRequiredCount: number;
  lastError: string | null;
};

export type DashboardSummary = {
  workoutCountThisWeek: number;
  weeklyVolumeKg: number;
  latestWorkout: WorkoutSummary | null;
  workoutProgress: WorkoutProgressComparison | null;
  trainingAdvisory: MuscleGroupAdvisory;
  latestBodyMeasurement: BodyMeasurement | null;
  nutrition: DailyNutrition;
};

export type WorkoutExportRow = {
  workoutId: string;
  performedOn: string;
  workoutTitle: string;
  exercise: string;
  muscleGroup: string;
  setNumber: number;
  kind: SetKind;
  reps: number;
  load: number;
  unit: LoadUnit;
  rpe: number | null;
  volumeKg: number;
};

export type VolumeHistorySet = {
  reps: number;
  loadValue: number;
  loadUnit: LoadUnit;
  kind: SetKind;
  completedAt: string;
  movementPattern: string;
  primaryMuscleGroup: string;
  secondaryMuscleGroups: string[];
};

export type NutritionExportRow = {
  mealId: string;
  eatenOn: string;
  eatenAt: string;
  mealName: string;
  mealType: MealType | null;
  food: string;
  quantity: number;
  unit: string;
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fibreG: number | null;
};
