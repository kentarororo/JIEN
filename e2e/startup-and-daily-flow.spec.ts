import { expect, test } from '@playwright/test';

import {
  completeOnboarding,
  expectNoHorizontalOverflow,
  fixJienClock,
  prepareIsolatedJienContext,
} from './helpers';

test('signed-out startup remains usable at every supported width and theme', async ({ page }) => {
  await fixJienClock(page);
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    await page.emulateMedia({ colorScheme: width === 768 ? 'dark' : 'light', reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your training record, on every device' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test('isolated daily loop persists records and hands SQLite to a newer tab', async ({ context, page }) => {
  await prepareIsolatedJienContext(context);
  await fixJienClock(page);
  await completeOnboarding(page);

  await page.getByRole('button', { name: /Log workout/ }).first().click();
  await page.getByLabel('Session name').fill('Browser QA strength');
  await page.getByLabel('Find exercise for exercise 1').fill('Goblet Squat');
  await page.getByRole('button', { name: /^Goblet Squat .*Choose$/ }).click();
  const loads = page.getByRole('textbox', { name: 'Load (kg)', exact: true });
  const reps = page.getByRole('textbox', { name: 'Reps', exact: true });
  for (let index = 0; index < await loads.count(); index += 1) {
    await loads.nth(index).fill('20');
    await reps.nth(index).fill('10');
  }
  await page.getByRole('button', { name: /Complete sets for Goblet Squat/ }).click();
  await page.getByRole('button', { name: 'Save completed workout' }).click();
  await expect(page.getByRole('heading', { name: 'Workout', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Today' }).click();
  await page.getByRole('button', { name: /Add meal/ }).first().click();
  await page.getByLabel('Meal name').fill('Browser QA lunch');
  await page.getByRole('textbox', { name: 'Food', exact: true }).fill('Chicken rice');
  await page.getByRole('textbox', { name: 'Calories', exact: true }).fill('650');
  await page.getByRole('textbox', { name: 'Protein (g)', exact: true }).fill('35');
  await page.getByRole('textbox', { name: 'Carbs (g)', exact: true }).fill('75');
  await page.getByRole('textbox', { name: 'Fat (g)', exact: true }).fill('20');
  await page.getByRole('button', { name: 'Save meal' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Train' }).click();
  await page.getByRole('button', { name: /History/ }).click();
  await expect(page.getByRole('link', { name: /Open Browser QA strength from/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot('training-history-390.png', { animations: 'disabled' });

  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot('settings-general-390.png', { animations: 'disabled' });

  await page.getByRole('button', { name: 'Reminders', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Contextual reminders', exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Possible missing meal reminder' })).toBeVisible();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account and sync', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Export', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'General', exact: true }).click();
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot('settings-general-dark-1280.png', { animations: 'disabled' });

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Train' }).click();
  await page.getByRole('button', { name: /History/ }).click();
  await expect(page.getByRole('link', { name: /Open Browser QA strength from/ })).toBeVisible();

  const newerPage = await context.newPage();
  await fixJienClock(newerPage, 1_000);
  await newerPage.goto('/today');
  await expect(newerPage.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByText('Startup code: LOCAL_STORAGE_HANDED_OFF')).toBeVisible();
  await newerPage.close();
});
