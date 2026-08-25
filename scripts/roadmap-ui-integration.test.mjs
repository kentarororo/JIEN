import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const today = readFileSync(new URL('../src/app/(tabs)/today.tsx', import.meta.url), 'utf8');
const training = readFileSync(new URL('../src/app/(tabs)/train.tsx', import.meta.url), 'utf8');
const exercises = readFileSync(new URL('../src/app/exercises/index.tsx', import.meta.url), 'utf8');

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
