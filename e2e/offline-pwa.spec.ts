import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { collectPageErrors, completeOnboarding, prepareIsolatedJienContext } from './helpers';

/** Issue #18: installable, offline-capable web app. Runs against the production e2e build. */
test.use({ actionTimeout: 10_000 });

async function waitForControllingWorker(page: Page) {
  // Resolves once the worker has installed (precached the shell) and is active.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // clients.claim() on activate hands control to the open page. WebKit can miss the claim when a navigation
  // races activation, so give it a moment and reload until a navigation is controlled.
  const controller = () => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
  for (let attempt = 0; attempt < 3 && !await controller(); attempt += 1) {
    await page.waitForTimeout(1_000);
    if (!await controller()) await page.reload();
  }
  await expect.poll(controller).toMatch(/\/sw\.js$/);
}

/**
 * Let the first registration finish before navigating again. Playwright's WebKit stalls a worker install
 * when request routing is on and the page navigates mid-install (it activates fine without the second
 * navigation, and without routing), so wait for the active worker on the first page load.
 */
async function prepareWithWorker(context: BrowserContext, page: Page) {
  await prepareIsolatedJienContext(context, page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
}

const WEBKIT_SKIP = 'Playwright WebKit does not route requests from a service-worker-controlled page, so the mocked Supabase '
  + 'restore fails ("Cloud restore needs attention") before the app opens. Chromium covers this; iPhone offline is a manual check.';

function pngSize(bytes: Buffer) {
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

test('AC1/AC4: production build serves an installable manifest, icons and Home Screen metadata', async ({ context, page }, testInfo) => {
  await prepareWithWorker(context, page);
  await page.goto('/');
  const head = page.locator('head');
  await expect(head.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(head.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png');
  await expect(head.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(head.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'JIEN');
  await expect(head.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#71452F');

  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({ name: 'JIEN', short_name: 'JIEN', start_url: '/', scope: '/', display: 'standalone', theme_color: '#71452F' });
  const icons = manifest.icons as Array<{ src: string; sizes: string; type: string; purpose: string }>;
  expect(icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual(expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']));
  for (const icon of [...icons, { src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }]) {
    const response = await page.request.get(icon.src);
    expect(response.ok(), icon.src).toBe(true);
    expect(response.headers()['content-type']).toBe(icon.type);
    expect(pngSize(await response.body()), icon.src).toBe(icon.sizes);
  }

  await waitForControllingWorker(page);
  if (testInfo.project.name !== 'ios-webkit') {
    // Chromium's own installability check: what Android Chrome uses to offer "Install app".
    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    // Playwright contexts are incognito-like, so Chromium always adds 'in-incognito'; nothing else may appear.
    expect(installabilityErrors.filter((error) => error.errorId !== 'in-incognito')).toEqual([]);
    const { url, errors } = await cdp.send('Page.getAppManifest');
    expect(url).toMatch(/\/manifest\.webmanifest$/);
    expect(errors).toEqual([]);
  }
});

async function logWorkoutAndFood(page: Page) {
  await page.getByRole('button', { name: /Log workout/ }).first().click();
  await page.getByLabel('Session name').fill('Offline PWA strength');
  await page.getByLabel('Find exercise for exercise 1').fill('Goblet Squat');
  await page.getByRole('button', { name: /^Goblet Squat .*Choose$/ }).click();
  const loads = page.getByRole('textbox', { name: 'Load (kg)', exact: true });
  const reps = page.getByRole('textbox', { name: 'Reps', exact: true });
  for (let index = 0; index < await loads.count(); index += 1) {
    await loads.nth(index).fill('20');
    await reps.nth(index).fill('10');
  }
  await page.getByRole('button', { name: /Complete sets for Goblet Squat/ }).click();
  await page.getByRole('button', { name: 'Save completed workout' }).click();
  await expect(page.getByRole('heading', { name: 'Workout', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Food', exact: true }).click();
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  await page.getByRole('textbox', { name: 'Food', exact: true }).fill('Offline PWA kaya toast');
  for (const [name, value] of [['Calories', '420'], ['Protein (g)', '12'], ['Carbs (g)', '50'], ['Fat (g)', '18']] as const) {
    await page.getByRole('textbox', { name, exact: true }).fill(value);
  }
  await page.getByRole('button', { name: 'Add to day' }).click();
  await expect(page.getByRole('button', { name: 'Edit Offline PWA kaya toast, 420 calories', exact: true })).toBeVisible();
}

async function expectLocalRecords(page: Page) {
  await page.getByRole('tab', { name: 'Food', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Offline PWA kaya toast, 420 calories', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Train' }).click();
  await page.getByRole('button', { name: /History/ }).click();
  await expect(page.getByRole('link', { name: /Open Offline PWA strength from/ })).toBeVisible();
}

async function cachedRequestUrls(page: Page) {
  return page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(`${name} ${request.url}`);
    }
    return urls;
  });
}

test('AC2/AC4: offline reload and offline cold start open the app with local workout and food records, no cached API', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name === 'ios-webkit', WEBKIT_SKIP);
  const errors = collectPageErrors(page);
  await prepareWithWorker(context, page);
  await completeOnboarding(page);
  await waitForControllingWorker(page);
  await logWorkoutAndFood(page);

  const cached = await cachedRequestUrls(page);
  expect(cached.length).toBeGreaterThan(10);
  expect(cached.every((entry) => /^jien-shell-[0-9a-f]{16} /.test(entry))).toBe(true);
  const origin = new URL(page.url()).origin;
  for (const entry of cached) {
    const url = new URL(entry.split(' ')[1]!);
    expect(url.origin, entry).toBe(origin);
    expect(url.pathname, entry).not.toMatch(/^\/(api|auth|rest|functions)\//);
  }
  expect(cached.some((entry) => entry.endsWith('/index.html'))).toBe(true);

  // Offline reload of the Food tab (a deep link, served from the cached shell).
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Food', exact: true, level: 1 })).toBeVisible();
  await expectLocalRecords(page);

  // Offline cold start: close every tab, then open the start URL with no network.
  await page.close();
  const cold = await context.newPage();
  const coldErrors = collectPageErrors(cold);
  await cold.goto('/');
  await expect(cold.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expectLocalRecords(cold);
  await context.setOffline(false);
  expect([...errors, ...coldErrors]).toEqual([]);
});

test('AC5: OAuth callback navigations bypass the service worker while app navigations go through it', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name === 'ios-webkit', WEBKIT_SKIP);
  await prepareWithWorker(context, page);
  await completeOnboarding(page);
  await waitForControllingWorker(page);
  const appNavigation = await page.goto('/');
  expect(appNavigation?.fromServiceWorker(), 'app shell navigation is handled by the worker').toBe(true);
  const callback = await page.goto('/auth/callback?error=access_denied&error_description=QA');
  expect(callback?.ok()).toBe(true);
  expect(callback?.fromServiceWorker(), 'the Google redirect lands on the network, never a cached shell').toBe(false);
  // Offline, the callback is not served from the cache (no stale shell can swallow the auth code).
  await context.setOffline(true);
  await expect(page.goto('/auth/callback?code=qa-offline')).rejects.toThrow();
  await context.setOffline(false);
});

function serviceWorkerPath(testInfo: { project: { testDir: string } }) {
  return path.resolve(testInfo.project.testDir, '..', 'dist', 'sw.js');
}

async function freshContextPage(context: BrowserContext) {
  return context.pages()[0] ?? await context.newPage();
}

test('AC3: a new deploy shows Update ready and Refresh activates it', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name === 'ios-webkit', WEBKIT_SKIP);
  const errors = collectPageErrors(page);
  await prepareWithWorker(context, page);
  await completeOnboarding(page);
  await waitForControllingWorker(page);
  await expect(page.getByText('Update ready', { exact: true })).toHaveCount(0);
  const firstWorker = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/'))?.active?.scriptURL);
  expect(firstWorker).toMatch(/\/sw\.js$/);

  const swPath = serviceWorkerPath(testInfo);
  const original = readFileSync(swPath, 'utf8');
  try {
    // Simulate the next deploy: a new content-versioned cache name in sw.js.
    const deployed = original.replace(/jien-shell-[0-9a-f]{16}/, 'jien-shell-0123456789abcdef');
    expect(deployed).not.toBe(original);
    writeFileSync(swPath, deployed);
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration('/'))?.update(); });
    await expect(page.getByText('Update ready', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Refresh to use the latest app version.', { exact: true })).toBeVisible();
    const reloaded = page.waitForEvent('load');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await reloaded;
    const current = await freshContextPage(context);
    await expect(current.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await expect(current.getByText('Update ready', { exact: true })).toHaveCount(0);
    await expect.poll(() => current.evaluate(async () => (await caches.keys()).join(','))).toBe('jien-shell-0123456789abcdef');
  } finally {
    writeFileSync(swPath, original);
  }
  expect(errors).toEqual([]);
});
