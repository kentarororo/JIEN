import { expect, test } from '@playwright/test';
import { completeOnboarding, expectNoHorizontalOverflow, prepareIsolatedJienContext } from './helpers';

test.use({ actionTimeout: 10_000 });

test('repeat food day stays one action and local history supports multi-add plus quick macros', async ({ context, page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await page.getByRole('button', { name: /^Food log\./ }).click();
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  await page.getByRole('textbox', { name: 'Food', exact: true }).fill('Char Kway Teow');
  for (const [name, value] of [['Calories', '720'], ['Protein (g)', '24'], ['Carbs (g)', '94'], ['Fat (g)', '28']]) {
    await page.getByLabel(name!, { exact: true }).fill(value!);
  }
  await page.getByRole('button', { name: 'plate', exact: true }).click();
  await page.getByRole('button', { name: 'Add a blank food', exact: true }).click();
  await page.getByRole('textbox', { name: 'Food', exact: true }).nth(1).fill('Protein shake');
  for (const [name, value] of [['Calories', '180'], ['Protein (g)', '32'], ['Carbs (g)', '8'], ['Fat (g)', '3']]) {
    await page.getByLabel(name!, { exact: true }).nth(1).fill(value!);
  }
  await page.getByRole('button', { name: 'scoop', exact: true }).nth(1).click();
  await page.getByRole('button', { name: 'Add to day', exact: true }).click();
  await page.getByRole('button', { name: 'Back to today', exact: true }).click();

  const fullDayStart = Date.now();
  let fullDayTaps = 0;
  fullDayTaps += 1;
  await page.getByRole('button', { name: 'Copy yesterday', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Char Kway Teow, 720 calories', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Protein shake, 180 calories', exact: true })).toBeVisible();
  expect(Date.now() - fullDayStart).toBeLessThan(60_000);
  expect(fullDayTaps).toBeLessThanOrEqual(3);

  await expect(page.getByText('Recent & frequent for this time of day').last()).toBeVisible();
  const quickAdd = page.getByPlaceholder('Search saved foods').last();
  await quickAdd.fill('ckt');
  await expect(page.getByText(/last logged portion/).last()).toBeVisible();
  await page.getByRole('button', { name: 'Add Char Kway Teow', exact: true }).click();
  await expect(page.getByText('1 food added.', { exact: true })).toBeVisible();

  await quickAdd.fill('');
  await page.getByRole('checkbox', { name: 'Select Char Kway Teow', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select Protein shake', exact: true }).click();
  await page.getByRole('button', { name: 'Add 2 selected foods', exact: true }).click();
  await expect(page.getByText('2 foods added.', { exact: true })).toBeVisible();

  await page.getByLabel('Quick calories', { exact: true }).last().fill('250');
  await page.getByLabel('Quick protein', { exact: true }).last().fill('20');
  await page.getByRole('button', { name: 'Add macros', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Edit Quick macros, 250 calories', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Choose past food', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Copy past food', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select Char Kway Teow', exact: true }).click();
  await page.getByRole('button', { name: 'Copy selected · 1', exact: true }).click();
  await expect(page.getByText('1 food copied from selected foods.', { exact: true })).toBeVisible();

  let repeatMealTaps = 0;
  repeatMealTaps += 1;
  await page.getByRole('button', { name: 'Copy previous meal', exact: true }).click();
  expect(repeatMealTaps).toBeLessThanOrEqual(3);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
