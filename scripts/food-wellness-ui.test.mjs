import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const food = readFileSync(new URL('../src/app/(tabs)/food.tsx', import.meta.url), 'utf8');
const wellness = readFileSync(new URL('../src/app/(tabs)/wellness.tsx', import.meta.url), 'utf8');

test('Food keeps logging primary while progressively disclosing nutrition detail', () => {
  assert.match(food, /action=\{<Button label="Add meal"[\s\S]*?pathname: '\/meals\/new'/);
  assert.match(food, /const \[showNutritionDetails, setShowNutritionDetails\] = useState\(false\)/);
  assert.ok(
    food.indexOf('<View style={styles.macroSummary}>') < food.indexOf('{showNutritionDetails ? ('),
    'the current macro snapshot should remain visible before detailed nutrition is disclosed',
  );
  assert.match(food, /showNutritionDetails \? 'Hide nutrition details' : 'Nutrition details'/);
  assert.match(food, /expanded=\{showNutritionDetails\}/);
  assert.match(food, /<MacroCalorieSplit[\s\S]*?<Button label=\{nutrition\.target \? 'Edit macro targets' : 'Set macro targets'\}/);
  assert.match(food, /retryQueuedMealPhotos/);
  assert.match(food, /discardQueuedMealPhoto/);
  assert.match(food, /label="Review latest result"[\s\S]*?variant="secondary"/);
  assert.match(food, /mealPressable: \{ minHeight: 44 \}/);
  assert.match(food, /actionRow: \{ flexDirection: 'row', flexWrap: 'wrap'/);
  assert.doesNotMatch(food, /#[\da-fA-F]{6}/, 'screen colors must come from semantic theme tokens');
});

test('Wellness is check-in first and discloses secondary context without changing consent gates', () => {
  assert.match(wellness, /const \[showCheckInDetails, setShowCheckInDetails\] = useState\(false\)/);
  assert.match(wellness, /const \[showProgression, setShowProgression\] = useState\(false\)/);
  assert.match(wellness, /const \[showGuidance, setShowGuidance\] = useState\(trainingReview === '1'\)/);
  assert.ok(
    wellness.indexOf('<Button label="Save check-in"') < wellness.indexOf('<SectionHeading title="This week"'),
    'the local check-in action should lead the screen',
  );
  assert.match(wellness, /showCheckInDetails \? \([\s\S]*?router\.push\('\/wellness\/sleep'/);
  assert.match(wellness, /showProgression && summary\.plan\.exercises\.length/);
  assert.match(wellness, /label="Explain these steps"[\s\S]*?setShowGuidance\(true\)[\s\S]*?void ask/);
  assert.match(wellness, /showGuidance \? \([\s\S]*?aiDataConsent[\s\S]*?medicalDisclaimerAcknowledgedAt/);
  assert.match(wellness, /sendWellnessMessage\(db, text, summary\.plan, mode\)/);
  assert.match(wellness, /label="Send"[\s\S]*?variant="secondary"/);
  assert.match(wellness, /signalGrid: \{ flexDirection: 'row', flexWrap: 'wrap'/);
  assert.match(wellness, /recordRow: \{ flexDirection: 'row', flexWrap: 'wrap'/);
  assert.match(wellness, /iconWell: \{ width: 44, height: 44/);
  assert.match(wellness, /accessibilityRole="radiogroup"/);
  assert.match(wellness, /accessibilityLabel=\{`\$\{label\}, \$\{score\} of 5`\}/);
  assert.match(wellness, /expanded=\{showCheckInDetails\}/);
  assert.match(wellness, /expanded=\{showProgression\}/);
  assert.match(wellness, /expanded=\{showGuidance\}/);
  assert.doesNotMatch(wellness, /#[\da-fA-F]{6}/, 'screen colors must come from semantic theme tokens');
});
