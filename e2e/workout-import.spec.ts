import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { completeOnboarding, expectNoHorizontalOverflow, prepareIsolatedJienContext } from './helpers';

// #20 AC6: upload → map → import → history, with synthetic fixtures only.
test.use({ actionTimeout: 10_000 });

const fixture = (name: string) => path.join(__dirname, 'fixtures', name);

async function chooseCsv(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Choose (workout|another) CSV$/ }).first().click();
  await (await chooser).setFiles(file);
}

async function openImport(page: Page) {
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  const data = page.getByRole('button', { name: 'Data', exact: true });
  if (await data.count()) await data.first().click();
  await page.getByRole('button', { name: 'Import workout history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import workout history', exact: true })).toBeVisible();
}

test('Hevy and Strong CSVs preview, map, import offline into history, and never duplicate on re-import', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'edge-desktop' && testInfo.project.name !== 'android-chrome', 'One desktop and one phone browser own the import journey.');
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await openImport(page);

  // AC1: an unknown format is rejected clearly and nothing is previewed.
  await chooseCsv(page, { name: 'foods.csv', mimeType: 'text/csv', buffer: Buffer.from('date,food,kcal\n2026-09-01,rice,300\n') });
  await expect(page.getByText('Unknown workout CSV format. Choose a workout export from Hevy or Strong.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Import \d+ workouts$/ })).toHaveCount(0);

  // AC1/AC2: Hevy is detected and previewed before any write.
  await chooseCsv(page, fixture('hevy-workouts-synthetic.csv'));
  await expect(page.getByText('Hevy format detected', { exact: true })).toBeVisible();
  await expect(page.getByText('Date range', { exact: true }).locator('../..')).toHaveText(/Workouts\s*2\s*Sets\s*7\s*Date range\s*1 Sept?\s*–\s*4 Sept?/);
  await expect(page.getByText('1 unmatched', { exact: true })).toBeVisible();
  await expect(page.getByText('QA Cable Fly (Synthetic)', { exact: true })).toBeVisible();
  await expect(page.getByText('Barbell Bench Press', { exact: true }), 'an exact catalogue name is matched, not listed').toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  // AC2: map the unmatched exercise to an existing catalogue entry.
  await page.getByRole('button', { name: 'Map to existing', exact: true }).click();
  await page.getByLabel('Find a JIEN exercise for QA Cable Fly (Synthetic)', { exact: true }).fill('cable fly');
  await page.getByRole('button', { name: 'Use Cable Fly', exact: true }).click();
  await expect(page.getByText('Mapped to Cable Fly', { exact: true })).toBeVisible();

  // Consent gates the write.
  const importButton = page.getByRole('button', { name: 'Import 2 workouts', exact: true });
  await expect(importButton).toBeDisabled();
  await page.getByRole('button', { name: 'I have the right to import this data', exact: true }).click();

  // AC3: local-first — the import completes with the network down.
  await context.setOffline(true);
  await importButton.click();
  await expect(page.getByText('Workout history imported', { exact: true })).toBeVisible();
  await expect(page.getByText(/2 workouts and 7 sets were saved\./)).toBeVisible();

  // AC4: the same file again creates nothing.
  await chooseCsv(page, fixture('hevy-workouts-synthetic.csv'));
  await page.getByRole('button', { name: 'Map to existing', exact: true }).click();
  await page.getByLabel('Find a JIEN exercise for QA Cable Fly (Synthetic)', { exact: true }).fill('cable fly');
  await page.getByRole('button', { name: 'Use Cable Fly', exact: true }).click();
  await page.getByRole('button', { name: 'I have the right to import this data', exact: true }).click();
  await page.getByRole('button', { name: 'Import 2 workouts', exact: true }).click();
  await expect(page.getByText('This file was already imported', { exact: true })).toBeVisible();
  await expect(page.getByText('All 2 workouts already exist on this device, so no duplicates were created.', { exact: true })).toBeVisible();

  // Strong is detected; its unmatched exercise is created as custom (the default).
  await chooseCsv(page, fixture('strong-workouts-synthetic.csv'));
  await expect(page.getByText('Strong format detected', { exact: true })).toBeVisible();
  await expect(page.getByText('QA Hack Squat (Synthetic)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'I have the right to import this data', exact: true }).click();
  await page.getByRole('button', { name: 'Import 2 workouts', exact: true }).click();
  await expect(page.getByText(/2 workouts and 4 sets were saved\./)).toBeVisible();
  await context.setOffline(false);

  // AC5: imported sessions appear in Training history after a reload, with mapped and custom exercises.
  await page.reload();
  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  await page.getByRole('button', { name: 'History 4', exact: true }).click();
  await expect(page.getByText('4 matching saved sessions', { exact: true })).toBeVisible();
  for (const title of ['QA Push A', 'QA Push B']) await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(page.getByText('QA Leg Day', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Barbell Bench Press · Cable Fly', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/QA Hack Squat \(Synthetic\)/).first()).toBeVisible();
  expect(errors).toEqual([]);
});
