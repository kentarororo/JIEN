import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyMealPhotoAnalysisError,
  parseMealPhotoAnalysisData,
  parseMealPhotoCapabilityData,
} from './meal-photo-api.ts';

const validItem = {
  id: 'ai-item-1',
  name: 'Chicken rice',
  servingQuantity: 1,
  servingUnit: 'plate',
  caloriesKcal: 610,
  proteinG: 38,
  carbohydrateG: 74,
  fatG: 18,
  fibreG: 4,
  confidence: 0.78,
  source: 'ai_photo',
};

test('strictly parses normalized meal-photo items', () => {
  const result = parseMealPhotoAnalysisData({ items: [validItem], disclaimer: 'Review before saving.' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.name, 'Chicken rice');
  assert.equal(result.items[0]?.source, 'ai_photo');
});

test('rejects malformed provider-derived output instead of coercing it', () => {
  assert.throws(
    () => parseMealPhotoAnalysisData({ items: [{ ...validItem, caloriesKcal: '610' }] }),
    /item 1 was invalid/i,
  );
  assert.throws(() => parseMealPhotoAnalysisData({ items: [] }), /invalid food items/i);
});

test('confirms the configured server provider instead of a generic enabled flag', () => {
  assert.deepEqual(
    parseMealPhotoCapabilityData({
      available: true,
      provider: 'gemini',
      credentialSource: 'personal',
      usagePolicy: 'provider_managed',
      dailyLimit: 1000,
    }),
    { provider: 'gemini', credentialSource: 'personal', usagePolicy: 'provider_managed', dailyLimit: null },
  );
  assert.throws(
    () => parseMealPhotoCapabilityData({ available: true }),
    /availability could not be confirmed/i,
  );
});

test('photo capability remains compatible with a legacy capped deployment', () => {
  assert.deepEqual(
    parseMealPhotoCapabilityData({
      available: true,
      provider: 'gemini',
      credentialSource: 'app',
      dailyLimit: 5,
    }),
    { provider: 'gemini', credentialSource: 'app', usagePolicy: 'legacy_daily_cap', dailyLimit: 5 },
  );
});

test('maps stable service errors to explicit user-action states', () => {
  assert.equal(classifyMealPhotoAnalysisError(Object.assign(new Error('Sign in.'), { code: 'AUTH_REQUIRED' })).status, 'auth_required');
  assert.equal(classifyMealPhotoAnalysisError(Object.assign(new Error('Consent.'), { code: 'AI_CONSENT_REQUIRED' })).status, 'consent_required');
  assert.equal(classifyMealPhotoAnalysisError(Object.assign(new Error('Missing.'), { code: 'PHOTO_AI_NOT_CONFIGURED' })).status, 'not_configured');
  const offline = classifyMealPhotoAnalysisError(Object.assign(new Error('Offline.'), { code: 'NETWORK_REQUIRED', retryable: true }));
  assert.equal(offline.status, 'offline');
  assert.equal(offline.retryable, true);
  const deployment = classifyMealPhotoAnalysisError(Object.assign(new Error('Raw provider detail.'), {
    code: 'PROVIDER_AUTH_INVALID', requestId: 'request-123', retryable: false,
  }));
  assert.equal(deployment.status, 'not_configured');
  assert.equal(deployment.requestId, 'request-123');
  assert.doesNotMatch(deployment.message, /raw provider detail/i);
});
