import { expect, test, type Page } from '@playwright/test';
import { completeOnboarding, expectNoHorizontalOverflow, prepareIsolatedJienContext } from './helpers';

test.use({ actionTimeout: 10_000 });
function trackSync(page: Page) {
  let last = Date.now(); const pending = new Set<object>();
  page.on('request', (r) => { if (r.url().startsWith('https://jien-e2e.supabase.co/')) { pending.add(r); last = Date.now(); } });
  const done = (r: object) => { if (pending.delete(r)) last = Date.now(); };
  page.on('requestfinished', done); page.on('requestfailed', done);
  return async () => { const start = Date.now(); await expect.poll(() => pending.size === 0 && Date.now() - Math.max(start, last) > 600).toBe(true); };
}

test('planned workouts open directly in editable sets and recover without logging targets', async ({ context, page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const idle = trackSync(page);
  await prepareIsolatedJienContext(context, page); await completeOnboarding(page);
  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  await page.getByRole('button', { name: /Plan workout$/ }).click();
  await page.getByRole('button', { name: 'Use Push routine starter', exact: true }).click();
  await page.getByRole('radio', { name: 'Set date and time', exact: true }).click();
  await page.getByRole('button', { name: 'Tomorrow', exact: true }).click();
  await page.getByRole('button', { name: 'Start workout now', exact: true }).click();
  await expect(page.getByText('Planned workout loaded', { exact: true })).toBeVisible();
  const loads = page.getByRole('textbox', { name: 'Load (kg)', exact: true });
  const reps = page.getByRole('textbox', { name: 'Reps', exact: true });
  await expect(loads.first()).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Undo completed set', exact: true })).toHaveCount(0);
  await loads.first().fill('20'); await reps.first().fill('10');
  await expect(page.getByText('Repeat 20 kg × 10', { exact: true }).first()).toBeVisible();
  const firstTarget = page.getByRole('button', { name: 'Use target', exact: true }).first();
  const targetBox = await firstTarget.boundingBox();
  expect(targetBox!.height).toBeGreaterThanOrEqual(44);
  expect(targetBox!.width).toBeGreaterThanOrEqual(44);
  await firstTarget.focus(); await firstTarget.press('Space');
  await expect(loads.nth(1)).toHaveValue('20'); await expect(reps.nth(1)).toHaveValue('10');
  await expect(page.getByRole('textbox', { name: 'RPE', exact: true }).nth(1)).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Undo completed set', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'RPE', exact: true }).first().fill('10');
  await expect(page.getByRole('button', { name: 'Use target', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'RPE', exact: true }).first().fill('8');
  await expect(page.getByRole('button', { name: 'Use target', exact: true }).first()).toBeVisible();
  await page.getByRole('radio', { name: 'Failure', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Use target', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Working', exact: true }).first().click();
  await page.getByRole('button', { name: 'Mark set complete', exact: true }).first().click();
  await idle();
  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  await expect(page.getByText('No set time', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByText('Push session', { exact: true }).filter({ visible: true }).click();
  await expect(page.getByText('Unfinished workout restored', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo completed set', exact: true })).toHaveCount(1);
  await expect(loads.nth(1)).toHaveValue('20');
  await expectNoHorizontalOverflow(page);
  await loads.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('quick-workout-light.png') });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.screenshot({ path: testInfo.outputPath('quick-workout-dark.png') });
  if (testInfo.project.name === 'edge-desktop') {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Use target', exact: true }).first().scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('quick-workout-wide-dark.png') });
    await page.evaluate(() => {
      const sizes = [...document.querySelectorAll<HTMLElement>('div, span, input')]
        .filter((element) => element.tagName === 'INPUT' || [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()))
        .map((element) => ({ element, size: parseFloat(getComputedStyle(element).fontSize) }));
      for (const { element, size } of sizes) element.style.fontSize = `${size * 1.5}px`;
    });
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: 'Use target', exact: true }).first().scrollIntoViewIfNeeded();
      const visibleCopy = page.getByText('From your entered set, not a progression baseline.', { exact: true }).filter({ visible: true }).first();
      await expect(visibleCopy).toBeVisible();
      const copyBox = await visibleCopy.boundingBox();
      expect(copyBox!.width).toBeGreaterThanOrEqual(180);
      await page.screenshot({ path: testInfo.outputPath(`quick-workout-large-text-${width}.png`) });
    }
  }
  expect(errors).toEqual([]);
});

test('food entry starts with tracking and saves without a meal name', async ({ context, page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await prepareIsolatedJienContext(context, page); await completeOnboarding(page);
  await page.getByRole('button', { name: /Add meal/ }).first().click();
  await expect(page.getByLabel('Food search', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Meal name', { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('quick-food-light.png') });
  await page.getByRole('button', { name: 'Enter food manually', exact: true }).click();
  await page.getByRole('textbox', { name: 'Food', exact: true }).fill('Quick food QA');
  await page.getByLabel('Calories', { exact: true }).fill('200');
  await page.getByLabel('Protein (g)', { exact: true }).fill('15');
  await page.getByLabel('Carbs (g)', { exact: true }).fill('20');
  await page.getByLabel('Fat (g)', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Save meal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Food', exact: true }).click();
  await page.getByRole('button', { name: 'Open Meal, 200 calories', exact: true }).click();
  await expect(page.getByText('Quick food QA', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Meal', exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('calendar plans start in the logger while plan review stays available', async ({ context, page }) => {
  await prepareIsolatedJienContext(context, page); await completeOnboarding(page);
  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  await page.getByRole('button', { name: /Plan workout$/ }).click();
  await page.getByRole('button', { name: 'Use Push routine starter', exact: true }).click();
  await page.getByRole('radio', { name: 'Set date and time', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Save workout plan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Open day', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review Push session plan', exact: true })).toBeVisible();
  await page.getByRole('link', { name: /Push session.*Start \/ resume/ }).click();
  await expect(page.getByText('Planned workout loaded', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Load (kg)', exact: true }).first()).toBeEditable();
  await expect(page.getByRole('button', { name: 'Undo completed set', exact: true })).toHaveCount(0);
});

test('direct next workouts use live history targets and keep repeat drafts separate', async ({ context, page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const idle = trackSync(page);
  await prepareIsolatedJienContext(context, page); await completeOnboarding(page);
  await page.getByRole('button', { name: /Log workout/ }).first().click();
  await page.getByLabel('Find exercise for exercise 1').fill('Goblet Squat');
  await page.getByRole('button', { name: /^Goblet Squat .*Choose$/ }).click();
  const loads = page.getByRole('textbox', { name: 'Load (kg)', exact: true });
  const reps = page.getByRole('textbox', { name: 'Reps', exact: true });
  const effort = page.getByRole('textbox', { name: 'RPE', exact: true });
  for (let index = 0; index < 2; index += 1) {
    await loads.nth(index).fill('20'); await reps.nth(index).fill('10'); await effort.nth(index).fill('8');
  }
  await page.getByRole('button', { name: /Complete sets for Goblet Squat/ }).click();
  await page.getByRole('button', { name: 'Save completed workout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workout', exact: true })).toBeVisible();
  const completedUrl = page.url();
  await page.getByRole('radio', { name: /^Progress\./ }).click();
  await page.getByRole('button', { name: 'Start next workout', exact: true }).click();
  await expect(loads.first()).toHaveValue('20'); await expect(effort.first()).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Undo completed set', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use target', exact: true }).first()).toBeVisible();
  await effort.first().fill('10');
  await expect(page.getByRole('button', { name: 'Use target', exact: true })).toHaveCount(0);
  await effort.first().fill('8');
  await page.getByRole('button', { name: 'Use target', exact: true }).first().click();
  await expect(reps.first()).toHaveValue('11'); await expect(effort.first()).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Undo completed set', exact: true })).toHaveCount(0);
  await idle(); await page.goto(completedUrl);
  await expect(page.getByText('20 kg × 10', { exact: true })).toHaveCount(2);
  await page.getByRole('radio', { name: /^Repeat\./ }).click();
  await page.getByRole('button', { name: 'Start next workout', exact: true }).click();
  await expect(reps.first()).toHaveValue('10');
  await expect(page.getByRole('button', { name: 'Use target', exact: true })).toHaveCount(0);
  await idle(); await page.goto(completedUrl);
  await page.getByRole('radio', { name: /^Ease off\./ }).click();
  await page.getByRole('button', { name: 'Start next workout', exact: true }).click();
  await expect(loads).toHaveCount(1); await expect(reps.first()).toHaveValue('10');
  await expect(effort.first()).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Use target', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
