import { expect, test } from '@playwright/test';
import { collectPageErrors, completeOnboarding, prepareIsolatedJienContext } from './helpers';

test.use({ actionTimeout: 10_000 });

// #45: a morning weigh-in is one tap from Today's top card, with no scrolling on a phone.
test('Today top card has a Weigh in shortcut above the fold that opens the body log (#45)', async ({ context, page }) => {
  const errors = collectPageErrors(page);
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  const weighIn = page.getByRole('button', { name: /^Weigh in/ });
  await expect(weighIn).toBeVisible();
  // Reachable without scrolling. On iPhone 13 only about half the card clears the tab bar, so no full-visibility check.
  await expect(weighIn).toBeInViewport();
  const box = await weighIn.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await weighIn.click();
  await expect(page).toHaveURL(/\/wellness\/body/);
  await expect(page.getByRole('button', { name: 'Save measurement', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
