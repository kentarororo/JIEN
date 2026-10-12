import { expect, test } from '@playwright/test';
import { completeOnboarding, prepareIsolatedJienContext } from './helpers';

test('shared Anthropic settings need no personal key and disclose owner-funded usage', async ({ context, page }) => {
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await context.route('https://jien-e2e.supabase.co/functions/v1/ai-settings', async (route) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ headers, body: 'ok' }); return; }
    expect(route.request().postDataJSON().data.action).toBe('status');
    await route.fulfill({ headers, json: { data: { configured: true, credentialMode: 'app', credentialSource: 'app',
      provider: 'anthropic', model: 'claude-haiku-4-5', usagePolicy: 'provider_managed' }, requestId: 'qa-ai-settings' } });
  });
  await page.goto('/settings/ai');
  await expect(page.getByText('Anthropic configured', { exact: true })).toBeVisible();
  await expect(page.getByText('No personal key needed', { exact: true })).toBeVisible();
  await expect(page.getByText(/Usage is paid by the app owner/)).toBeVisible();
  await expect(page.getByLabel('Gemini API key', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Test with a meal photo', exact: true })).toBeVisible();
});
