import { expect, type BrowserContext, type Page } from '@playwright/test';

export const QA_USER_ID = '90000000-0000-4000-8000-000000000001';
const SUPABASE_ORIGIN = 'https://jien-e2e.supabase.co';
const AUTH_STORAGE_KEY = 'sb-jien-e2e-auth-token';
const FIXED_NOW = new Date('2026-08-31T04:00:00.000Z');
const FIXTURE_SESSION_EXPIRES_AT = Math.floor(new Date('2036-08-31T04:00:00.000Z').getTime() / 1000);

function unsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer
    .from(JSON.stringify(value))
    .toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.e2e`;
}

export function qaSession() {
  const expiresAt = FIXTURE_SESSION_EXPIRES_AT;
  return {
    access_token: unsignedJwt({
      aud: 'authenticated',
      email: 'browser-qa@jien.test',
      exp: expiresAt,
      role: 'authenticated',
      sub: QA_USER_ID,
    }),
    expires_at: expiresAt,
    expires_in: expiresAt - Math.floor(FIXED_NOW.getTime() / 1000),
    refresh_token: 'jien-e2e-refresh-token',
    token_type: 'bearer',
    user: {
      id: QA_USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'browser-qa@jien.test',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: FIXED_NOW.toISOString(),
    },
  };
}

export async function prepareIsolatedJienContext(context: BrowserContext, page: Page) {
  const session = qaSession();
  await context.route(`${SUPABASE_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith('/auth/v1/token')) {
      await route.fulfill({
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        },
        contentType: 'application/json',
        body: JSON.stringify(session),
      });
      return;
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Range': '0-0/0',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, apikey, content-type, accept-profile, content-profile, prefer, range, x-client-info, x-supabase-api-version',
          'Access-Control-Allow-Methods': 'DELETE, GET, HEAD, OPTIONS, PATCH, POST',
        },
        contentType: 'application/json',
        body: '[]',
      });
      return;
    }
    if (url.pathname === '/functions/v1/delete-account') {
      if (request.method() === 'OPTIONS') {
        await route.fulfill({
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-request-id',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
          },
          body: 'ok',
        });
        return;
      }
      const requestBody = request.postDataJSON() as { version?: number; data?: { confirmation?: string } } | null;
      const confirmed = requestBody?.version === 1 && requestBody.data?.confirmation === 'DELETE';
      await route.fulfill({
        status: confirmed ? 200 : 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: 'application/json',
        body: JSON.stringify(confirmed
          ? { data: { deleted: true }, requestId: 'e2e-account-deletion' }
          : { error: { code: 'CONFIRMATION_REQUIRED', message: 'Confirmation required.', retryable: false }, requestId: 'e2e-account-deletion' }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'E2E route not mocked' }) });
  });

  await page.goto('/');
  await page.evaluate(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: AUTH_STORAGE_KEY, value: session });
}

// WebKit reports a fetch that is cut off mid-flight (context.setOffline(), a reload or
// a navigation) as a page error: "Fetch API cannot load <url> due to access control
// checks." The app handles the failure and no error or unhandledrejection event
// reaches the page. Ignore only that message, and only for the fake Supabase origin (#35).
const WEBKIT_CANCELLED_FETCH = new RegExp(`^Fetch API cannot load ${SUPABASE_ORIGIN.replaceAll('.', '\\.')}/\\S* due to access control checks\\.$`);

export function isWebKitCancelledFetchNoise(error: Error): boolean {
  return WEBKIT_CANCELLED_FETCH.test((error.stack ?? '').split('\n')[0] ?? '');
}

export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    if (!isWebKitCancelledFetchNoise(error)) errors.push(error.message);
  });
  return errors;
}

export async function fixJienClock(page: Page, offsetMs = 0) {
  await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + offsetMs));
}

async function clearStuckWebSqliteState(page: Page) {
  // Best-effort reset for ios-webkit stuck on Cloud restore (#50): drop JIEN IDB DBs,
  // unregister service workers, and drop held Web Locks by navigating away briefly.
  await page.evaluate(async () => {
    try {
      if (typeof indexedDB.databases === 'function') {
        const dbs = await indexedDB.databases();
        await Promise.all(
          dbs
            .filter((db) => (db.name ?? '').includes('jien'))
            .map((db) => new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(db.name!);
              req.onsuccess = req.onerror = req.onblocked = () => resolve();
            })),
        );
      }
    } catch { /* ignore */ }
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
      }
    } catch { /* ignore */ }
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
      }
    } catch { /* ignore */ }
  }).catch(() => undefined);
}

export async function completeOnboarding(page: Page) {
  await page.goto('/');
  // ios-webkit sometimes lands on "Cloud restore needs attention" (#50) when a prior
  // worker left a SQLite lock, IndexedDB is sticky across workers, or the fake Supabase
  // route missed the first fetch. Retry harder (Try again → wait → clear IDB/SW → reload)
  // so the rest of the suite can proceed; the root cause stays on #50.
  const restore = page.getByRole('heading', { name: 'Cloud restore needs attention', exact: true });
  const onboarding = page.getByRole('heading', { name: 'What are you working toward?' });
  const today = page.getByRole('heading', { name: 'Today', exact: true });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await onboarding.isVisible().catch(() => false)) break;
    if (await today.isVisible().catch(() => false)) break;
    if (!(await restore.isVisible().catch(() => false))) {
      // Still booting — give hydration a moment before the next check.
      await page.waitForTimeout(800);
      if (await onboarding.isVisible().catch(() => false) || await today.isVisible().catch(() => false)) break;
      if (!(await restore.isVisible().catch(() => false))) break;
    }
    const tryAgain = page.getByRole('button', { name: 'Try again', exact: true });
    if (await tryAgain.isVisible().catch(() => false)) {
      await tryAgain.click();
      await page.waitForTimeout(1_500);
    }
    if (await onboarding.isVisible().catch(() => false) || await today.isVisible().catch(() => false)) break;
    if (attempt >= 1) await clearStuckWebSqliteState(page);
    await page.goto(`/?e2e_restore=${attempt}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1_200);
  }
  // Already past onboarding (rare after a sticky restore) — treat as done.
  if (await today.isVisible().catch(() => false) && !(await onboarding.isVisible().catch(() => false))) {
    return;
  }
  try {
    await expect(onboarding).toBeVisible({ timeout: 15_000 });
  } catch (error) {
    const startupState = await page.evaluate(async () => ({
      bodyText: document.body.innerText.slice(0, 500),
      broadcastChannel: typeof BroadcastChannel,
      crossOriginIsolated: globalThis.crossOriginIsolated,
      databases: typeof indexedDB.databases === 'function' ? await indexedDB.databases() : 'unsupported',
      indexedDb: typeof indexedDB,
      innerHtml: document.body.innerHTML.slice(0, 1_000),
      innerHtmlLength: document.body.innerHTML.length,
      locks: typeof navigator.locks?.query === 'function' ? await navigator.locks.query() : 'unsupported',
      readyState: document.readyState,
      resources: performance.getEntriesByType('resource').slice(-10).map((entry) => entry.name),
      url: location.href,
      webLocks: typeof navigator.locks,
      webAssembly: typeof WebAssembly,
    }));
    console.error(`Onboarding startup state: ${JSON.stringify(startupState)}`);
    throw error;
  }
  await page.getByRole('radio', { name: /Change my body composition/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /Consistent/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Height (cm)').fill('175');
  await page.getByLabel('Weight (kg)').fill('72');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: 'Machines' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /Flexible and varied/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /Kilograms/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /Keep AI context off/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}

export async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}
