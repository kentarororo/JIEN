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
const settings = readFileSync(new URL('../src/app/(tabs)/settings.tsx', import.meta.url), 'utf8');
const privateFood = readFileSync(new URL('../src/lib/db/private-food.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/components/ui.tsx', import.meta.url), 'utf8');

test('Today is week-first while preserving the month and day workspace', () => {
  assert.match(today, /const \[monthExpanded, setMonthExpanded\] = useState\(false\)/);
  assert.match(today, /monthExpanded \? cells : weekCells/);
  assert.match(today, /label=\{monthExpanded \? 'Show week' : 'Show month'\}/);
  assert.match(today, /<Button label="Open day"/);
  assert.match(today, /isRepeatedCalendarDayActivation/);
});

test('Today leads with the reusable Warm Utility hero and factual daily signals', () => {
  assert.match(today, /<HeroPanel/);
  assert.match(today, /accessibilityLabel="Today summary"/);
  assert.match(today, /todayActivity\?\.workoutCount/);
  assert.match(today, /summary\.nutrition\.meals\.length/);
  assert.match(today, /todayActivity\?\.sleepLogCount/);
  assert.match(today, /<ActionCard tone="accent" title="Log workout"/);
  assert.match(ui, /export function HeroPanel/);
  assert.match(ui, /tone\?: 'default' \| 'accent'/);
  assert.doesNotMatch(today, /#[\da-fA-F]{6}/, 'screen colors must come from semantic theme tokens');
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

test('Settings separates general preferences, reminders, and local data controls', () => {
  assert.match(settings, /useState<'general' \| 'reminders' \| 'data'>\('general'\)/);
  assert.match(settings, /accessibilityRole="tablist"/);
  assert.match(settings, /label="General"[\s\S]*label="Reminders"[\s\S]*label="Data"/);
  assert.match(settings, /settingsView === 'general'[\s\S]*Profile[\s\S]*Appearance[\s\S]*AI connection/);
  assert.match(settings, /settingsView === 'reminders'[\s\S]*Possible missing meal[\s\S]*Planned workout approaching[\s\S]*Sync needs attention/);
  assert.match(settings, /settingsView === 'data'[\s\S]*Account and sync[\s\S]*SQLite remains the on-device source of truth[\s\S]*Export/);
  assert.doesNotMatch(settings, /#[\da-fA-F]{6}/, 'settings colors must come from semantic theme tokens');
});

test('Shared fields expose their visible labels to assistive technology', () => {
  assert.match(ui, /accessibilityLabel=\{props\.accessibilityLabel \?\? label\}/);
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

test('Meal search reports actual sources and keeps provider attribution concise', () => {
  const catalog = readFileSync(new URL('../src/lib/db/food-catalog.ts', import.meta.url), 'utf8');
  const openFoodFacts = readFileSync(new URL('../src/lib/db/open-food-facts.ts', import.meta.url), 'utf8');
  const serverSearch = readFileSync(new URL('../supabase/functions/_shared/open-food-facts-search.ts', import.meta.url), 'utf8');
  const edgeFunction = readFileSync(new URL('../supabase/functions/food-search/index.ts', import.meta.url), 'utf8');
  assert.match(mealLogger, /onlineFoodSourceSummary\(items\)/);
  assert.match(mealLogger, /Sources appear on each result/);
  assert.doesNotMatch(mealLogger, /Licensed FatSecret Platform results/);
  assert.match(catalog, /rankOpenFoodFactsProductsForSingapore\(response\.products/);
  assert.match(serverSearch, /https:\/\/search\.openfoodfacts\.org\/search/);
  assert.match(serverSearch, /method: 'POST'/);
  assert.match(catalog, /acceptedSources: \['open_food_facts'\]/);
  assert.match(edgeFunction, /acceptedSources\.includes\('open_food_facts'\)/);
  assert.match(edgeFunction, /source: 'open_food_facts', promise: searchOpenFoodFactsFoods\(clean\)/);
  assert.match(openFoodFacts, /countries_tags/);
  assert.match(openFoodFacts, /normalized === 'singapore'/);
});
