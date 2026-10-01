import { expect, test } from '@playwright/test';
import path from 'node:path';
import { completeOnboarding, prepareIsolatedJienContext } from './helpers';
test.use({ actionTimeout: 10_000 });

test('photo failure retains the image and context; explicit retry adds editable food without saving a meal', async ({ context, page }) => {
  await prepareIsolatedJienContext(context, page); await completeOnboarding(page);
  let analyses = 0;
  await context.route('https://jien-e2e.supabase.co/functions/v1/analyze-food-photo', async (route) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 200, headers, body: 'ok' }); return; }
    const input = route.request().postDataJSON();
    expect(input.version).toBe(1);
    if (input.data.action === 'capability') {
      await route.fulfill({ status: 200, headers, json: { data: { available: true, provider: 'gemini', credentialSource: 'personal', usagePolicy: 'provider_managed' }, requestId: 'qa-capability' } }); return;
    }
    analyses += 1;
    expect(input.data.description).toBe('Synthetic cereal label');
    expect(input.data.imageBase64.length).toBeGreaterThan(100);
    await route.fulfill({ status: analyses === 1 ? 503 : 200, headers, json: analyses === 1
      ? { error: { code: 'PROVIDER_UNAVAILABLE', message: 'The photo service could not analyze this image. Try again.', retryable: true }, requestId: 'qa-photo-failure' }
      : { data: { items: [{ id: 'qa-cereal', name: 'Test cereal', servingQuantity: 50, servingUnit: 'g', caloriesKcal: 200,
        proteinG: 10, carbohydrateG: 30, fatG: 4, fibreG: 3, confidence: 0.9, source: 'ai_photo' }] }, requestId: 'qa-photo-success' } });
  });
  await page.getByRole('button', { name: /Add meal/ }).first().click();
  await page.getByRole('button', { name: 'Choose a meal photo from this device', exact: true }).setInputFiles(path.resolve('e2e/fixtures/nutrition-label.png'));
  const description = page.getByLabel('What is in this meal? (optional)', { exact: true });
  await description.fill('Synthetic cereal label');
  await page.getByRole('button', { name: 'Analyze with Gemini', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('PROVIDER_UNAVAILABLE');
  await expect(description).toHaveValue('Synthetic cereal label');
  await expect(page.getByRole('img', { name: 'Selected meal photo preview', exact: true })).toBeVisible();
  expect(analyses).toBe(1);
  await page.getByRole('button', { name: 'Try analysis again', exact: true }).click();
  await page.getByRole('button', { name: 'Review 1 added item', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Food', exact: true })).toHaveValue('Test cereal');
  await expect(page.getByLabel('Calories', { exact: true })).toHaveValue('200');
  await expect(page.getByRole('button', { name: 'Save meal', exact: true })).toBeVisible();
  expect(analyses).toBe(2); // Entirely mocked; no Gemini account or real request.
});
