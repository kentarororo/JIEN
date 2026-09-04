import { expect, type BrowserContext, type Page } from '@playwright/test';

export const QA_USER_ID = '90000000-0000-4000-8000-000000000001';
const SUPABASE_ORIGIN = 'https://jien-e2e.supabase.co';
const AUTH_STORAGE_KEY = 'sb-jien-e2e-auth-token';
const FIXED_NOW = new Date('2026-08-31T04:00:00.000Z');

function unsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer
    .from(JSON.stringify(value))
    .toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.e2e`;
}

export function qaSession() {
  const expiresAt = Math.floor(FIXED_NOW.getTime() / 1000) + 86_400;
  return {
    access_token: unsignedJwt({
      aud: 'authenticated',
      email: 'browser-qa@jien.test',
      exp: expiresAt,
      role: 'authenticated',
      sub: QA_USER_ID,
    }),
    expires_at: expiresAt,
    expires_in: 86_400,
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
        headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: 'application/json',
        body: JSON.stringify(session),
      });
      return;
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Range': '0-0/0', 'Access-Control-Allow-Origin': '*' },
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

export async function fixJienClock(page: Page, offsetMs = 0) {
  await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + offsetMs));
}

export async function completeOnboarding(page: Page) {
  await page.goto('/');
  try {
    await expect(page.getByRole('heading', { name: 'What are you working toward?' })).toBeVisible();
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
