import { expect, test, type Page } from '@playwright/test';
import { completeOnboarding, expectNoHorizontalOverflow, prepareIsolatedJienContext } from './helpers';

test.use({ actionTimeout: 10_000 });

function trackMockSync(page: Page) {
  const pending = new Set<object>();
  let lastActivity = Date.now();
  page.on('request', (request) => {
    if (!request.url().startsWith('https://jien-e2e.supabase.co/')) return;
    pending.add(request);
    lastActivity = Date.now();
  });
  const finished = (request: object) => {
    if (pending.delete(request)) lastActivity = Date.now();
  };
  page.on('requestfinished', finished);
  page.on('requestfailed', finished);
  return async () => {
    const requestedAt = Date.now();
    // Playwright's document networkidle event may already have fired before a
    // later background sync starts. Check actual request completion instead.
    await expect.poll(() => pending.size === 0 && Date.now() - Math.max(lastActivity, requestedAt) >= 600,
      { timeout: 10_000 }).toBe(true);
  };
}

test('training target editor supports six priorities, large text and narrow layouts', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'edge-desktop', 'Desktop owns the responsive and enlarged-text matrix.');
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await page.waitForLoadState('networkidle');
  await page.goto('/workouts/programme');
  const chest = page.getByRole('button', { name: 'Add Chest', exact: true });
  await expect(chest).toBeVisible();
  const target = await chest.boundingBox();
  expect(target!.height).toBeGreaterThanOrEqual(44);
  expect(target!.width).toBeGreaterThanOrEqual(44);
  await chest.focus();
  expect((await chest.boundingBox())!.width).toBe(target!.width);
  for (const name of ['Chest', 'Lats', 'Triceps', 'Quadriceps', 'Calves', 'Core']) {
    await page.getByRole('button', { name: `Add ${name}`, exact: true }).click();
    await page.getByLabel(`${name} weekly credits`, { exact: true }).filter({ visible: true }).fill('8');
  }
  await expect(page.getByText('Six priority muscles selected. Remove one to choose another.', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByLabel('Find a priority muscle', { exact: true }).filter({ visible: true })).toHaveCount(0);
  // Browser text enlargement is a layout check, not a native Dynamic Type certification.
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll<HTMLElement>('div, span, input')]
      .filter((element) => element.tagName === 'INPUT' || [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()))
      .map((element) => ({ element, size: parseFloat(getComputedStyle(element).fontSize) }));
    for (const { element, size } of sizes) element.style.fontSize = `${size * 1.5}px`;
  });
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
    await page.getByLabel('Chest weekly credits', { exact: true }).filter({ visible: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`programme-editor-large-text-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'Remove Chest', exact: true }).click();
  await expect(page.getByLabel('Find a priority muscle', { exact: true }).filter({ visible: true })).toBeVisible();
});

test('weekly targets survive reload and guide an editable flexible plan without logging it', async ({ context, page }, testInfo) => {
  const pageErrors: string[] = [];
  const waitForMockSyncIdle = trackMockSync(page);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  // Let mocked background sync settle before replacing the WebKit document.
  await waitForMockSyncIdle();
  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  await page.getByRole('button', { name: 'Set training targets', exact: true }).click();
  await page.getByRole('button', { name: 'Save training targets', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Enter 1–7 sessions');
  await page.getByRole('radio', { name: 'Build muscle', exact: true }).click();
  await page.getByLabel('Sessions per week', { exact: true }).filter({ visible: true }).fill('3');
  await page.getByRole('button', { name: 'Add Chest', exact: true }).click();
  await page.getByLabel('Chest weekly credits', { exact: true }).filter({ visible: true }).fill('8');
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Save training targets', exact: true }).click();
  await expect(page.getByText('Chest: 0 / 8 credits', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Build muscle · 0 of 3 sessions logged', { exact: true }).filter({ visible: true })).toBeVisible();
  // Let mocked background sync settle before replacing the WebKit document.
  await waitForMockSyncIdle();
  await page.reload();
  await expect(page.getByText('Chest: 0 / 8 credits', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByText('Your weekly targets', { exact: true }).filter({ visible: true }).locator('..').screenshot({ path: testInfo.outputPath('weekly-targets.png') });
  await page.getByRole('button', { name: 'Plan from my targets', exact: true }).click();
  await expect(page.getByText('YOUR WEEKLY TARGETS', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: /^Use .* draft$/ }).first().click();
  await page.getByRole('button', { name: 'Save workout plan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeVisible();
  // Let mocked background sync settle before replacing the WebKit document.
  await waitForMockSyncIdle();
  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  await expect(page.getByText('Chest: 0 / 8 credits', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Build muscle · 0 of 3 sessions logged', { exact: true }).filter({ visible: true })).toBeVisible();
  // Let mocked background sync settle before replacing the WebKit document.
  await waitForMockSyncIdle();
  await page.getByRole('button', { name: /Log workout/ }).click();
  await page.getByLabel('Session name').filter({ visible: true }).fill('Programme credit QA');
  await page.getByLabel('Find exercise for exercise 1').filter({ visible: true }).fill('Machine Chest Press');
  await page.getByRole('button', { name: /^Machine Chest Press .*(Choose|Selected)$/ }).click();
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole('textbox', { name: 'Load (kg)', exact: true }).nth(index).fill('20');
    await page.getByRole('textbox', { name: 'Reps', exact: true }).nth(index).fill('10');
  }
  await page.getByRole('radio', { name: 'Failure', exact: true }).nth(0).click();
  await page.getByRole('radio', { name: 'Drop', exact: true }).nth(1).click();
  await page.getByRole('radio', { name: 'Warm-up', exact: true }).nth(2).click();
  await page.getByRole('button', { name: /Complete sets for Machine Chest Press/ }).click();
  await page.getByRole('button', { name: 'Save completed workout', exact: true }).click();
  await expect(page.getByText('To failure · RPE —', { exact: true }).filter({ visible: true })).toBeVisible();
  // Let mocked background sync settle before replacing the WebKit document.
  await waitForMockSyncIdle();
  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  await expect(page.getByText('Chest: 2 / 8 credits', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Build muscle · 1 of 3 sessions logged', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('The remaining priorities were trained within 48 hours. No target-based routine is highlighted.', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: 'Browse workout plans', exact: true }).click();
  await expect(page.getByText('YOUR WEEKLY TARGETS', { exact: true }).filter({ visible: true })).toHaveCount(0);
  // Let mocked background sync settle before replacing the WebKit document.
  await waitForMockSyncIdle();
  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.getByText('Your weekly targets', { exact: true }).filter({ visible: true }).locator('..').screenshot({ path: testInfo.outputPath('weekly-targets-dark.png') });
  await expectNoHorizontalOverflow(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Edit training targets', exact: true }).click();
  await expect(page.getByLabel('Chest weekly credits', { exact: true }).filter({ visible: true })).toHaveValue('8');
  await page.getByLabel('Chest weekly credits', { exact: true }).filter({ visible: true }).fill('9.5');
  await page.getByRole('button', { name: 'Save training targets', exact: true }).click();
  await expect(page.getByText('Chest: 2 / 9.5 credits', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit training targets', exact: true }).click();
  await page.getByRole('button', { name: 'Remove training targets', exact: true }).click();
  await page.getByRole('button', { name: 'Keep targets', exact: true }).click();
  await expect(page.getByLabel('Chest weekly credits', { exact: true }).filter({ visible: true })).toHaveValue('9.5');
  await page.getByRole('button', { name: 'Remove training targets', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm remove targets', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Set training targets', exact: true })).toBeVisible();
  // Let mocked background sync settle before replacing the WebKit document.
  await waitForMockSyncIdle();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Set training targets', exact: true })).toBeVisible();
  await expect(page.getByText('Workout plans', { exact: true }).filter({ visible: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(pageErrors).toEqual([]);
});
