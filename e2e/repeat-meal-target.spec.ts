import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, completeOnboarding, prepareIsolatedJienContext } from './helpers';

test.use({ actionTimeout: 10_000 });

/** Local calendar key `daysAgo` days before the browser's today. */
async function dateKey(page: Page, daysAgo: number): Promise<string> {
  return page.evaluate((offset) => {
    const d = new Date(); d.setDate(d.getDate() - offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, daysAgo);
}

/** Same format as the "Log again on …" label in src/app/meals/[id].tsx, e.g. "Wed 21 Oct". */
function repeatLabel(key: string): string {
  const date = new Date(`${key}T12:00:00`);
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-SG', options).format(date);
  return `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'short' })}`;
}

const MEAL = 'Repeat target QA';

// #29: back-fill yesterday by repeating a meal from two days ago (the issue's repro), with zero extra taps.
test('Log again defaults to the Food day you were back-filling and leaves the original alone (#29)', async ({ context, page }) => {
  const errors = collectPageErrors(page);
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await page.getByRole('button', { name: /^Food log\./ }).click();
  const previous = page.getByRole('button', { name: 'Previous day', exact: true });
  const next = page.getByRole('button', { name: 'Next day', exact: true });
  const twoDaysAgo = await dateKey(page, 2);
  const yesterday = await dateKey(page, 1);

  // 1. Two days ago: log the meal once.
  await previous.click();
  await previous.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('date')).toBe(twoDaysAgo);
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  await page.getByRole('textbox', { name: 'Food', exact: true }).fill(MEAL);
  for (const [name, value] of [['Calories', '300'], ['Protein (g)', '20'], ['Carbs (g)', '30'], ['Fat (g)', '10']]) {
    await page.getByLabel(name!, { exact: true }).fill(value!);
  }
  await page.getByRole('button', { name: 'Add to day', exact: true }).click();
  const original = page.getByRole('button', { name: `Edit ${MEAL}, 300 calories`, exact: true });
  await expect(original).toBeVisible();

  // 2. Move to yesterday (the day to back-fill), then back to the meal's day and open it.
  await next.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('date')).toBe(yesterday);
  await expect(page.getByText('No food logged', { exact: true }).locator('visible=true').first()).toBeVisible();
  await previous.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('date')).toBe(twoDaysAgo);
  await original.click();
  await page.getByRole('button', { name: 'Edit nutrition or view original entry', exact: true }).click();
  await expect(page).toHaveURL(/\/meals\//);
  const mealPath = new URL(page.url()).pathname;

  // AC1: the back-fill day is the default and the button names it.
  const logAgain = page.getByRole('button', { name: `Log again on ${repeatLabel(yesterday)}`, exact: true });
  await expect(logAgain).toBeVisible();
  await logAgain.click();
  await expect(page.getByRole('heading', { name: 'Add food', exact: true })).toBeVisible();
  await expect(page.getByText(/Logging for/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Add to day', exact: true }).click();

  // The copy lands on yesterday, not today and not next to the original.
  await expect(page.getByRole('heading', { name: 'Daily food log', exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('date')).toBe(yesterday);
  await expect(page.getByRole('button', { name: `Edit ${MEAL}, 300 calories`, exact: true }).locator('visible=true')).toHaveCount(1);

  // AC3: the original stays put, once, unchanged.
  await previous.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('date')).toBe(twoDaysAgo);
  await expect(page.getByRole('button', { name: `Edit ${MEAL}, 300 calories`, exact: true }).locator('visible=true')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back to today', exact: true }).click();
  await expect(page.getByText('No food logged', { exact: true }).locator('visible=true').first()).toBeVisible();

  // AC2: opening the meal without coming from a Food day step defaults to today.
  await page.goto(mealPath);
  await expect(page.getByRole('button', { name: 'Log again on today', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
