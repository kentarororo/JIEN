import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, completeOnboarding, expectNoHorizontalOverflow, prepareIsolatedJienContext } from './helpers';

/** Issue #22: exercise and muscle progress charts, range switching and the two-session empty state. */
test.use({ actionTimeout: 10_000 });

async function logFirstGobletSquat(page: Page) {
  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  await page.getByRole('button', { name: 'Log workout', exact: true }).last().click();
  await page.getByLabel('Session name').fill('Chart QA legs');
  await page.getByLabel('Find exercise for exercise 1').fill('Goblet Squat');
  await page.getByRole('button', { name: /^Goblet Squat .*(Choose|Selected)$/ }).click();
  const loads = page.getByRole('textbox', { name: 'Load (kg)', exact: true });
  const reps = page.getByRole('textbox', { name: 'Reps', exact: true });
  for (let index = 0; index < await loads.count(); index += 1) {
    await loads.nth(index).fill('20');
    await reps.nth(index).fill('10');
  }
  // Complete sets one at a time, the way a lifter does between rests, so each set has its own timestamp.
  const marks = page.getByRole('button', { name: 'Mark set complete', exact: true });
  while (await marks.count()) {
    await marks.first().click();
    await page.waitForTimeout(25);
  }
  await page.getByRole('button', { name: 'Save completed workout', exact: true }).click();
}

const trendEmpty = (page: Page) => page.getByText('Log 2 sessions to see a trend', { exact: true });

test('one session shows the two-session empty state; a second unlocks exercise and muscle charts with 12/26/52-week ranges', async ({ context, page }) => {
  test.setTimeout(150_000);
  const errors = collectPageErrors(page);
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await logFirstGobletSquat(page);

  // Exercise history after one session: baseline only.
  await page.getByRole('button', { name: 'View exercise history', exact: true }).click();
  await expect(trendEmpty(page).last()).toBeVisible();
  await expect(page.getByText('Exercise trends', { exact: true })).toHaveCount(0);

  // Train tab after one session: muscle charts also wait for a second session.
  await page.getByRole('button', { name: 'Back to training', exact: true }).click();
  await expect(trendEmpty(page).last()).toBeVisible();
  await expect(page.getByText('Muscle trends', { exact: true })).toHaveCount(0);

  // Second session from the same values.
  await page.getByRole('link', { name: /Open Chart QA legs from/ }).first().click().catch(async () => {
    await page.getByRole('button', { name: /History/ }).click();
    await page.getByRole('link', { name: /Open Chart QA legs from/ }).first().click();
  });
  await page.getByRole('button', { name: 'Log from these values', exact: true }).click();
  await page.getByRole('button', { name: /Complete sets for Goblet Squat/ }).click();
  await page.getByRole('button', { name: 'Save completed workout', exact: true }).click();

  await page.getByRole('button', { name: 'View exercise history', exact: true }).click();
  await expect(page.getByText('Exercise trends', { exact: true })).toBeVisible();
  await expect(trendEmpty(page)).toHaveCount(0);
  // Both sessions fall in this week: 2 × 3 × 20 kg × 10 = 1,200 kg·reps; best in-range set 20 kg × 10.
  await expect(page.getByText('20 kg × 10 reps latest', { exact: true })).toBeVisible();
  for (const weeks of [12, 26, 52, 12]) {
    await page.getByRole('button', { name: `${weeks} weeks`, exact: true }).click();
    await expect(page.getByLabel(`Goblet Squat weekly volume over ${weeks} weeks`, { exact: true })).toBeVisible();
    await expect(page.getByLabel(`Goblet Squat heaviest logged set from 8 to 12 reps over ${weeks} weeks`, { exact: true })).toBeVisible();
  }
  await expect(page.getByLabel(/kilograms for 10 reps$/)).toHaveCount(1);
  await expect(page.getByText(/1RM|one-rep max|estimated max/i)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Back to training', exact: true }).click();
  await expect(page.getByText('Muscle trends', { exact: true })).toBeVisible();
  for (const weeks of [26, 52, 12]) {
    await page.getByRole('button', { name: `${weeks} weeks`, exact: true }).click();
    await expect(page.getByLabel(new RegExp(`weekly training-set credits over ${weeks} weeks$`))).toBeVisible();
    await expect(page.getByLabel(new RegExp(`weekly logged volume over ${weeks} weeks$`))).toBeVisible();
  }
  // Goblet Squat: quads primary (1.0 per set), glutes and adductors assisting (0.5 per set). 6 sets this week.
  await page.getByRole('button', { name: 'Quadriceps', exact: true }).last().click();
  await expect(page.getByLabel('Quadriceps weekly training-set credits over 12 weeks', { exact: true })).toBeVisible();
  await expect(page.getByText('Latest week: 6 set credits', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Latest week: 1,?200 kg·reps$/)).toBeVisible();
  await page.getByRole('button', { name: 'Glutes', exact: true }).last().click();
  await expect(page.getByLabel('Glutes weekly training-set credits over 12 weeks', { exact: true })).toBeVisible();
  await expect(page.getByText('Latest week: 3 set credits', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Adductors', exact: true }).last().click();
  await expect(page.getByLabel('Adductors weekly logged volume over 12 weeks', { exact: true })).toBeVisible();
  // Assisting muscles get half the logged volume: 0.5 × 1,200.
  await expect(page.getByText('Latest week: 600 kg·reps', { exact: true })).toBeVisible();
  await expect(page.getByText('Latest week: 3 set credits', { exact: true })).toBeVisible();
  await expect(page.getByText('No programme target set', { exact: true })).toBeVisible();
  await expect(page.getByText(/1RM|one-rep max|estimated max/i)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
