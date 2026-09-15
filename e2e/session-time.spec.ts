import { expect, test, type Page } from '@playwright/test';
import { completeOnboarding, expectNoHorizontalOverflow, prepareIsolatedJienContext } from './helpers';

test.use({ actionTimeout: 10_000 });

test('time settings remain usable with enlarged text at narrow and wide widths', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'edge-desktop', 'Desktop owns the enlarged-text layout matrix.');
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  await page.getByRole('button', { name: /Plan workout$/ }).click();
  const edit = page.getByRole('button', { name: 'Edit time settings', exact: true });
  await expect(edit).toBeVisible();
  const box = await edit.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  await edit.focus();
  await page.keyboard.press('Enter');
  const rest = page.getByLabel('Rest between sets (seconds)', { exact: true }).filter({ visible: true });
  await expect(rest).toBeVisible();
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll<HTMLElement>('div, span, input')]
      .filter((element) => element.tagName === 'INPUT' || [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()))
      .map((element) => ({ element, size: parseFloat(getComputedStyle(element).fontSize) }));
    for (const { element, size } of sizes) element.style.fontSize = `${size * 1.5}px`;
  });
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
    await rest.scrollIntoViewIfNeeded();
    await rest.fill('150');
    await expect(rest).toHaveValue('150');
    await page.screenshot({ path: testInfo.outputPath(`time-settings-large-text-${width}.png`) });
  }
});

function trackSync(page: Page) {
  const pending = new Set<object>();
  let last = Date.now();
  page.on('request', (request) => {
    if (request.url().startsWith('https://jien-e2e.supabase.co/')) { pending.add(request); last = Date.now(); }
  });
  const finish = (request: object) => { if (pending.delete(request)) last = Date.now(); };
  page.on('requestfinished', finish); page.on('requestfailed', finish);
  return async () => {
    const start = Date.now();
    await expect.poll(() => pending.size === 0 && Date.now() - Math.max(start, last) > 600).toBe(true);
  };
}

test('time-aware plans stay editable, persist estimates and start without performed sets', async ({ context, page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const idle = trackSync(page);
  const visibleText = (text: string) => page.getByText(text, { exact: true }).filter({ visible: true });
  const field = (label: string) => page.getByLabel(label, { exact: true }).filter({ visible: true });
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  await page.getByRole('button', { name: /Plan workout$/ }).click();
  await page.getByRole('button', { name: '30 min', exact: true }).click();
  await page.getByRole('button', { name: 'Use Push routine starter', exact: true }).click();
  await expect(visibleText('5 selected')).toBeVisible();
  await expect(visibleText('Estimated 45 min · 30 min available')).toBeVisible();
  await page.getByRole('button', { name: 'Edit time settings', exact: true }).click();
  await field('Rest between sets (seconds)').fill('');
  await expect(page.getByRole('button', { name: 'Save workout plan', exact: true })).toBeDisabled();
  await field('Rest between sets (seconds)').fill('180');
  await field('Warm-up minutes').fill('0');
  await field('Seconds per set').fill('60');
  await field('Between exercises (seconds)').fill('60');
  await expect(visibleText('Estimated 49 min · 30 min available')).toBeVisible();
  await expect(visibleText('5 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Use shorter plan', exact: true }).click();
  await expect(visibleText('3 selected')).toBeVisible();
  await expect(visibleText('Estimated 29 min · 30 min available')).toBeVisible();
  await page.getByRole('button', { name: 'Undo shorter plan', exact: true }).click();
  await expect(visibleText('5 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Use shorter plan', exact: true }).click();
  await page.getByRole('button', { name: 'Add planned set for Machine Chest Press', exact: true }).click();
  await expect(visibleText('Estimated 33 min · 30 min available')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo shorter plan', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove last planned set for Machine Chest Press', exact: true }).click();
  await expect(visibleText('Estimated 29 min · 30 min available')).toBeVisible();
  await page.getByRole('button', { name: 'Hide time settings', exact: true }).click();
  await visibleText('Session duration').scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('time-estimate-light.png') });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.screenshot({ path: testInfo.outputPath('time-estimate-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.getByRole('radio', { name: 'No set time', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Save workout plan', exact: true }).click();
  await expect(visibleText('Estimated 29 min · 30 min available')).toBeVisible();
  await idle();
  await page.reload();
  await expect(visibleText('Estimated 29 min · 30 min available')).toBeVisible();
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  await page.getByRole('button', { name: 'Edit time settings', exact: true }).click();
  await expect(field('Rest between sets (seconds)')).toHaveValue('180');
  await expect(field('Warm-up minutes')).toHaveValue('0');
  await page.getByRole('button', { name: 'Update workout plan', exact: true }).click();
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  await expect(visibleText('No completed sets')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo completed set', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Load (kg)', exact: true }).first().fill('20');
  await page.getByRole('textbox', { name: 'Reps', exact: true }).first().fill('10');
  await page.getByRole('button', { name: 'Mark set complete', exact: true }).first().click();
  await idle();
  await page.reload();
  await expect(visibleText('Unfinished workout restored')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo completed set', exact: true })).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'RPE', exact: true }).first()).toHaveValue('');
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
