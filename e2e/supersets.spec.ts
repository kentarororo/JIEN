import { expect, test } from '@playwright/test';

import { collectPageErrors, completeOnboarding, expectNoHorizontalOverflow, prepareIsolatedJienContext } from './helpers';

// #52: build a superset, log two rounds offline, reload, and history still shows the group.
test('superset: alternate two rounds offline, rest only after the round, group survives reload', async ({ context, page }) => {
  const errors = collectPageErrors(page);
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await page.getByRole('button', { name: /Log workout/ }).first().click();
  await page.getByLabel('Session name').fill('Superset QA');
  await page.getByLabel('Find exercise for exercise 1').fill('Goblet Squat');
  await page.getByRole('button', { name: /^Goblet Squat .*Choose$/ }).click();
  const loads = page.getByRole('textbox', { name: /^Set \d+ load in kg$/ });
  const reps = page.getByRole('textbox', { name: 'Reps', exact: true });
  const firstRows = await loads.count();
  await page.getByRole('button', { name: 'Add another exercise', exact: true }).click();
  await page.getByLabel('Find exercise for exercise 2').fill('Machine Chest Press');
  // The new block may already default to the next suggested exercise.
  const choose = page.getByRole('button', { name: /^Machine Chest Press .*Choose$/ });
  if (await choose.count()) await choose.click();
  await expect(page.getByRole('button', { name: /^Machine Chest Press .*Selected$/ })).toBeVisible();

  await page.getByLabel('Select Goblet Squat for superset', { exact: true }).click();
  await page.getByLabel('Select Machine Chest Press for superset', { exact: true }).click();
  await page.getByRole('button', { name: 'Group as superset', exact: true }).click();
  await expect(page.getByText('SUPERSET A1', { exact: true })).toBeVisible();
  await expect(page.getByText('SUPERSET A2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '1 min', exact: true }).click();

  await context.setOffline(true);
  const complete = page.getByRole('button', { name: 'Mark set complete', exact: true });
  const stopRest = page.getByRole('button', { name: 'Stop', exact: true });
  for (let round = 0; round < 2; round += 1) {
    await loads.nth(round).fill('20');
    await reps.nth(round).fill('10');
    await complete.first().click();
    // Mid-round: focus jumps to A2's matching row and rest does not start.
    await expect(loads.nth(firstRows + round)).toBeFocused();
    await expect(stopRest).toHaveCount(0);
    await loads.nth(firstRows + round).fill('40');
    await reps.nth(firstRows + round).fill('8');
    await page.getByRole('button', { name: 'Mark set complete', exact: true }).nth(firstRows - round - 1).click();
    // End of round: rest starts.
    await expect(stopRest).toBeVisible();
    await stopRest.click();
  }

  await page.getByRole('button', { name: 'Save completed workout' }).click();
  await expect(page.getByRole('heading', { name: 'Workout', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('A1 · Goblet Squat', { exact: true })).toBeVisible();
  await expect(page.getByText('A2 · Machine Chest Press', { exact: true })).toBeVisible();
  await expect(page.getByText(/Superset or circuit · 2 exercises/).first()).toBeVisible();
  // Grouping is presentation only: volume is the plain per-exercise sum (2×20×10 + 2×40×8 = 1,040).
  await expect(page.getByText(/1,?040/).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
