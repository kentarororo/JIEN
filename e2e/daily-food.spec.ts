import { expect, test } from '@playwright/test';
import { completeOnboarding, expectNoHorizontalOverflow, prepareIsolatedJienContext } from './helpers';

test.use({ actionTimeout: 10_000 });

test('day-first food log adds, scales and removes individual items without changing siblings or dates', async ({ context, page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await page.getByRole('button', { name: /^Food log\./ }).click();
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(page).toHaveURL(/date=/);
  const date = new URL(page.url()).searchParams.get('date');
  expect(date).toBeTruthy();
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  await page.getByRole('textbox', { name: 'Food', exact: true }).fill('First food QA');
  for (const [name, value] of [['Calories', '200'], ['Protein (g)', '10'], ['Carbs (g)', '20'], ['Fat (g)', '8']]) {
    await page.getByLabel(name!, { exact: true }).fill(value!);
  }
  await page.getByRole('button', { name: 'Add a blank food', exact: true }).click();
  await page.getByRole('textbox', { name: 'Food', exact: true }).nth(1).fill('Second food QA');
  for (const [name, value] of [['Calories', '100'], ['Protein (g)', '5'], ['Carbs (g)', '10'], ['Fat (g)', '4']]) {
    await page.getByLabel(name!, { exact: true }).nth(1).fill(value!);
  }
  await page.getByRole('button', { name: 'Add to day', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Daily food log', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('date')).toBe(date);
  await expect(page.getByRole('button', { name: 'Edit First food QA, 200 calories', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Second food QA, 100 calories', exact: true })).toBeVisible();
  await expect(page.getByText('300', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Food day status: Partial', { exact: true })).toBeVisible();
  // Disable the network after app load: day-state and food-item writes still commit locally.
  await context.setOffline(true);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Mark day complete', exact: true }).click();
  await expect(page.getByLabel('Food day status: Complete', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark day partial', exact: true }).click();
  await expect(page.getByLabel('Food day status: Partial', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit First food QA, 200 calories', exact: true }).click();
  await page.getByLabel('Portion', { exact: true }).fill('0');
  await expect(page.getByRole('button', { name: 'Save portion', exact: true })).toBeDisabled();
  await page.getByLabel('Portion', { exact: true }).fill('0.5');
  await page.getByRole('button', { name: 'Save portion', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit First food QA, 100 calories', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Second food QA, 100 calories', exact: true })).toBeVisible();
  await expect(page.getByText('200', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit First food QA, 100 calories', exact: true }).click();
  await page.getByRole('button', { name: 'Remove from day', exact: true }).click();
  await page.getByRole('button', { name: 'Keep item', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Edit First food QA, 100 calories', exact: true }).click();
  await page.getByRole('button', { name: 'Remove from day', exact: true }).click();
  await page.getByRole('button', { name: 'Remove item', exact: true }).click();
  await expect(page.getByRole('button', { name: /Edit First food QA/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit Second food QA, 100 calories', exact: true })).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit Second food QA, 100 calories', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Edit First food QA/ })).toHaveCount(0);
  await page.getByLabel('Quick add', { exact: true }).fill('banana');
  const banana = page.getByRole('button', { name: /^Add Banana/i }).first();
  await context.setOffline(true);
  await banana.click();
  await expect(page.getByRole('heading', { name: 'Add food', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add to day', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Edit Banana/i }).first()).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Add Banana', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath('daily-food-light.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath('daily-food-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole('button', { name: /^Edit Banana/i }).first().click();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath('food-portion-narrow-dark.png') });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Back to today', exact: true }).click();
  await expect(page.getByText('No food logged', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
