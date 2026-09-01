import { expect, test } from '@playwright/test';

import {
  completeOnboarding,
  expectNoHorizontalOverflow,
  fixJienClock,
  prepareIsolatedJienContext,
} from './helpers';

test('signed-out startup remains usable at every supported width and theme', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'edge-desktop', 'The desktop project owns the full responsive-width matrix.');
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

test('mobile startup exposes touch-sized account controls without overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'edge-desktop', 'Mobile engines own the touch startup check.');
  await fixJienClock(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your training record, on every device' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const undersizedTargets = await page.locator('[role="button"], [role="tab"]').evaluateAll((targets) => targets
    .filter((target) => {
      const rect = target.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
    })
    .map((target) => target.getAttribute('aria-label') ?? target.textContent?.trim() ?? 'unnamed'));
  expect(undersizedTargets).toEqual([]);
});

test('routine starters adapt to saved equipment without inventing targets', async ({ context, page }, testInfo) => {
  await prepareIsolatedJienContext(context, page);
  if (testInfo.project.name !== 'ios-webkit') await fixJienClock(page);
  await completeOnboarding(page);
  await page.getByRole('tab', { name: 'Train' }).click();
  await page.getByRole('button', { name: 'Plan workout' }).click();
  await expect(page.getByText('Start from a routine')).toBeVisible();
  await page.getByRole('button', { name: 'Use Full body routine starter' }).click();
  await expect(page.getByText('5 selected')).toBeVisible();
  await expect(page.getByText('Machine Chest Press', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Machine Hip Thrust', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Choose load · 8–12 reps').first()).toBeVisible();
  await expect(page.getByText('Draft muscle coverage')).toBeVisible();
  await page.getByRole('button', { name: 'Move Machine Chest Press later' }).click();
  await page.getByRole('button', { name: 'Swap Machine Hip Thrust' }).click();
  await expect(page.getByText('Replacing Machine Hip Thrust')).toBeVisible();
  await page.getByPlaceholder('Search exercise, muscle, or equipment').fill('Seated Leg Curl');
  await page.getByRole('button', { name: /^Seated Leg Curl .*Add$/ }).click();
  await expect(page.getByText('Seated Leg Curl', { exact: true }).last()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('isolated daily loop persists records and hands SQLite to a newer tab', async ({ context, page }, testInfo) => {
  const capturesVisualBaselines = testInfo.project.name === 'edge-desktop';
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(`${error.name}: ${error.message}`);
    console.error(`[${testInfo.project.name}] page error: ${error.name}: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') console.error(`[${testInfo.project.name}] console ${message.type()}: ${message.text()}`);
  });
  page.on('requestfailed', (request) => console.error(`[${testInfo.project.name}] request failed: ${request.url()} — ${request.failure()?.errorText}`));
  page.on('response', (response) => {
    if (response.status() >= 400) console.error(`[${testInfo.project.name}] response ${response.status()}: ${response.url()}`);
  });
  await prepareIsolatedJienContext(context, page);
  if (testInfo.project.name !== 'ios-webkit') await fixJienClock(page);
  await completeOnboarding(page);

  await page.getByRole('button', { name: /Log workout/ }).first().click();
  await page.getByLabel('Session name').fill('Browser QA strength');
  await page.getByLabel('Find exercise for exercise 1').fill('quadriceps dumbbell');
  await expect(page.getByRole('button', { name: /^Bulgarian Split Squat .*Choose$/ })).toBeVisible();
  await page.getByLabel('Find exercise for exercise 1').fill('Goblet Squat');
  await page.getByRole('button', { name: /^Goblet Squat .*Choose$/ }).click();
  const loads = page.getByRole('textbox', { name: 'Load (kg)', exact: true });
  const reps = page.getByRole('textbox', { name: 'Reps', exact: true });
  for (let index = 0; index < await loads.count(); index += 1) {
    await loads.nth(index).fill('20');
    await reps.nth(index).fill('10');
  }
  await expect(page.getByText('This session’s muscle coverage')).toBeVisible();
  await expect(page.getByText('Quadriceps · 3 set credits')).toBeVisible();
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
  await expect(page.getByText('NEXT WORKOUT', { exact: true })).toBeVisible();
  await expect(page.getByText(/Muscle guidance uses set credits/)).toBeVisible();
  await page.getByRole('button', { name: /History/ }).click();
  await expect(page.getByRole('link', { name: /Open Browser QA strength from/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  if (capturesVisualBaselines) {
    await expect(page).toHaveScreenshot('training-history-390.png', { animations: 'disabled' });
  }

  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  if (capturesVisualBaselines) {
    await expect(page).toHaveScreenshot('settings-general-390.png', { animations: 'disabled' });
  }

  await page.getByRole('button', { name: 'Reminders', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Contextual reminders', exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Possible missing meal reminder' })).toBeVisible();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account and sync', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Export', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'General', exact: true }).click();
  await expectNoHorizontalOverflow(page);
  if (capturesVisualBaselines) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await expectNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot('settings-general-dark-1280.png', { animations: 'disabled' });
  }

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Train' }).click();
  await page.getByRole('button', { name: /History/ }).click();
  await expect(page.getByRole('link', { name: /Open Browser QA strength from/ })).toBeVisible();

  const newerPage = await context.newPage();
  if (testInfo.project.name !== 'ios-webkit') await fixJienClock(newerPage, 1_000);
  await newerPage.goto('/today');
  await expect(newerPage.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByText('Startup code: LOCAL_STORAGE_HANDED_OFF')).toBeVisible();
  await newerPage.close();
  expect(pageErrors).toEqual([]);
});
