export type LoadUnit = 'kg' | 'lb';
export type SetKind = 'working' | 'warmup' | 'drop' | 'failure';
export type WorkoutStatus = 'planned' | 'in_progress' | 'completed' | 'skipped';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';
export type NotificationType = 'meal_gap' | 'workout_plan' | 'sync_issue';

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
  reps: number;
  loadValue: number;
  loadUnit: LoadUnit;
  rpe?: number | null;
  kind?: SetKind;
};

export type SaveWorkoutInput = {
  title: string;
  startedAt: string;
  notes?: string;
  exercises: Array<{
    exercise: Exercise;
    sets: WorkoutSetInput[];
  }>;
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
};

export type SaveMealInput = {
  name: string;
  type: MealType;
  eatenAt: string;
  notes?: string;
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

export type NutritionTarget = MacroTotals & {
  id: string;
  effectiveFrom: string;
};

export type DailyNutrition = {
  date: string;
  totals: MacroTotals;
  target: NutritionTarget | null;
  meals: MealSummary[];
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
  lastError: string | null;
};

export type DashboardSummary = {
  workoutCountThisWeek: number;
  weeklyVolumeKg: number;
  latestWorkout: WorkoutSummary | null;
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
