import { expect, test } from '@playwright/test';
import { collectPageErrors, completeOnboarding, prepareIsolatedJienContext } from './helpers';

test.use({ actionTimeout: 10_000 });

test('Singapore starter foods are searchable offline in Quick add and Add food, labelled and editable', async ({ context, page }) => {
  const errors = collectPageErrors(page);
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await page.getByRole('button', { name: /^Food log\./ }).click();
  await context.setOffline(true);

  // Quick add: local-only, so SG estimates come straight from the bundled seed.
  await page.getByLabel('Quick add', { exact: true }).fill('chicken rice');
  const chickenRice = page.getByRole('button', { name: 'Add Chicken rice, steamed chicken', exact: true });
  await expect(chickenRice).toBeVisible();
  await chickenRice.click();
  await expect(page.getByText('JIEN estimate (SG) · USDA recipe-derived', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add to day', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Chicken rice, steamed chicken, 572 calories', exact: true })).toBeVisible();

  // Add food: typing searches the local catalog; SG rows carry the SG tag and source label.
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  const search = page.getByLabel('Food search', { exact: true });
  await search.fill('kopi C');
  await expect(page.getByText('Kopi C', { exact: true })).toBeVisible();
  await expect(page.getByText('SG · 1 cup · JIEN estimate (SG)', { exact: true }).first()).toBeVisible();
  await search.fill('roti prata');
  await expect(page.getByText('Roti prata, plain', { exact: true })).toBeVisible();
  // Submitting the online search while offline must not hide the local SG matches.
  await search.press('Enter');
  await expect(page.getByText('Roti prata, plain', { exact: true })).toBeVisible();
  await page.getByText('Roti prata, plain', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Food', exact: true })).toHaveValue('Roti prata, plain');
  // The estimate stays editable before logging.
  await page.getByLabel('Calories', { exact: true }).fill('250');
  await expect(page.getByLabel('Calories', { exact: true })).toHaveValue('250');
  // ...and savable as a private food, which then ranks above the SG estimate.
  await page.getByRole('button', { name: 'Save as private food', exact: true }).click();
  await expect(page.getByText('Private food saved', { exact: true })).toBeVisible();
  await search.fill('roti prata');
  await expect(page.getByText('Roti prata, plain', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Private food$/).first()).toBeVisible();
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
