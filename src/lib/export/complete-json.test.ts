import assert from 'node:assert/strict';
import test from 'node:test';

import type { CompleteExportSnapshot } from '../db/export.ts';
import {
  buildCompleteJsonExport,
  decodeExportJson,
  stringifyCompleteJsonExport,
} from './complete-json.ts';

function snapshot(overrides: Partial<CompleteExportSnapshot> = {}): CompleteExportSnapshot {
  return {
    databaseSchemaVersion: 8,
    cloudOwnerUserId: 'account-123',
    profile: null,
    exercises: [],
    workouts: [],
    workoutSets: [],
    meals: [],
    foodItems: [],
    nutritionTargets: [],
    wellnessLogs: [],
    aiConversations: [],
    aiMessages: [],
    notificationPreferences: [],
    ...overrides,
  };
}

test('builds a complete versioned active-record export with structured JSON values', () => {
  const result = buildCompleteJsonExport(snapshot({
    profile: {
      training_experience: 'intermediate',
      available_equipment: '["cable","machine"]',
      injury_flags: '["knee"]',
      goals: '["strength"]',
      typical_diet_pattern: 'balanced',
      preferred_load_unit: 'kg',
      ai_data_consent: 1,
      ai_data_consented_at: null,
      medical_disclaimer_acknowledged_at: null,
      onboarding_completed_at: '2026-08-01T00:00:00.000Z',
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
      client_updated_at: '2026-08-01T00:00:00.000Z',
    },
    exercises: [{ id: 'exercise-1', user_id: null, name: 'Press', secondary_muscle_groups: '["triceps"]' }],
    workouts: [{ id: 'workout-1', title: 'Push' }],
    workoutSets: [{ id: 'set-1', workout_id: 'workout-1', exercise_id: 'exercise-1', sort_order: 1 }],
    meals: [{ id: 'meal-1', name: 'Breakfast', is_user_edited: 1 }],
    foodItems: [{ id: 'food-1', meal_id: 'meal-1', sort_order: 1, source: 'ai_photo', original_source: 'ai_photo', confidence: 0.8, original_confidence: 0.9, is_user_edited: 1 }],
    nutritionTargets: [{ id: 'target-1', effective_from: '2026-08-01', source: 'calculated' }],
    wellnessLogs: [{ id: 'wellness-1', logged_at: '2026-08-01T00:00:00.000Z', injury_flags: '[]', metadata: '{"height_cm":180}' }],
    aiConversations: [{ id: 'conversation-1', created_at: '2026-08-01T00:00:00.000Z' }],
    aiMessages: [{ id: 'message-1', conversation_id: 'conversation-1', sequence: 1, structured_content: '{"plan":true}', metadata: '{"source":"local"}' }],
    notificationPreferences: [{ id: 'pref-1', type: 'meal_gap', enabled: 1, conditions: '{"expectedMeals":2}' }],
  }), '2026-08-14T12:00:00.000Z') as any;

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.generatedAt, '2026-08-14T12:00:00.000Z');
  assert.deepEqual(result.recordPolicy, {
    scope: 'active_records_only',
    tombstonesIncluded: false,
    description: 'Deleted records and internal sync queue entries are excluded.',
  });
  assert.deepEqual(result.profile.availableEquipment, ['cable', 'machine']);
  assert.equal(result.profile.aiDataConsent, true);
  assert.deepEqual(result.exercises[0].secondaryMuscleGroups, ['triceps']);
  assert.equal(result.exercises[0].scope, 'built_in');
  assert.equal(result.meals[0].isUserEdited, true);
  assert.equal(result.foodItems[0].originalConfidence, 0.9);
  assert.deepEqual(result.wellnessLogs[0].metadata, { height_cm: 180 });
  assert.deepEqual(result.ai.messages[0].structuredContent, { plan: true });
  assert.deepEqual(result.notificationPreferences[0].conditions, { expectedMeals: 2 });
  for (const key of ['workouts', 'workoutSets', 'meals', 'foodItems', 'nutritionTargets', 'wellnessLogs', 'notificationPreferences']) {
    assert.equal(result[key].length, 1, `${key} should be exported`);
  }
});

test('orders records deterministically without mutating the database snapshot', () => {
  const source = snapshot({
    workouts: [
      { id: 'b', performed_on: '2026-08-02', started_at: '10:00' },
      { id: 'a', performed_on: '2026-08-01', started_at: '10:00' },
    ],
    workoutSets: [
      { id: 'set-10', workout_id: 'a', sort_order: 10 },
      { id: 'set-2', workout_id: 'a', sort_order: 2 },
    ],
  });
  const result = buildCompleteJsonExport(source, '2026-08-14T12:00:00.000Z') as any;
  assert.deepEqual(result.workouts.map((row: any) => row.id), ['a', 'b']);
  assert.deepEqual(result.workoutSets.map((row: any) => row.id), ['set-2', 'set-10']);
  assert.deepEqual(source.workouts.map((row) => row.id), ['b', 'a']);
});

test('uses an explicit allowlist so secrets and device internals cannot leak', () => {
  const result = buildCompleteJsonExport(snapshot({
    profile: { training_experience: 'beginner', access_token: 'top-secret', refresh_token: 'also-secret' },
    exercises: [{ id: 'exercise-1', name: 'Row', user_id: 'account-123', payload_json: '{"secret":true}' }],
    notificationPreferences: [{ id: 'pref-1', type: 'meal_gap', scheduled_notification_id: 'device-only' }],
  }), '2026-08-14T12:00:00.000Z');
  const serialized = stringifyCompleteJsonExport(result);

  for (const forbidden of ['top-secret', 'also-secret', 'access_token', 'refresh_token', 'payload_json', 'scheduled_notification_id']) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked into the export`);
  }
});

test('decodes valid JSON once and safely falls back for corrupt structured columns', () => {
  assert.deepEqual(decodeExportJson('{"nested":[1]}', {}), { nested: [1] });
  assert.deepEqual(decodeExportJson({ nested: [1] }, {}), { nested: [1] });
  assert.deepEqual(decodeExportJson('{broken', {}), {});
});
