import assert from 'node:assert/strict';
import test from 'node:test';

import { MUSCLE_GROUP_OPTIONS, normalizeMuscleGroupKey } from '../progression/index.ts';
import { DEFAULT_EXERCISES } from './migrate.ts';

test('every built-in exercise has a unique id and canonical muscle targets', () => {
  const validGroups = new Set<string>(MUSCLE_GROUP_OPTIONS.map((option) => option.value));
  assert.equal(DEFAULT_EXERCISES.length, 56);
  assert.equal(new Set(DEFAULT_EXERCISES.map((exercise) => exercise[0])).size, DEFAULT_EXERCISES.length);

  for (const exercise of DEFAULT_EXERCISES) {
    const [id, name, movementPattern, primaryValue, secondaryJson] = exercise;
    const primary = normalizeMuscleGroupKey(String(primaryValue));
    const secondary = (JSON.parse(String(secondaryJson)) as string[]).map(normalizeMuscleGroupKey);
    assert.equal(validGroups.has(primary), true, `${name} (${id}) has a valid primary target`);
    assert.equal(String(movementPattern).trim().length > 0, true, `${name} has a movement pattern`);
    assert.equal(new Set(secondary).size, secondary.length, `${name} has no duplicate assisting targets`);
    assert.equal(secondary.includes(primary), false, `${name} does not repeat its primary target as assisting work`);
    for (const group of secondary) assert.equal(validGroups.has(group), true, `${name} has valid assisting target ${group}`);
  }
});

test('compound and regional mappings retain the reviewed muscle targets', () => {
  const byName = new Map(DEFAULT_EXERCISES.map((exercise) => [exercise[1], exercise]));
  assert.deepEqual(JSON.parse(String(byName.get('Seated Cable Row')?.[4])), ['lats', 'biceps', 'rear_delts']);
  assert.equal(byName.get('Machine Shoulder Press')?.[3], 'front_delts');
  assert.deepEqual(JSON.parse(String(byName.get('Leg Press')?.[4])), ['glutes', 'adductors']);
  assert.equal(byName.get('Cable Crunch')?.[3], 'abs');
  assert.deepEqual(JSON.parse(String(byName.get('Rope Face Pull')?.[4])), ['middle_traps', 'lower_traps', 'rotator_cuff']);
  assert.equal(byName.get('Hip Abduction Machine')?.[3], 'hip_abductors');
  assert.equal(byName.get('Rope Hammer Curl')?.[3], 'brachialis');
  assert.equal(byName.get('Hanging Knee Raise')?.[3], 'hip_flexors');
  assert.equal(byName.get('Cable Wood Chop')?.[3], 'obliques');
  assert.deepEqual(JSON.parse(String(byName.get('Push-up')?.[4])), ['triceps', 'front_delts', 'serratus_anterior']);
});
