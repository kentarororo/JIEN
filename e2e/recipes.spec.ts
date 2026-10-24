import { expect, test } from '@playwright/test';
import { collectPageErrors, completeOnboarding, expectNoHorizontalOverflow, prepareIsolatedJienContext } from './helpers';

/** Issue #14 AC7: create → log 1.5 servings → edit recipe → past log unchanged. Offline throughout. */
test.use({ actionTimeout: 10_000 });

test('recipe journey: create offline, log 1.5 servings, edit the recipe, past log unchanged', async ({ context, page }) => {
  const errors = collectPageErrors(page);
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await page.getByRole('tab', { name: 'Food', exact: true }).click();
  await page.getByRole('button', { name: 'My foods', exact: true }).click();
  // AC6: empty state on My foods and the recipe list.
  await expect(page.getByText('No recipes yet', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manage recipes', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Recipes', exact: true }).last()).toBeVisible();
  await expect(page.getByText('No recipes yet', { exact: true }).last()).toBeVisible();

  // AC4: writes go to local SQLite first, so the whole builder works offline.
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Create recipe', exact: true }).last().click();
  await expect(page.getByText('No ingredients yet', { exact: true })).toBeVisible();
  await page.getByLabel('Recipe name', { exact: true }).fill('Recipe laksa QA');
  await page.getByLabel('Total servings', { exact: true }).fill('2');
  // AC1: manual ingredients with portions; per-serving totals are derived from them.
  const ingredients: Array<[string, string, Record<string, string>]> = [
    ['Laksa paste QA', '1', { 'Calories': '200', 'Protein (g)': '5', 'Carbs (g)': '10', 'Fat (g)': '15' }],
    ['Rice noodles QA', '2', { 'Calories': '190', 'Protein (g)': '6', 'Carbs (g)': '40', 'Fat (g)': '1' }],
  ];
  for (const [index, [name, servings, macros]] of ingredients.entries()) {
    await page.getByRole('button', { name: 'Add manually', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).nth(index).fill(name);
    await page.getByLabel('Number of servings', { exact: true }).nth(index).fill(servings);
    for (const [label, value] of Object.entries(macros)) await page.getByLabel(label, { exact: true }).nth(index).fill(value);
  }
  // (200 + 2×190) / 2 = 290 kcal; P (5 + 12) / 2 = 8.5; C (10 + 80) / 2 = 45; F (15 + 2) / 2 = 8.5.
  await expect(page.getByText('290 kcal · P 8.5 g · C 45 g · F 8.5 g', { exact: true })).toBeVisible();
  // AC5: private only, no sharing option anywhere in the builder.
  await expect(page.getByRole('button', { name: /share|community/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save recipe', exact: true }).click();
  await expect(page.getByText('Recipe laksa QA saved locally and queued for sync. Past food logs were not changed.', { exact: true })).toBeVisible();
  await expect(page.getByText('Recipe · 2 ingredients · 2 servings', { exact: true })).toBeVisible();
  await expect(page.getByText('290 kcal · P 8.5 g per serving', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // AC2: labelled as a recipe in My foods.
  await page.getByRole('button', { name: 'Done', exact: true }).last().click();
  await expect(page.getByText('Recipe · 2 ingredients · 290 kcal per serving', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).last().click();

  // AC2/AC3: found in Add food search, labelled Recipe, logged as one item of 1.5 servings.
  await page.getByRole('tab', { name: 'Food', exact: true }).click();
  await page.getByRole('button', { name: 'Add food', exact: true }).first().click();
  const search = page.getByLabel('Food search', { exact: true });
  await search.fill('laksa QA');
  await search.press('Enter');
  const result = page.getByRole('button', { name: /Recipe laksa QA.*Recipe/ }).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.getByRole('textbox', { name: 'Food', exact: true })).toHaveValue('Recipe laksa QA');
  await page.getByLabel('Quantity', { exact: true }).fill('1.5');
  await expect(page.getByLabel('Calories', { exact: true })).toHaveValue('435');
  await page.getByRole('button', { name: 'Add to day', exact: true }).last().click();
  const logged = page.getByRole('button', { name: 'Edit Recipe laksa QA, 435 calories', exact: true });
  await expect(logged).toBeVisible();

  // AC3: editing the recipe later (now 4 servings → 145 kcal each) does not rewrite the past log.
  await page.getByRole('button', { name: 'My foods', exact: true }).first().click();
  await page.getByRole('button', { name: 'Manage recipes', exact: true }).last().click();
  await page.getByRole('button', { name: 'Edit Recipe laksa QA', exact: true }).click();
  await page.getByLabel('Total servings', { exact: true }).fill('4');
  await expect(page.getByText('145 kcal · P 4.25 g · C 22.5 g · F 4.25 g', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save recipe changes', exact: true }).click();
  await expect(page.getByText('145 kcal · P 4.25 g per serving', { exact: true })).toBeVisible();
  // Reload (back online: offline cold start is #18's service worker) proves the edit and the old log were persisted.
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText('145 kcal · P 4.25 g per serving', { exact: true }).last()).toBeVisible();
  await page.goto('/');
  await page.getByRole('tab', { name: 'Food', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Recipe laksa QA, 435 calories', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
