import { expect, test } from '@playwright/test';

import { collectPageErrors, completeOnboarding, prepareIsolatedJienContext } from './helpers';

// #53: Settings → Data shows clear Google Sheets states without reaching Google when it can't.
test('Google Sheets export: not connected, offline and not-configured states are clear and nothing reaches Google', async ({ context, page }) => {
  const errors = collectPageErrors(page);
  const googleCalls: string[] = [];
  await context.route(/googleapis\.com/, async (route) => { googleCalls.push(route.request().url()); await route.abort(); });
  await context.route('https://accounts.google.com/gsi/client', (route) => route.abort());
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Data', exact: true }).click();

  await expect(page.getByText('Google Sheets', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Not connected\. Google will ask for access to files created by JIEN only\./)).toBeVisible();
  await expect(page.getByText(/drive\.file scope/)).toBeVisible();
  const exportButton = page.getByRole('button', { name: 'Export to Google Sheets', exact: true });
  await expect(exportButton).toBeEnabled();

  await context.setOffline(true);
  await exportButton.click();
  await expect(page.getByText('Export needs a connection.', { exact: true })).toBeVisible();
  const retry = page.getByRole('button', { name: 'Retry Google Sheets export', exact: true });
  await expect(retry).toBeVisible();

  await context.setOffline(false);
  await retry.click();
  // The e2e build has no EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID, so the app must say so instead of failing silently.
  await expect(page.getByText('Google Sheets export is not configured for this app yet.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Google Sheet', exact: true })).toHaveCount(0);
  expect(googleCalls).toEqual([]);
  expect(errors).toEqual([]);
});
