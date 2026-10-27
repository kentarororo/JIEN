import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { completeOnboarding, expectNoHorizontalOverflow, prepareIsolatedJienContext } from './helpers';

// Issue #25: one synthetic day of real use, run on every project every night.
// The user is offline for the whole day's logging, then reconnects and syncs.
test.use({ actionTimeout: 10_000 });
// Playwright WebKit does not route requests from a service-worker-controlled page (see offline-pwa.spec.ts),
// so the mocked cloud would be bypassed. Block the worker there; offline cold start on iPhone is a manual check.
test.use({ serviceWorkers: async ({ browserName }, use) => use(browserName === 'webkit' ? 'block' : 'allow') });

const SESSION = 'Daily driver lift';
const EXERCISES = ['Goblet Squat', 'Machine Chest Press', 'Seated Leg Curl'];

const SUPABASE = 'https://jien-e2e.supabase.co/';

// Watches the mocked cloud. Requests the app starts while the device is offline are expected to fail
// (and WebKit may cancel them or report them as page errors); every request made online must succeed.
function trackSupabase(context: BrowserContext, page: Page) {
  const pending = new Set<object>();
  const startedOffline = new WeakSet<object>();
  const offlineUrls = new Set<string>();
  const writes: string[] = [];
  const failures: string[] = [];
  const pageErrors: string[] = [];
  let offline = false;
  let last = Date.now();
  page.on('request', (request) => {
    if (!request.url().startsWith(SUPABASE)) return;
    pending.add(request);
    last = Date.now();
    if (offline) {
      startedOffline.add(request);
      offlineUrls.add(request.url());
      return;
    }
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/rest/v1/') && ['POST', 'PATCH'].includes(request.method())) writes.push(path.slice('/rest/v1/'.length));
  });
  const settle = (request: object) => { if (pending.delete(request)) last = Date.now(); };
  page.on('requestfinished', settle);
  page.on('requestfailed', (request) => {
    settle(request);
    if (request.url().startsWith(SUPABASE) && !startedOffline.has(request)) {
      failures.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`);
    }
  });
  page.on('response', (response) => {
    if (response.url().startsWith(SUPABASE) && response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on('pageerror', (error) => {
    // Playwright splits WebKit's "Fetch API cannot load https://…" message at "https:", so rejoin it.
    const text = `${error.name}: ${error.message}`;
    const blocked = /^Fetch API cannot load https: ?\/+(\S+) due to access control checks\.$/.exec(text);
    if (blocked && offlineUrls.has(`https://${blocked[1]}`)) return;
    pageErrors.push(text);
  });
  return {
    writes,
    failures,
    pageErrors,
    setOffline: async (value: boolean) => {
      if (value) offline = true;
      await context.setOffline(value);
      if (!value) offline = false;
    },
    idle: async () => {
      const start = Date.now();
      await expect.poll(() => pending.size === 0 && Date.now() - Math.max(start, last) > 600).toBe(true);
    },
  };
}

async function sheetCalories(page: Page) {
  const text = await page.getByText(/^\d[\d,]* kcal$/).last().innerText();
  return Number(text.replace(/[^\d]/g, ''));
}

async function expectDayTotals(page: Page, kcal: number) {
  await page.getByRole('tab', { name: 'Food', exact: true }).click();
  await expect(page.getByText('of 2,020 kcal', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText(kcal.toLocaleString('en-SG'), { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByLabel('Food day status: Complete', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  await expect(page.getByText(`${kcal} / 2020 kcal`, { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(`^${SESSION} .* · 9 sets · 1,800 kg·reps$`) }).filter({ visible: true }).first()).toBeVisible();
}

test('a full offline day of training and food syncs cleanly after reconnecting', async ({ context, page }, testInfo) => {
  const supabase = trackSupabase(context, page);
  await prepareIsolatedJienContext(context, page);
  await completeOnboarding(page);
  await supabase.idle();

  await test.step('go offline', async () => {
    await supabase.setOffline(true);
  });

  await test.step('log a workout with 3 exercises and a rest timer', async () => {
    await page.getByRole('button', { name: /Log workout/ }).first().click();
    await page.getByLabel('Session name').fill(SESSION);
    for (const [index, exercise] of EXERCISES.entries()) {
      if (index > 0) await page.getByRole('button', { name: 'Add another exercise', exact: true }).click();
      await page.getByLabel(`Find exercise for exercise ${index + 1}`).fill(exercise);
      // "Add another exercise" may preselect the next unused exercise, which shows as Selected.
      await page.getByRole('button', { name: new RegExp(`^${exercise} .*(Choose|Selected)$`) }).click();
    }
    const loads = page.getByRole('textbox', { name: 'Load (kg)', exact: true });
    const reps = page.getByRole('textbox', { name: 'Reps', exact: true });
    await expect(loads).toHaveCount(9);
    for (let index = 0; index < 9; index += 1) {
      await loads.nth(index).fill('20');
      await reps.nth(index).fill('10');
    }
    await page.getByRole('button', { name: '1 min', exact: true }).click();
    await page.getByRole('button', { name: 'Mark set complete', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await expect(page.getByText(/^[01]:\d\d$/).first()).toBeVisible();
    for (const exercise of EXERCISES) {
      await page.getByRole('button', { name: new RegExp(`Complete sets for ${exercise}`) }).click();
    }
    await page.getByRole('button', { name: 'Save completed workout', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workout', exact: true })).toBeVisible();
    await expect(page.getByText('1,800', { exact: true }).first()).toBeVisible();
  });

  let breakfastKcal = 0;
  await test.step('log breakfast via quick add', async () => {
    await page.getByRole('tab', { name: 'Food', exact: true }).click();
    await expect(page.getByText('Not logged', { exact: true })).toBeVisible();
    // Since #32 "Add <food>" logs the default portion in one tap; a different portion goes through
    // "Adjust <food> portion", which opens the portion sheet.
    await page.getByRole('button', { name: 'Adjust Banana portion', exact: true }).click();
    await page.getByLabel('Portion', { exact: true }).fill('2');
    breakfastKcal = await sheetCalories(page);
    expect(breakfastKcal).toBeGreaterThan(0);
    await page.getByRole('dialog').getByRole('button', { name: /^Add/ }).first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Banana added.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `Edit Banana, ${breakfastKcal} calories`, exact: true })).toBeVisible();
  });

  let lunchKcal = 0;
  await test.step('log lunch via search', async () => {
    await page.getByLabel('Quick add', { exact: true }).fill('chicken curry');
    await page.getByRole('button', { name: 'Adjust Chicken curry with rice portion', exact: true }).click();
    // A big lunch: six starter servings (the starter serving is 100 g), to clear 800 kcal for the day.
    const portion = page.getByLabel('Portion', { exact: true });
    await portion.fill(String(Number(await portion.inputValue()) * 6));
    lunchKcal = await sheetCalories(page);
    expect(lunchKcal).toBeGreaterThan(0);
    await page.getByRole('dialog').getByRole('button', { name: /^Add/ }).first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Chicken curry with rice added.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `Edit Chicken curry with rice, ${lunchKcal} calories`, exact: true })).toBeVisible();
  });

  const totalKcal = breakfastKcal + lunchKcal;
  await test.step('mark the day Complete', async () => {
    // The day must clear the 800 kcal Complete threshold so no under-target warning is needed.
    expect(totalKcal).toBeGreaterThanOrEqual(800);
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => { dialogs.push(dialog.message()); void dialog.accept(); });
    await page.getByRole('button', { name: 'Mark day complete', exact: true }).click();
    await expect(page.getByLabel('Food day status: Complete', { exact: true })).toBeVisible();
    expect(dialogs).toEqual([]);
    await expectDayTotals(page, totalKcal);
  });

  await test.step('reload while offline: data is still there', async () => {
    const canStartOffline = await page.evaluate(async () => Boolean(await navigator.serviceWorker?.getRegistration()));
    if (canStartOffline) {
      await page.reload();
    } else {
      // Without the offline app shell (#18; blocked on WebKit, see above) a cold reload with no network cannot
      // load the page at all. Prove that, then reload as soon as the network is back. The mocked cloud returns no rows, so
      // everything on screen after the reload can only come from this device's local database.
      testInfo.annotations.push({ type: 'pending', description: 'Offline cold reload needs the service worker, which Playwright WebKit cannot route.' });
      await expect(page.reload()).rejects.toThrow();
      await supabase.setOffline(false);
      await supabase.idle();
      await page.goto('/today');
    }
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await expectDayTotals(page, totalKcal);
  });

  await test.step('reconnect: sync completes with no errors', async () => {
    await supabase.setOffline(false);
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await page.getByRole('button', { name: 'Sync now' }).click();
    // Offline writes may still be queued here (the offline reload path) or already uploaded by background sync.
    await expect(page.getByText(/^(\d+ uploaded · \d+ restored from cloud\.|Cloud sync is current\.)$/)).toBeVisible();
    await expect(page.getByText('No records are waiting for upload.', { exact: true })).toBeVisible();
    await expect(page.getByText('No app recovery errors recorded', { exact: true })).toBeVisible();
    await supabase.idle();
    expect(supabase.failures).toEqual([]);
    expect(supabase.writes.some((table) => /workout/.test(table))).toBe(true);
    expect(supabase.writes.some((table) => /meal|food/.test(table))).toBe(true);
  });

  await test.step('history and Today totals are correct', async () => {
    await page.getByRole('tab', { name: 'Train', exact: true }).click();
    await page.getByRole('button', { name: /History/ }).click();
    await expect(page.getByRole('link', { name: new RegExp(`Open ${SESSION} from`) })).toHaveCount(1);
    await expect(page.getByText('3 exercises · 9 sets · 1,800 kg·reps', { exact: true }).filter({ visible: true })).toHaveCount(1);
    await expectDayTotals(page, totalKcal);
    await expectNoHorizontalOverflow(page);
  });

  expect(supabase.pageErrors).toEqual([]);
});
