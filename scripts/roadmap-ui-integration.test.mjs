import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const today = readFileSync(new URL('../src/app/(tabs)/today.tsx', import.meta.url), 'utf8');
const training = readFileSync(new URL('../src/app/(tabs)/train.tsx', import.meta.url), 'utf8');
const exercises = readFileSync(new URL('../src/app/exercises/index.tsx', import.meta.url), 'utf8');
const workoutPlan = readFileSync(new URL('../src/app/workouts/plan.tsx', import.meta.url), 'utf8');
const tabLayout = readFileSync(new URL('../src/app/(tabs)/_layout.tsx', import.meta.url), 'utf8');
const rootLayout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
const workoutLogger = readFileSync(new URL('../src/app/workouts/new.tsx', import.meta.url), 'utf8');
const mealLogger = readFileSync(new URL('../src/app/meals/new.tsx', import.meta.url), 'utf8');
const privateFood = readFileSync(new URL('../src/lib/db/private-food.ts', import.meta.url), 'utf8');

test('Today is week-first while preserving the month and day workspace', () => {
  assert.match(today, /const \[monthExpanded, setMonthExpanded\] = useState\(false\)/);
  assert.match(today, /monthExpanded \? cells : weekCells/);
  assert.match(today, /label=\{monthExpanded \? 'Show week' : 'Show month'\}/);
  assert.match(today, /<Button label="Open day"/);
  assert.match(today, /isRepeatedCalendarDayActivation/);
});

test('Training separates overview from searchable history without dropping either journey', () => {
  assert.match(training, /useState<'overview' \| 'history'>\('overview'\)/);
  assert.match(training, /trainingView === 'overview'/);
  assert.match(training, /trainingView === 'history'/);
  assert.match(training, /Find a workout or exercise/);
  assert.match(training, /Exercise targets/);
});

test('Exercise review is incremental, reason-coded, and keeps every target selectable', () => {
  assert.match(exercises, /useState\(24\)/);
  assert.match(exercises, /filteredExercises\.slice\(0, catalogLimit\)/);
  assert.match(exercises, /Duplicate name/);
  assert.match(exercises, /exerciseTargetsNeedReview/);
  assert.match(exercises, /MUSCLE_GROUP_SECTIONS\.map[\s\S]*setActiveSection/);
  assert.match(exercises, /updateExerciseTargets/);
});

test('Workout planning keeps repeat, scheduling, catalog, and save in one progressive journey', () => {
  assert.match(workoutPlan, /Repeat latest session/);
  assert.match(workoutPlan, /showScheduleEditor/);
  assert.match(workoutPlan, /expanded=\{showScheduleEditor\}/);
  assert.match(workoutPlan, /Quick date/);
  assert.match(workoutPlan, /Exact date/);
  assert.match(workoutPlan, /results\.slice\(0, catalogLimit\)/);
  assert.match(workoutPlan, /savePlannedWorkout/);
  assert.match(workoutPlan, /router\.replace/);
  assert.doesNotMatch(workoutPlan, /<ScreenHeading/, 'the native modal header is the sole level-one heading');
});

test('Navigation exposes one tab bar and keeps core targets at least 44 points', () => {
  assert.match(tabLayout, /tabBar=\{\(\) => null\}/);
  assert.match(tabLayout, /detachInactiveScreens/);
  assert.match(tabLayout, /freezeOnBlur: true/);
  assert.match(today, /screenCompact: \{ paddingHorizontal: spacing\.md \}/);
  assert.match(today, /calendarCardCompact: \{ paddingHorizontal: 0 \}/);
  assert.match(rootLayout, /headerBack: \{ width: 44, height: 44/);
});

test('Workout logging keeps guidance available without delaying set entry', () => {
  assert.match(workoutLogger, /const \[showRpeGuide, setShowRpeGuide\] = useState\(false\)/);
  assert.match(workoutLogger, /showRpeGuide \? 'Hide RPE guide' : 'RPE guide'/);
  assert.match(workoutLogger, /expanded=\{showRpeGuide\}/);
  assert.match(workoutLogger, /\{showRpeGuide \? \(/);
  assert.match(workoutLogger, /JointProgressionChoicePanel/);
  assert.match(workoutLogger, /jointProgressionChoice === 'hold'/);
  assert.match(workoutLogger, /chooseJointProgression[\s\S]*historyStatus: 'idle'/, 'changing the session choice rebuilds every visible progression suggestion');
  assert.match(workoutLogger, /saveWorkout/);
  assert.match(workoutLogger, /completePlannedWorkout/);
  assert.match(workoutLogger, /updateWorkout/);
});

test('Joint considerations recommend a hold but preserve an explicit session choice', () => {
  const choicePanel = readFileSync(new URL('../src/components/joint-progression-choice.tsx', import.meta.url), 'utf8');
  const planning = readFileSync(new URL('../src/app/workouts/plan.tsx', import.meta.url), 'utf8');
  const repository = readFileSync(new URL('../src/lib/db/workouts.ts', import.meta.url), 'utf8');
  assert.match(choicePanel, /Hold progression[\s\S]*Recommended:/);
  assert.match(choicePanel, /Continue progression[\s\S]*suggestions for this session/);
  assert.match(choicePanel, /changes suggestions only/);
  assert.match(planning, /jointProgressionChoice: hasJointConsideration \? jointProgressionChoice : undefined/);
  assert.match(repository, /jointProgressionChoice: input\.jointProgressionChoice/);
});

test('Workout set completion connects local history to the five-percent progression review', () => {
  assert.match(workoutLogger, /const \[completedBlockKeys, setCompletedBlockKeys\] = useState<string\[\]>\(\[\]\)/);
  assert.match(workoutLogger, /buildCompletedExerciseVolumeFeedback\(\{[\s\S]*currentSets: draftSetsForProgression\(block\.sets, unit\)[\s\S]*previousSets: block\.sourceSets/);
  assert.match(workoutLogger, /\{ \.\.\.block, progression, sourceSets: history, historyStatus: 'ready'/, 'the history fetched for the visible cue is retained for completed-set comparison');
  assert.match(workoutLogger, /block\.exerciseId !== exerciseId \|\| block\.historyRequestId !== requestId/, 'an obsolete lookup cannot attach history to a changed or superseded exercise request');
  assert.match(workoutLogger, /historyStatus === 'idle'/, 'only idle exercise histories are loaded automatically');
  assert.match(workoutLogger, /historyStatus: 'error'/, 'history failures settle into a recoverable state instead of an endless loading panel');
  assert.match(workoutLogger, /Recent sets unavailable[\s\S]*Retry history/, 'failed history reads explain that entered sets are safe and offer an explicit retry');
  assert.match(workoutLogger, /function completeSets\(blockKey: string\)[\s\S]*setCompletedBlockKeys/);
  assert.match(workoutLogger, /label=\{setsComplete \? 'Check again' : 'Complete sets'\}/);
  assert.match(workoutLogger, /5% VOLUME GUIDE/);
  assert.match(workoutLogger, /function markBlockIncomplete[\s\S]*updateSet[\s\S]*markBlockIncomplete\(blockKey\)/);
  assert.match(workoutLogger, /Next time[\s\S]*formatCompletionCues/);
});

test('Meal no-match entry saves an editable private food through the SQLite catalog', () => {
  assert.match(mealLogger, /No database matches found/);
  assert.match(mealLogger, /Create private food/);
  assert.match(mealLogger, /catch \(cause\) \{[\s\S]*?setNoMatchQuery\(cleanQuery\)[\s\S]*?still create a private food below/);
  assert.match(mealLogger, /savePrivateFood\(db, \{/);
  assert.match(mealLogger, /Save as private food/);
  assert.match(mealLogger, /Update private food/);
  assert.match(mealLogger, /source === 'custom'/);
  assert.match(privateFood, /withExclusiveTransaction\(db, async \(transactionDb\)/);
  assert.match(privateFood, /ON CONFLICT\(id\) DO UPDATE SET/);
  assert.match(privateFood, /last_used_at = excluded\.last_used_at/);
});
