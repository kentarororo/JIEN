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
  assert.match(workoutLogger, /Progression paused/);
  assert.match(workoutLogger, /saveWorkout/);
  assert.match(workoutLogger, /completePlannedWorkout/);
  assert.match(workoutLogger, /updateWorkout/);
});

test('Workout set completion connects local history to the five-percent progression review', () => {
  assert.match(workoutLogger, /const \[completedBlockKeys, setCompletedBlockKeys\] = useState<string\[\]>\(\[\]\)/);
  assert.match(workoutLogger, /buildCompletedExerciseVolumeFeedback\(\{[\s\S]*currentSets: draftSetsForProgression\(block\.sets, unit\)[\s\S]*previousSets: block\.sourceSets/);
  assert.match(workoutLogger, /\{ \.\.\.block, progression, sourceSets: history \}/, 'the history fetched for the visible cue is retained for completed-set comparison');
  assert.match(workoutLogger, /function completeSets\(blockKey: string\)[\s\S]*setCompletedBlockKeys/);
  assert.match(workoutLogger, /label=\{setsComplete \? 'Check again' : 'Complete sets'\}/);
  assert.match(workoutLogger, /5% VOLUME GUIDE/);
  assert.match(workoutLogger, /function markBlockIncomplete[\s\S]*updateSet[\s\S]*markBlockIncomplete\(blockKey\)/);
  assert.match(workoutLogger, /Next time[\s\S]*formatCompletionCues/);
});
