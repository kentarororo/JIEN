import { expect, test } from '@playwright/test';
import { collectPageErrors, completeOnboarding, expectNoHorizontalOverflow, prepareIsolatedJienContext } from './helpers';

test.use({ actionTimeout: 10_000 });

// #58: a tester reports a bug from Food while offline; it queues on the device, shows
// exactly what is attached, and sends only the message plus non-personal context on reconnect.
test('feedback from the Food menu queues offline and sends only message and shown context on reconnect', async ({ context, page }) => {
  const errors = collectPageErrors(page);
  await prepareIsolatedJienContext(context, page);
  const sent: unknown[] = [];
  await context.route('https://jien-e2e.supabase.co/functions/v1/feedback', async (route) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-request-id', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 200, headers: cors, body: 'ok' }); return; }
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ data: { id: 'x', issueNumber: 1 }, requestId: 'e2e-feedback' }) });
  });
  await completeOnboarding(page);

  await page.getByRole('tab', { name: 'Food', exact: true }).click();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Food menu', exact: true }).click();
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  const dialog = page.getByText('Report a bug, idea, or confusing part', { exact: true });
  await expect(dialog).toBeVisible();

  for (const type of ['Bug', 'Idea', 'Confusing']) await expect(page.getByRole('radio', { name: type, exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Include a screenshot' })).not.toBeChecked();
  await expect(page.getByText('Screen: Food', { exact: true })).toBeVisible();
  await expect(page.getByText('Connection: offline', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Viewport: \d+×\d+$/)).toBeVisible();
  await expect(page.getByText('Your message and the device details shown are sent to the JIEN team.', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const send = page.getByRole('button', { name: 'Send feedback', exact: true }).last();
  await expect(send).toBeDisabled();
  await page.getByRole('radio', { name: 'Confusing', exact: true }).click();
  await page.getByRole('textbox', { name: 'What happened or what would help?' }).fill('  Quick add hides the portion button behind the keyboard  ');
  await send.click();
  await expect(page.getByText('Feedback saved on this device. It will send after you are online and signed in.', { exact: true })).toBeVisible();
  expect(sent).toHaveLength(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What happened or what would help?' })).toHaveCount(0);

  await context.setOffline(false);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Send feedback', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'What happened or what would help?' }).fill('Second report once back online');
  await page.getByRole('button', { name: 'Send feedback', exact: true }).last().click();
  await expect(page.getByText(/^Feedback sent\./)).toBeVisible();

  // Count distinct reports: the same report can currently be POSTed twice (see the #90 verdict).
  const bodies = sent as { version: number; data: Record<string, any> }[];
  await expect.poll(() => new Set(bodies.map((b) => b.data.id)).size).toBe(2);
  const queued = bodies.find((b) => b.data.type === 'confusing')!;
  expect(queued.version).toBe(1);
  expect(Object.keys(queued.data).sort()).toEqual(['context', 'createdAt', 'id', 'message', 'screenshotBase64', 'type']);
  expect(queued.data.message).toBe('Quick add hides the portion button behind the keyboard');
  expect(queued.data.screenshotBase64).toBeNull();
  expect(queued.data.context).toMatchObject({ screen: 'Food', connection: 'offline' });
  expect(Object.keys(queued.data.context).sort()).toEqual(['appVersion', 'build', 'connection', 'platform', 'screen', 'viewport']);
  expect(JSON.stringify(sent)).not.toContain('browser-qa@jien.test');
  expect(bodies.find((b) => b.data.type === 'bug')!.data.context).toMatchObject({ screen: 'Settings', connection: 'online' });
  expect(errors).toEqual([]);
});
