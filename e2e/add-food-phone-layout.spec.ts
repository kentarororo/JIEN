import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, completeOnboarding, expectNoHorizontalOverflow, prepareIsolatedJienContext } from './helpers';

/** Issue #30: Add food fits a 390×844 phone. */
test.use({ actionTimeout: 10_000, viewport: { width: 390, height: 844 } });

const addToDay = (page: Page) => page.getByRole('button', { name: 'Add to day', exact: true });

/** Scroll the Add food screen's own scroll container (mouse wheel isn't available in mobile WebKit). */
async function scrollAddFood(page: Page, deltaY: number) {
  const moved = await page.getByRole('textbox', { name: 'Food', exact: true }).first().evaluate((node, delta) => {
    let element: HTMLElement | null = node as HTMLElement;
    while (element && !(element.scrollHeight > element.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(element).overflowY))) {
      element = element.parentElement;
    }
    if (!element) return false;
    element.scrollTop += delta;
    return true;
  }, deltaY);
  expect(moved, 'Add food content scrolls').toBe(true);
  await page.waitForTimeout(150);
}

test('Add food keeps Add to day in reach, focuses the new row and hides optional details', async ({ context, page }) => {
  const errors = collectPageErrors(page);
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await page.getByRole('button', { name: /^Food log\./ }).click();
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  const date = new URL(page.url()).searchParams.get('date');
  await page.getByRole('button', { name: 'Add food', exact: true }).click();

  // AC2: Enter food manually focuses the first empty row's Food field and scrolls it into view.
  await page.getByRole('button', { name: 'Enter food manually', exact: true }).click();
  const food = page.getByRole('textbox', { name: 'Food', exact: true });
  await expect(food).toBeFocused();
  await expect(food).toBeInViewport();

  // AC3: name, portion and the four macros stay visible; the rest waits under More details.
  for (const label of ['Quantity', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  for (const label of ['Fibre (g)', 'Brand (optional)', 'Product barcode (optional)']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  }
  // Save as private food stays beside More details (it's a reuse action, not a sharing control);
  // community sharing waits under More details.
  await expect(page.getByRole('button', { name: 'Share with community', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save as private food', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save as private food', exact: true })).toBeDisabled();

  // AC4: name + kcal + protein is enough; carbs and fat are optional.
  await food.fill('Layout QA laksa');
  await page.getByLabel('Calories', { exact: true }).fill('550');
  await page.getByLabel('Protein (g)', { exact: true }).fill('22');
  await expect(page.getByRole('button', { name: 'Save as private food', exact: true })).toBeEnabled();

  // AC1: a pinned footer with item count and kcal stays in view while scrolling either way.
  await expect(page.getByText('1 food · 550 kcal', { exact: true })).toBeInViewport();
  await expect(addToDay(page)).toHaveCount(1);
  await expect(addToDay(page)).toBeInViewport();
  await scrollAddFood(page, -5_000);
  await expect(addToDay(page)).toBeInViewport();
  await scrollAddFood(page, 5_000);
  await expect(food, 'the screen really scrolled').not.toBeInViewport();
  await expect(addToDay(page)).toBeInViewport();
  await scrollAddFood(page, -2_000);
  await expect(addToDay(page)).toBeInViewport();

  // AC3: More details reveals the optional controls for this row.
  await page.getByRole('button', { name: 'More details', exact: true }).click();
  for (const label of ['Fibre (g)', 'Brand (optional)', 'Product barcode (optional)']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Share with community', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide details', exact: true }).click();
  await expect(page.getByLabel('Brand (optional)', { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await addToDay(page).click();
  await expect(page.getByRole('heading', { name: 'Daily food log', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('date')).toBe(date);
  await expect(page.getByRole('button', { name: 'Edit Layout QA laksa, 550 calories', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Create private food focuses the seeded Food field; no footer until a row is ready', async ({ context, page }) => {
  const errors = collectPageErrors(page);
  await prepareIsolatedJienContext(context, page);
  await context.route('https://world.openfoodfacts.org/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0, products: [] }),
    headers: { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' },
  }));
  await completeOnboarding(page);
  await page.goto('/meals/new');
  await expect(page.getByText(/^\d+ foods? · .* kcal$/)).toHaveCount(0);
  const search = page.getByLabel('Food search', { exact: true });
  await search.fill('zz layout kueh');
  await search.press('Enter');
  await expect(page.getByText('Create private food for “zz layout kueh”', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create private food', exact: true }).click();
  const food = page.getByRole('textbox', { name: 'Food', exact: true });
  await expect(food).toHaveValue('zz layout kueh');
  await expect(food).toBeFocused();
  await expect(food).toBeInViewport();
  await expect(page.getByText(/^\d+ foods? · .* kcal$/)).toHaveCount(0);
  await page.getByLabel('Calories', { exact: true }).fill('180');
  await expect(page.getByText(/^\d+ foods? · .* kcal$/)).toHaveCount(0);
  await page.getByLabel('Protein (g)', { exact: true }).fill('4');
  await expect(page.getByText('1 food · 180 kcal', { exact: true })).toBeInViewport();
  expect(errors).toEqual([]);
});
