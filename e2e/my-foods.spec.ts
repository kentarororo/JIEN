import { expect, test } from '@playwright/test';
import { completeOnboarding, expectNoHorizontalOverflow, prepareIsolatedJienContext } from './helpers';

test('My foods lists, edits and removes a saved food offline', async ({ context, page }) => {
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await page.getByRole('tab', { name: 'Food', exact: true }).click();
  await page.getByRole('button', { name: 'My foods', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My foods', exact: true }).last()).toBeVisible();
  await expect(page.getByText('No saved foods yet', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Create a saved food', exact: true }).click();
  await page.getByLabel('Food name', { exact: true }).fill('Offline oats QA');
  await page.getByLabel('Brand (optional)', { exact: true }).fill('Manager Brand');
  await page.getByLabel('Serving quantity', { exact: true }).fill('40');
  await page.getByLabel('Serving unit', { exact: true }).fill('g');
  await page.getByLabel('Calories', { exact: true }).fill('150');
  await page.getByLabel('Protein (g)', { exact: true }).fill('5');
  await page.getByLabel('Carbs (g)', { exact: true }).fill('27');
  await page.getByLabel('Fat (g)', { exact: true }).fill('3');
  await page.getByLabel('Product barcode (optional)', { exact: true }).fill('0012345678905');
  await page.getByRole('button', { name: 'Save food', exact: true }).click();
  await expect(page.getByText('Offline oats QA', { exact: true })).toBeVisible();
  await expect(page.getByText('Manager Brand · 40 g', { exact: true })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Edit Offline oats QA', exact: true }).click();
  await page.getByLabel('Food name', { exact: true }).fill('Offline oats edited');
  await page.getByLabel('Calories', { exact: true }).fill('160');
  await page.getByRole('button', { name: 'Save food changes', exact: true }).click();
  await expect(page.getByText('Offline oats edited', { exact: true })).toBeVisible();
  await expect(page.getByText('Offline oats edited saved. Past meal entries were not changed.', { exact: true })).toBeVisible();

  await page.getByLabel('Search saved foods', { exact: true }).fill('O');
  await expect(page.getByText('Type at least 2 characters', { exact: true })).toBeVisible();
  await expect(page.getByText('No matching saved foods', { exact: true })).toHaveCount(0);
  await page.getByLabel('Search saved foods', { exact: true }).fill('zz');
  await expect(page.getByText('No matching saved foods', { exact: true })).toBeVisible();
  await expect(page.getByText('Type at least 2 characters', { exact: true })).toHaveCount(0);
  await page.getByLabel('Search saved foods', { exact: true }).fill('00 12345678905');
  await expect(page.getByText('Offline oats edited', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove Offline oats edited', exact: true }).click();
  await expect(page.getByText('No saved foods yet', { exact: true })).toBeVisible();
  await expect(page.getByText('Offline oats edited removed. Past meal entries were not changed.', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await context.setOffline(false);
});
