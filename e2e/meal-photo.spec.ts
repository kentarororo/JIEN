import { expect, test } from '@playwright/test';
import path from 'node:path';
import { completeOnboarding, prepareIsolatedJienContext } from './helpers';
test.use({ actionTimeout: 10_000 });

test('shared Anthropic rejection preserves input and does not blame Google or auto-retry', async ({ context, page }) => {
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  let analyses = 0;
  await context.route('https://jien-e2e.supabase.co/functions/v1/analyze-food-photo', async (route) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ headers, body: 'ok' }); return; }
    if (route.request().postDataJSON().data.action === 'capability') {
      await route.fulfill({ headers, json: { data: { available: true, provider: 'anthropic', credentialSource: 'app', usagePolicy: 'provider_managed' }, requestId: 'qa-capability' } });
      return;
    }
    analyses += 1;
    await route.fulfill({ status: 403, headers, json: { error: { code: 'PROVIDER_AUTH_INVALID', message: 'The provider rejected access.', retryable: false }, requestId: 'qa-auth-failure' } });
  });
  await page.getByRole('button', { name: /Add meal/ }).first().click();
  await page.getByRole('button', { name: 'Choose a meal photo from this device', exact: true }).setInputFiles(path.resolve('e2e/fixtures/nutrition-label.png'));
  const description = page.getByLabel('What is in this meal? (optional)', { exact: true });
  await description.fill('Synthetic label');
  await page.getByRole('button', { name: 'Analyze with Anthropic', exact: true }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('PROVIDER_AUTH_INVALID');
  await expect(alert).not.toContainText(/Google|Gemini/);
  await expect(alert).toContainText('app owner');
  await expect(description).toHaveValue('Synthetic label');
  await expect(page.getByRole('img', { name: 'Selected meal photo preview', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analysis unavailable', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Try analysis again', exact: true })).toHaveCount(0);
  expect(analyses).toBe(1);
});

for (const provider of ['gemini', 'anthropic'] as const) {
test(`${provider}: photo failure retains image and context; retry adds editable food without saving`, async ({ context, page }) => {
  await prepareIsolatedJienContext(context, page); await completeOnboarding(page);
  let analyses = 0;
  await context.route('https://jien-e2e.supabase.co/functions/v1/analyze-food-photo', async (route) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 200, headers, body: 'ok' }); return; }
    const input = route.request().postDataJSON();
    expect(input.version).toBe(1);
    if (input.data.action === 'capability') {
      await route.fulfill({ status: 200, headers, json: { data: { available: true, provider, credentialSource: provider === 'anthropic' ? 'app' : 'personal', usagePolicy: 'provider_managed' }, requestId: 'qa-capability' } }); return;
    }
    analyses += 1;
    expect(input.data.description).toBe(analyses === 1 ? 'Synthetic cereal label' : 'Updated cereal portion');
    expect(input.data.imageBase64.length).toBeGreaterThan(100);
    await route.fulfill({ status: analyses === 1 ? 503 : 200, headers, json: analyses === 1
      ? { error: { code: 'PROVIDER_UNAVAILABLE', message: 'The photo service could not analyze this image. Try again.', retryable: true }, requestId: 'qa-photo-failure' }
      : { data: { items: [{ id: 'qa-cereal', name: 'Test cereal', servingQuantity: 50, servingUnit: 'g', caloriesKcal: 200,
        proteinG: 10, carbohydrateG: 30, fatG: 4, fibreG: 3, confidence: 0.9, source: 'ai_photo',
        photoReview: { basis: 'label', notes: ['Check the label serving and the amount you ate.'], referenceId: null, referenceDescription: null } }] }, requestId: 'qa-photo-success' } });
  });
  await page.getByRole('button', { name: /Add meal/ }).first().click();
  await page.getByRole('button', { name: 'Choose a meal photo from this device', exact: true }).setInputFiles(path.resolve('e2e/fixtures/nutrition-label.png'));
  const description = page.getByLabel('What is in this meal? (optional)', { exact: true });
  // Fill immediately after upload: do not hide modal-opening races with a timeout.
  await description.fill('Synthetic cereal label');
  await page.getByRole('button', { name: `Analyze with ${provider === 'anthropic' ? 'Anthropic' : 'Gemini'}`, exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('PROVIDER_UNAVAILABLE');
  await expect(description).toHaveValue('Synthetic cereal label');
  await expect(page.getByRole('img', { name: 'Selected meal photo preview', exact: true })).toBeVisible();
  expect(analyses).toBe(1);
  await description.fill('Updated cereal portion');
  await page.getByRole('button', { name: 'Try analysis again', exact: true }).click();
  await page.getByRole('button', { name: 'Review 1 added item', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Food', exact: true })).toHaveValue('Test cereal');
  await expect(page.getByLabel('Calories', { exact: true })).toHaveValue('200');
  await expect(page.getByText('AI-read nutrition label · check serving', { exact: true })).toBeVisible();
  await expect(page.getByText('Check the label serving and the amount you ate.', { exact: true })).toBeVisible();
  await expect(page.getByText(/90% confidence/)).toHaveCount(0);
  await page.getByLabel('Quantity', { exact: true }).fill('25');
  await expect(page.getByLabel('Calories', { exact: true })).toHaveValue('100');
  await expect(page.getByLabel('Protein (g)', { exact: true })).toHaveValue('5');
  await page.reload();
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('25');
  await expect(page.getByText('Check the label serving and the amount you ate.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save meal', exact: true })).toBeVisible();
  expect(analyses).toBe(2); // Entirely mocked; no Gemini account or real request.
  await page.getByRole('textbox', { name: 'Food', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('photo-review-light.png') });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(page.getByText('AI-read nutrition label · check serving', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Calories', { exact: true })).toHaveValue('100');
  await page.screenshot({ path: test.info().outputPath('photo-review-dark.png') });
});
}
