import { expect, test } from '@playwright/test';

import {
  completeOnboarding,
  expectNoHorizontalOverflow,
  fixJienClock,
  prepareIsolatedJienContext,
  qaSession,
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

test('flexible workout timing stays clear and touch-sized across supported layouts', async ({ context, page }, testInfo) => {
  await prepareIsolatedJienContext(context, page);
  if (testInfo.project.name !== 'ios-webkit') await fixJienClock(page);
  await completeOnboarding(page);

  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  await page.getByRole('button', { name: 'Plan workout' }).click();
  await expect(page.getByRole('heading', { name: 'Plan workout', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'No set time', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('No date or time is set.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Exact date')).toHaveCount(0);
  await expect(page.getByLabel('Exact time')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.getByRole('radio', { name: 'Set date and time', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Set date and time', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Exact date')).toBeVisible();
  await expect(page.getByLabel('Exact time')).toBeVisible();
  await expect(page.getByText('The session appears on that calendar day and can trigger a reminder.', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const undersizedTargets = await page.locator('[role="button"], [role="tab"], [role="radio"]').evaluateAll((targets) => targets
    .filter((target) => {
      const rect = target.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
    })
    .map((target) => target.getAttribute('aria-label') ?? target.textContent?.trim() ?? 'unnamed'));
  expect(undersizedTargets).toEqual([]);

  await page.getByRole('radio', { name: 'No set time', exact: true }).click();
  await expect(page.getByLabel('Exact date')).toHaveCount(0);
  await expect(page.getByLabel('Exact time')).toHaveCount(0);

  if (testInfo.project.name === 'edge-desktop') {
    const scheduledTiming = page.getByRole('radio', { name: 'Set date and time', exact: true });
    await scheduledTiming.focus();
    await expect(scheduledTiming).toHaveCSS('border-width', '2px');
    await scheduledTiming.press('Space');
    await expect(scheduledTiming).toHaveAttribute('aria-checked', 'true');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.getByRole('heading', { name: 'Plan workout', exact: true }).scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
  }
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

test('active workout restores performed state, set kind, and rest timer after interruption', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'edge-desktop', 'One real browser integration owns the active-draft recovery contract.');
  await prepareIsolatedJienContext(context, page);
  await fixJienClock(page);
  await completeOnboarding(page);

  await page.getByRole('button', { name: /Log workout/ }).first().click();
  await page.getByLabel('Find exercise for exercise 1').fill('Goblet Squat');
  await page.getByRole('button', { name: /^Goblet Squat .*Choose$/ }).click();
  await page.getByRole('button', { name: '1 min', exact: true }).click();
  await page.getByRole('textbox', { name: 'Load (kg)', exact: true }).first().fill('20');
  await page.getByRole('textbox', { name: 'Reps', exact: true }).first().fill('10');
  await page.getByRole('radio', { name: 'Warm-up', exact: true }).first().click();
  await page.getByRole('button', { name: 'Mark set complete', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();

  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByText('Unfinished workout restored', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Load (kg)', exact: true }).first()).toHaveValue('20');
  await expect(page.getByRole('textbox', { name: 'Reps', exact: true }).first()).toHaveValue('10');
  await expect(page.getByRole('textbox', { name: 'RPE', exact: true }).first()).toHaveValue('');
  await expect(page.getByRole('radio', { name: 'Warm-up', exact: true }).first()).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Undo completed set', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Undo completed set', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Mark set complete', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
});

test('completed workout choice builds an inspectable editable next plan', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'edge-desktop', 'One real browser integration owns the post-session planning contract.');
  await prepareIsolatedJienContext(context, page);
  await fixJienClock(page);
  await completeOnboarding(page);

  await page.getByRole('button', { name: /Log workout/ }).first().click();
  await page.getByLabel('Session name').fill('Post-session QA');
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

  const buildPlan = page.getByRole('button', { name: 'Build next workout plan', exact: true });
  await expect(buildPlan).toBeDisabled();
  const easeOff = page.getByRole('radio', { name: /^Ease off\./ });
  await easeOff.focus();
  await easeOff.press('Space');
  await expect(easeOff).toHaveAttribute('aria-checked', 'true');
  await expect(buildPlan).toBeEnabled();
  await buildPlan.click();

  await expect(page.getByText('Ease off plan', { exact: true })).toBeVisible();
  await expect(page.getByText('Exercises, loads and reps match the completed session. One working set was removed where possible.', { exact: true })).toBeVisible();
  await expect(page.getByText('20 kg × 10', { exact: true })).toHaveCount(2);
  await expect(page.getByText('One working set was removed. Load and reps are unchanged.', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'No set time', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Save workout plan', exact: true }).click();

  await expect(page.getByText(/^Ease off · Keep the same exercises/)).toBeVisible();
  await expect(page.getByText('20 kg × 10', { exact: true })).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
});

test('programme planning supports flexible starts and opt-in scheduling without auto-logging work', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'edge-desktop', 'One browser integration owns the programme metadata contract.');
  await prepareIsolatedJienContext(context, page);
  await fixJienClock(page);
  await completeOnboarding(page);

  await page.getByRole('tab', { name: 'Train' }).click();
  await page.getByRole('button', { name: 'Plan workout' }).click();
  await page.getByRole('button', { name: 'Push · Pull · Legs', exact: true }).click();
  await page.getByRole('button', { name: '30 min', exact: true }).click();
  await page.getByRole('button', { name: 'Use Push session', exact: true }).click();
  await expect(page.getByText('3 selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'No set time', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Save workout plan', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Push session', exact: true })).toBeVisible();
  await expect(page.getByText('Planned · No set time', { exact: true })).toBeVisible();
  await expect(page.getByText('Push · Pull · Legs · session 1 · 30 minutes', { exact: true })).toBeVisible();
  await expect(page.getByText('3 exercises', { exact: true })).toBeVisible();
  await expect(page.getByText('This planned time has passed', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Back to training', exact: true }).click();
  await expect(page.getByText('Workout plans', { exact: true })).toBeVisible();
  await expect(page.getByText('No set time', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Open day', exact: true }).click();
  await expect(page.getByText('Planned workouts', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  await page.getByText('Push session', { exact: true }).click();
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  await page.getByRole('radio', { name: 'Set date and time', exact: true }).click();
  await page.getByRole('button', { name: 'Tomorrow', exact: true }).click();
  await page.getByRole('button', { name: 'Update workout plan', exact: true }).click();
  await expect(page.getByText('Planned · No set time', { exact: true })).toHaveCount(0);

  await page.clock.setFixedTime(new Date('2026-09-02T04:00:00.000Z'));
  await page.reload();
  await expect(page.getByText('This planned time has passed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Move to tomorrow', exact: true }).click();
  await expect(page.getByText('This planned time has passed', { exact: true })).toHaveCount(0);
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
  await expect(page.getByText('This session’s muscle coverage')).toHaveCount(0);
  await page.getByRole('button', { name: /Complete sets for Goblet Squat/ }).click();
  await expect(page.getByText('This session’s muscle coverage')).toBeVisible();
  await expect(page.getByText('Quadriceps · 3 set credits')).toBeVisible();
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
  await expect(page.getByText('Cloud current', { exact: true })).toBeVisible();
  await expect(page.getByText(/Last successful cloud sync/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'App recovery', exact: true })).toBeVisible();
  await expect(page.getByText('No app recovery errors recorded', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Cloud sync is current.', { exact: true })).toBeVisible();
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

  await newerPage.getByRole('tab', { name: 'Settings' }).click();
  await newerPage.getByRole('button', { name: 'Data', exact: true }).click();
  await newerPage.getByRole('button', { name: 'Delete account', exact: true }).click();
  await newerPage.getByLabel('Type DELETE to continue').fill('DELETE');
  await newerPage.getByRole('button', { name: 'Permanently delete account' }).click();
  await expect(newerPage.getByRole('heading', { name: 'Your training record, on every device' })).toBeVisible();

  await newerPage.evaluate(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: 'sb-jien-e2e-auth-token', value: qaSession() });
  await completeOnboarding(newerPage);
  await newerPage.getByRole('tab', { name: 'Train' }).click();
  await newerPage.getByRole('button', { name: /History/ }).click();
  await expect(newerPage.getByRole('link', { name: /Open Browser QA strength from/ })).toHaveCount(0);
  await newerPage.close();
  expect(pageErrors).toEqual([]);
});
