import { expect, test } from '@playwright/test';

import {
  completeOnboarding,
  expectNoHorizontalOverflow,
  fixJienClock,
  prepareIsolatedJienContext,
} from './helpers';

test('Today offers neutral actions for one missed scheduled workout', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'edge-desktop', 'One browser owns the missed-session state transition.');
  await prepareIsolatedJienContext(context, page);
  await fixJienClock(page);
  await completeOnboarding(page);

  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  await page.getByRole('button', { name: /Plan workout$/ }).click();
  await page.getByRole('button', { name: 'Use Full body routine starter', exact: true }).click();
  await page.getByRole('radio', { name: 'Set date and time', exact: true }).click();
  await page.getByLabel('Session name').fill('Missed-session QA');
  await page.getByRole('button', { name: 'Tomorrow', exact: true }).click();
  await page.getByRole('button', { name: 'Morning · 07:00', exact: true }).click();
  await page.getByRole('button', { name: 'Save workout plan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeVisible();

  await page.clock.setFixedTime(new Date('2026-09-03T04:00:00.000Z'));
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Missed session', exact: true })).toBeVisible();
  await expect(page.getByLabel('Missed workout: Missed-session QA', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start now', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move to a new date', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip', exact: true })).toBeVisible();
  await expect(page.getByText(/No completed-workout totals or progression values changed/)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Start now', exact: true }).click();
  await expect(page.getByText('Planned workout loaded', { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  await expect(page.getByText('No missed sessions', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByLabel('Missed workout: Missed-session QA', { exact: true }).filter({ visible: true })).toHaveCount(0);
});
