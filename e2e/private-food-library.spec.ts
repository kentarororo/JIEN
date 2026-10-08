import { expect, test } from '@playwright/test';
import { completeOnboarding, expectNoHorizontalOverflow, prepareIsolatedJienContext } from './helpers';

test('cardio is a main training action in both views; private branded foods persist and resolve barcodes offline', async ({ context, page }, testInfo) => {
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  const cardio = page.getByRole('button', { name: 'Log cardio', exact: true });
  await expect(cardio).toBeInViewport();
  const workout = page.getByRole('button', { name: 'Log workout', exact: true }).first();
  const cardioBox = await cardio.boundingBox(); const workoutBox = await workout.boundingBox();
  expect(cardioBox!.y).toBeCloseTo(workoutBox!.y, 0);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(cardio).toBeInViewport();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('training-main-actions.png') });
  await cardio.click();
  await expect(page.getByRole('heading', { name: 'Log cardio', exact: true })).toBeVisible();

  await page.goto('/meals/new');
  await page.getByRole('textbox', { name: 'Food', exact: true }).fill('Local soy drink QA');
  await page.getByLabel('Calories', { exact: true }).fill('120');
  await page.getByLabel('Protein (g)', { exact: true }).fill('10');
  await page.getByLabel('Carbs (g)', { exact: true }).fill('12');
  await page.getByLabel('Fat (g)', { exact: true }).fill('4');
  await page.getByLabel('Brand (optional)', { exact: true }).fill('SG Test Brand');
  await page.getByLabel('Product barcode (optional)', { exact: true }).fill('0012345678905');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Save as private food', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Update private food', exact: true })).toBeVisible();
  await expect(page.getByText(/saved to your private foods on this device and queued for account sync/)).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await page.getByLabel('Food search', { exact: true }).fill('SG Test Brand');
  await expect(page.getByRole('button', { name: /Local soy drink QA.*SG Test Brand/ })).toBeVisible();
  await context.setOffline(true);
  await page.getByLabel('Barcode number', { exact: true }).fill('0012345678905');
  await page.getByRole('button', { name: 'Look up barcode', exact: true }).click();
  await expect(page.getByText('Local soy drink QA added from Private food. Review the serving and macros.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Brand (optional)', { exact: true }).last()).toHaveValue('SG Test Brand');
  await expect(page.getByLabel('Product barcode (optional)', { exact: true }).last()).toHaveValue('0012345678905');
  await expectNoHorizontalOverflow(page);
  await context.setOffline(false);
});

test('community publication is explicit and revocable; another contributor food can be found by barcode', async ({ context, page }) => {
  await prepareIsolatedJienContext(context, page);
  const writes: Record<string, unknown>[] = [];
  let releasePublication!: () => void;
  const publicationHeld = new Promise<void>((resolve) => { releasePublication = resolve; });
  const cors = { 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, accept-profile, content-profile, prefer, x-client-info, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  await context.route('**/rest/v1/private_foods**', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      writes.push(...(Array.isArray(body) ? body : [body]));
      if ((Array.isArray(body) ? body[0] : body).is_shared === true) await publicationHeld;
    }
    await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '[]' });
  });
  await context.route('**/rest/v1/rpc/search_community_foods', async (route) => {
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    const match = body.product_barcode === '88888888';
    await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(match ? [{
      id: '90000000-0000-4000-8000-000000000099', name: 'Community tofu QA', brand: 'Neighbour Brand',
      barcode: '88888888', serving_quantity: 100, serving_unit: 'g',
      calories_kcal: 90, protein_g: 10, carbohydrate_g: 3, fat_g: 4, fibre_g: null,
    }] : []) });
  });
  await completeOnboarding(page);
  await page.goto('/meals/new');
  await page.getByLabel('Barcode number', { exact: true }).fill('0012345678905');
  await page.getByRole('button', { name: 'Create food with this barcode', exact: true }).click();
  await expect(page.getByLabel('Product barcode (optional)', { exact: true })).toHaveValue('0012345678905');
  await page.getByRole('textbox', { name: 'Food', exact: true }).fill('Shared cereal QA');
  await page.getByLabel('Calories', { exact: true }).fill('120');
  await page.getByLabel('Protein (g)', { exact: true }).fill('10');
  await page.getByLabel('Carbs (g)', { exact: true }).fill('12');
  await page.getByLabel('Fat (g)', { exact: true }).fill('4');
  expect(writes).toHaveLength(0);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Share with community', exact: true }).click();
  await expect(page.getByText(/Community sharing is queued for account sync/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect.poll(() => writes.some((row) => row.name === 'Shared cereal QA' && row.is_shared === true)).toBe(true);
  const contribution = writes.find((row) => row.is_shared === true)!;
  expect(contribution).not.toHaveProperty('notes');
  expect(contribution).not.toHaveProperty('meal_id');
  // Withdrawal must not publish an unfinished edit or change the stored serving.
  await page.getByLabel('Calories', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Share with community', exact: true })).toBeVisible();
  releasePublication();
  await expect.poll(() => writes.some((row) => row.id === contribution.id && row.is_shared === false)).toBe(true);
  expect(writes.find((row) => row.id === contribution.id && row.is_shared === false)?.calories_kcal).toBe(120);
  await page.getByLabel('Barcode number', { exact: true }).fill('88888888');
  await page.getByRole('button', { name: 'Look up barcode', exact: true }).click();
  await expect(page.getByText('Community tofu QA added from Community · unverified. Review the serving and macros.', { exact: true })).toBeVisible();
  await expect(page.getByText('Community entry—not verified. Check the serving and nutrition before saving.', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
