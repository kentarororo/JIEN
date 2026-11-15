import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { autoMatchImportedExercises, deterministicImportUuid, importedExerciseSearchText, parseWorkoutCsv, WorkoutCsvError } from './workout-csv.ts';

// Synthetic fixtures only (#20 AC6): no real export or user data lives in the repo.
const fixture = (name: string) => readFileSync(new URL(`../../../e2e/fixtures/${name}`, import.meta.url), 'utf8');

test('Hevy export: detected, grouped into workouts, sets ordered, kinds and RPE kept (#20 AC1-AC3)', () => {
  const preview = parseWorkoutCsv(fixture('hevy-workouts-synthetic.csv'));
  assert.equal(preview.source, 'hevy');
  assert.equal(preview.workoutCount, 2);
  assert.equal(preview.setCount, 7, 'the duration-only plank row has no reps and is skipped');
  assert.equal(preview.firstDate, '2026-09-01');
  assert.equal(preview.lastDate, '2026-09-04');
  assert.deepEqual(preview.exerciseNames, ['Barbell Bench Press', 'QA Cable Fly (Synthetic)']);
  const [pushA, pushB] = preview.workouts;
  assert.equal(pushA!.title, 'QA Push A');
  assert.equal(pushA!.notes, 'Synthetic fixture, no real data', 'quoted commas stay inside the field');
  assert.equal(pushB!.notes, null);
  const bench = pushA!.sets.filter((set) => set.exerciseName === 'Barbell Bench Press');
  assert.deepEqual(bench.map((set) => [set.kind, set.loadValue, set.loadUnit, set.reps, set.rpe]), [
    ['warmup', 40, 'kg', 10, null],
    ['working', 80, 'kg', 8, 8],
    ['working', 80, 'kg', 7, 9],
  ]);
  assert.deepEqual(pushA!.sets.filter((set) => set.exerciseName.startsWith('QA Cable')).map((set) => set.kind), ['working', 'drop']);
  assert.equal(pushB!.sets.find((set) => set.exerciseName.startsWith('QA Cable'))!.kind, 'failure');
  assert.equal(pushB!.sets[0]!.loadValue, 82.5);
});

test('Hevy export in pounds keeps lb loads (#20 AC3)', () => {
  const csv = [
    'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_lbs,reps,distance_miles,duration_seconds,rpe',
    'QA Lb Day,2026-09-03 07:00:00,2026-09-03 08:00:00,,Barbell Bench Press,,,0,normal,185,5,,,',
  ].join('\n');
  const [set] = parseWorkoutCsv(csv).workouts[0]!.sets;
  assert.deepEqual([set!.loadValue, set!.loadUnit], [185, 'lb']);
});

test('Strong export: detected, kg by default, lb when the weight says so (#20 AC1, AC3)', () => {
  const preview = parseWorkoutCsv(fixture('strong-workouts-synthetic.csv'));
  assert.equal(preview.source, 'strong');
  assert.equal(preview.workoutCount, 2);
  assert.equal(preview.setCount, 4);
  assert.equal(preview.firstDate, '2026-09-02');
  assert.equal(preview.lastDate, '2026-09-05');
  assert.equal(preview.workouts[0]!.notes, 'Synthetic, no real data');
  const squats = preview.workouts[0]!.sets.filter((set) => set.exerciseName === 'QA Hack Squat (Synthetic)');
  assert.deepEqual(squats.map((set) => [set.setOrder, set.loadValue, set.loadUnit, set.reps, set.rpe]), [[1, 100, 'kg', 10, null], [2, 110, 'kg', 8, 8.5]]);

  const lb = parseWorkoutCsv([
    'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
    '2026-09-06 07:00:00,QA Lb,40m,Barbell Bench Press,1,135 lbs,8,0,0,,,',
  ].join('\r\n'));
  assert.deepEqual([lb.workouts[0]!.sets[0]!.loadValue, lb.workouts[0]!.sets[0]!.loadUnit], [135, 'lb']);
});

test('unknown, empty and malformed CSVs are rejected with a clear message before any write (#20 AC1)', () => {
  assert.throws(() => parseWorkoutCsv('date,food,kcal\n2026-09-01,rice,300'), (error: unknown) =>
    error instanceof WorkoutCsvError && /Unknown workout CSV format/.test(error.message));
  assert.throws(() => parseWorkoutCsv(''), WorkoutCsvError);
  assert.throws(() => parseWorkoutCsv(fixture('strong-workouts-synthetic.csv').split('\n')[0]!), WorkoutCsvError);
  const header = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE';
  assert.throws(() => parseWorkoutCsv(`${header}\nnot a date,QA,1m,Squat,1,100,5,0,0,,,`), /unsupported date/);
  assert.throws(() => parseWorkoutCsv(`${header}\n2026-09-01 07:00:00,QA,1m,Squat,1,-5,5,0,0,,,`), /invalid weight/);
  assert.throws(() => parseWorkoutCsv(`${header}\n2026-09-01 07:00:00,"QA,1m,Squat,1,5,5,0,0,,,`), /unfinished quoted value/);
  assert.throws(() => parseWorkoutCsv(`${header}\n2026-02-30 07:00:00,QA,1m,Squat,1,5,5,0,0,,,`), /unsupported date/);
});

test('a byte-order mark from a spreadsheet save does not hide the format (#20 AC1)', () => {
  assert.equal(parseWorkoutCsv(`\uFEFF${fixture('strong-workouts-synthetic.csv')}`).source, 'strong');
});

test('exact catalogue names auto-match regardless of case and punctuation; others stay unmatched (#20 AC2)', () => {
  const catalogue = [{ id: 'bench', name: 'Barbell Bench Press' }, { id: 'squat', name: 'Back Squat' }];
  assert.deepEqual(
    autoMatchImportedExercises(['barbell bench-press', 'QA Cable Fly (Synthetic)', 'Back Squat'], catalogue),
    { 'barbell bench-press': 'bench', 'Back Squat': 'squat' },
  );
});

test('import ids are stable for the same source row and differ across rows (#20 AC4)', () => {
  const first = parseWorkoutCsv(fixture('hevy-workouts-synthetic.csv'));
  const second = parseWorkoutCsv(fixture('hevy-workouts-synthetic.csv'));
  assert.deepEqual(first.workouts.map((workout) => workout.sourceKey), second.workouts.map((workout) => workout.sourceKey));
  const id = deterministicImportUuid(`ns\u001fworkout\u001f${first.workouts[0]!.sourceKey}`);
  assert.equal(id, deterministicImportUuid(`ns\u001fworkout\u001f${second.workouts[0]!.sourceKey}`));
  assert.notEqual(id, deterministicImportUuid(`ns\u001fworkout\u001f${first.workouts[1]!.sourceKey}`));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('Hevy/Strong "Name (Equipment)" titles auto-match catalogue names in any word order (#20 AC2, PR #46 re-test)', () => {
  const catalogue = [
    { id: 'bench', name: 'Barbell Bench Press' },
    { id: 'db-bench', name: 'Dumbbell Bench Press' },
    { id: 'ohp', name: 'Barbell Overhead Press' },
    { id: 'row', name: 'Barbell Bent-over Row' },
    { id: 'pullup', name: 'Pull-up' },
  ];
  assert.deepEqual(
    autoMatchImportedExercises(['Bench Press (Barbell)', 'Bench Press (Dumbbell)', 'Overhead Press (Barbell)', 'Bent Over Row (Barbell)', 'Pull Up', 'Deadlift (Barbell)'], catalogue),
    { 'Bench Press (Barbell)': 'bench', 'Bench Press (Dumbbell)': 'db-bench', 'Overhead Press (Barbell)': 'ohp', 'Bent Over Row (Barbell)': 'row', 'Pull Up': 'pullup' },
    'equipment in brackets still has to agree, so a dumbbell press never lands on the barbell entry',
  );
});

test('"Map to existing" search text drops the trailing (Equipment) suffix only (#20 AC2, PR #46 re-test)', () => {
  assert.equal(importedExerciseSearchText('Bench Press (Barbell)'), 'Bench Press');
  assert.equal(importedExerciseSearchText('Triceps Pushdown (Cable - Straight Bar)'), 'Triceps Pushdown');
  assert.equal(importedExerciseSearchText('Pull Up'), 'Pull Up');
  assert.equal(importedExerciseSearchText('  Leg Press (Machine)  '), 'Leg Press');
});
