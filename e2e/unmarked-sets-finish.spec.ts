import { expect, test, type Page } from '@playwright/test';

import { collectPageErrors, completeOnboarding, fixJienClock, prepareIsolatedJienContext } from './helpers';

// #78 [S1]: filled but unmarked sets must never dead-end Finish/Save.
// Expected behaviour (Ken, 10 Nov): one sheet with Mark all as done (default) ·
// Save only completed sets · Keep editing. Valid data is never blamed as invalid.
// Red on main until the fix lands; see PR "Refs #78".

// 16 kg × 12, 10, 10, as in the #78 repro.
const SETS = [
  { load: '16', reps: '12' },
  { load: '16', reps: '10' },
  { load: '16', reps: '10' },
] as const;

async function logGobletSquatWithoutMarking(page: Page) {
  await page.getByRole('button', { name: /Log workout/ }).first().click();
  await page.getByLabel('Find exercise for exercise 1').fill('Goblet Squat');
  await page.getByRole('button', { name: /^Goblet Squat .*Choose$/ }).click();
  const loads = page.getByRole('textbox', { name: 'Load (kg)', exact: true });
  const reps = page.getByRole('textbox', { name: 'Reps', exact: true });
  for (const [index, set] of SETS.entries()) {
    await loads.nth(index).fill(set.load);
    await reps.nth(index).fill(set.reps);
  }
  return { loads, reps };
}

test.beforeEach(async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name === 'edge-desktop', 'Real-user logging journey runs at phone size only.');
  await prepareIsolatedJienContext(context, page);
  if (testInfo.project.name !== 'ios-webkit') await fixJienClock(page);
  await completeOnboarding(page);
});

test('#78 saving with filled but unmarked sets offers Mark all as done and saves every set', async ({ page }) => {
  const errors = collectPageErrors(page);
  await logGobletSquatWithoutMarking(page);

  // Valid rows must not be described as invalid (soft, so the run still reaches the sheet check).
  await expect.soft(page.getByText(/needs a valid load and whole-number reps/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Save completed workout', exact: true }).click();

  // One sheet, three choices; Mark all as done is the default (first) action.
  const markAll = page.getByRole('button', { name: 'Mark all as done', exact: true });
  await expect(markAll).toBeVisible();
  await expect(markAll).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Save only completed sets', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep editing', exact: true })).toBeVisible();

  await markAll.click();

  // The workout is saved with all three sets: 16×12 + 16×10 + 16×10 = 512.
  await expect(page.getByRole('heading', { name: 'Log workout', exact: true })).toHaveCount(0);
  await expect(page.getByText('512', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('#78 Keep editing returns to the logger untouched, and Save only completed sets drops unmarked rows', async ({ page }) => {
  const { loads, reps } = await logGobletSquatWithoutMarking(page);
  await page.getByRole('button', { name: 'Mark set complete', exact: true }).first().click();

  await page.getByRole('button', { name: 'Save completed workout', exact: true }).click();
  const keepEditing = page.getByRole('button', { name: 'Keep editing', exact: true });
  await expect(keepEditing).toBeVisible();
  await keepEditing.click();
  await expect(page.getByRole('heading', { name: 'Log workout', exact: true })).toBeVisible();
  await expect(loads.nth(2)).toHaveValue('16');
  await expect(reps.nth(2)).toHaveValue('10');

  await page.getByRole('button', { name: 'Save completed workout', exact: true }).click();
  const saveCompleted = page.getByRole('button', { name: 'Save only completed sets', exact: true });
  await expect(saveCompleted).toBeVisible();
  await saveCompleted.click();

  // Only the marked set (16×12 = 192) is saved.
  await expect(page.getByRole('heading', { name: 'Log workout', exact: true })).toHaveCount(0);
  await expect(page.getByText('192', { exact: true })).toBeVisible();
});
