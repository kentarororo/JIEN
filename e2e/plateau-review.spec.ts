import { expect, test } from '@playwright/test';

import { completeOnboarding, expectNoHorizontalOverflow, prepareIsolatedJienContext } from './helpers';

test('three flat exercise sessions offer explicit plateau choices without changing history', async ({ context, page }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== 'edge-desktop', 'One browser owns the repeated local-history flow.');
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);

  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  await page.getByRole('button', { name: 'Log workout', exact: true }).click();
  await page.getByLabel('Session name').fill('Flat press one');
  await page.getByLabel('Find exercise for exercise 1').fill('Machine Chest Press');
  await page.getByRole('button', { name: /^Machine Chest Press .*(Choose|Selected)$/ }).click();
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole('textbox', { name: 'Load (kg)', exact: true }).nth(index).fill('40');
    await page.getByRole('textbox', { name: 'Reps', exact: true }).nth(index).fill('10');
  }
  await page.getByRole('button', { name: /Complete sets for Machine Chest Press/ }).click();
  await page.getByRole('button', { name: 'Save completed workout', exact: true }).click();

  for (let repeat = 0; repeat < 2; repeat += 1) {
    await page.getByRole('button', { name: 'Log from these values', exact: true }).click();
    await page.getByRole('button', { name: /Complete sets for Machine Chest Press/ }).click();
    await page.getByRole('button', { name: 'Save completed workout', exact: true }).click();
  }

  await page.getByRole('button', { name: 'View exercise history', exact: true }).click();
  await expect(page.getByLabel('Machine Chest Press plateau review', { exact: true })).toBeVisible();
  await expect(page.getByText('Three comparable sessions stayed flat', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep going', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Swap exercise', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ease off', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Swap exercise', exact: true }).click();
  await expect(page.getByText('Replacing Machine Chest Press', { exact: true })).toBeVisible();
  await expect(page.getByText(/Existing logged workouts will not change\./)).toBeVisible();
});
