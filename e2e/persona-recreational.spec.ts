import { expect, test, type Locator, type Page } from '@playwright/test';
import { collectPageErrors, completeOnboarding, fixJienClock, prepareIsolatedJienContext } from './helpers';

/**
 * Persona 2 (recreational lifter) friction journey from docs/qa/personas.md (issue #27).
 * Runs against the isolated e2e build with the fake Supabase origin from helpers.ts, never against
 * production. Open Food Facts is stubbed: text search finds nothing and one synthetic barcode
 * resolves to a synthetic yogurt cup. The clock is fixed so the week is repeatable:
 * day 1 = Tue 25 Aug 2026 … day 7 = Mon 31 Aug 2026; the run starts on day 5.
 * Taps = clicks plus one tap per field focused plus keyboard submits. Set PERSONA_REPORT=1 to
 * print the measured table.
 */
test.use({ actionTimeout: 10_000 });

type Row = { task: string; taps: number; chars: number; seconds: number; screens: number };

class Meter {
  rows: Row[] = [];
  private taps = 0; private chars = 0; private screens = 0; private started = 0; private lastUrl = '';
  constructor(private page: Page) {}
  start() { this.taps = 0; this.chars = 0; this.screens = 0; this.started = Date.now(); this.lastUrl = this.page.url(); }
  private seen() { const url = this.page.url().split('?')[0]; if (url !== this.lastUrl.split('?')[0]) this.screens += 1; this.lastUrl = this.page.url(); }
  async tap(target: Locator) { await target.click(); this.taps += 1; this.seen(); }
  async type(target: Locator, text: string) { await target.fill(text); this.taps += 1; this.chars += text.length; }
  async submit(target: Locator) { await target.press('Enter'); this.taps += 1; this.seen(); }
  stop(task: string) {
    const row = { task, taps: this.taps, chars: this.chars, seconds: Math.round((Date.now() - this.started) / 100) / 10, screens: this.screens + 1 };
    this.rows.push(row); return row;
  }
}

// Synthetic, rounded portions for test input only; not nutrition advice.
const YOGURT_BARCODE = '9300000000017';
const YOGURT = 'QA Greek yogurt cup';
const NASI_LEMAK = { name: 'Nasi lemak (chicken wing)', kcal: '700', protein: '25' };
const OATS = { name: 'Oats with banana', kcal: '350', protein: '12' };

const visible = (locator: Locator) => locator.filter({ visible: true });
const status = (page: Page, label: string) => visible(page.getByLabel(`Food day status: ${label}`, { exact: true }));

async function openFoodDay(page: Page, daysAgo: number) {
  await page.getByRole('tab', { name: 'Food', exact: true }).click();
  const back = visible(page.getByRole('button', { name: 'Back to today', exact: true }));
  if (await back.count()) await back.click();
  for (let day = 0; day < daysAgo; day += 1) await visible(page.getByRole('button', { name: 'Previous day', exact: true })).click();
}

/** A one-off dish typed in by a hurried user: name, kcal and protein only, not saved. */
async function quickManual(m: Meter, page: Page, food: { name: string; kcal: string; protein: string }, searchFirst: boolean) {
  await m.tap(visible(page.getByRole('button', { name: 'Add food', exact: true })).first());
  if (searchFirst) {
    const search = page.getByLabel('Food search', { exact: true });
    await m.type(search, food.name.split(' (')[0]!.toLowerCase());
    await m.submit(search);
    await expect(page.getByText(/^Create private food for “/).or(page.getByText(/^Found \d+ match/)).first()).toBeVisible();
  }
  await m.type(page.getByRole('textbox', { name: 'Food', exact: true }).first(), food.name);
  await m.type(page.getByLabel('Calories', { exact: true }).first(), food.kcal);
  await m.type(page.getByLabel('Protein (g)', { exact: true }).first(), food.protein);
  await addToDay(m, page);
}

async function addToDay(m: Meter, page: Page) {
  await m.tap(page.getByRole('button', { name: 'Add to day', exact: true }));
  await expect(page.getByRole('heading', { name: 'Food', exact: true }).last()).toBeVisible();
}

/** Repeat a food from history via Quick add: one tap when listed, otherwise type a few letters first. */
async function quickAdd(m: Meter, page: Page, query: string, name: string) {
  const field = visible(page.getByLabel('Quick add', { exact: true }));
  await field.fill('');
  await expect(visible(page.getByText('Recent & frequent for this time of day', { exact: true })).first()).toBeVisible();
  const item = visible(page.getByRole('button', { name: `Add ${name}`, exact: true })).first();
  if (!(await item.count())) {
    await m.type(field, query);
    await expect(field).toHaveValue(query);
    await expect(item).toBeVisible();
  }
  await m.tap(item);
  await expect(page.getByText(/ added\.$/).last()).toBeVisible();
  await expect(field).toHaveValue('');
}

test('persona 2 recreational lifter: patchy food week, a missed session, then coming back', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name === 'edge-desktop', 'Persona runs use phone viewports only.');
  test.setTimeout(300_000);
  const errors = collectPageErrors(page);
  await prepareIsolatedJienContext(context, page);
  await context.route('https://world.openfoodfacts.org/**', (route) => {
    const barcodeHit = route.request().url().includes(`/api/v2/product/${YOGURT_BARCODE}.json`);
    return route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' },
      body: JSON.stringify(barcodeHit
        ? { status: 1, product: { code: YOGURT_BARCODE, product_name: YOGURT, brands: 'QA Dairy', serving_quantity: 1, serving_quantity_unit: 'cup',
          nutriments: { 'energy-kcal_serving': 150, proteins_serving: 15, carbohydrates_serving: 12, fat_serving: 4 } } }
        : { count: 0, products: [], status: 0 }),
    });
  });
  // Start on day 5 (Sat 29 Aug, 12:00 SGT); day 7 is helpers' FIXED_NOW (Mon 31 Aug).
  const DAY = 24 * 60 * 60 * 1000;
  await fixJienClock(page, -2 * DAY);
  await completeOnboarding(page);
  const m = new Meter(page);

  // Day 1 (4 days ago), lunch: packaged food from a barcode (typed, since the harness has no camera).
  await openFoodDay(page, 4);
  m.start();
  await m.tap(visible(page.getByRole('button', { name: 'Add food', exact: true })).first());
  await m.type(page.getByLabel('Barcode number', { exact: true }), YOGURT_BARCODE);
  await m.tap(page.getByRole('button', { name: 'Look up barcode', exact: true }));
  await expect(page.getByRole('textbox', { name: 'Food', exact: true }).first()).toHaveValue(YOGURT);
  await addToDay(m, page);
  m.stop('(e) Packaged lunch from a barcode, first time');

  // Day 1 dinner: a hawker dish, first time. Search finds nothing useful, so type it in.
  m.start();
  await quickManual(m, page, NASI_LEMAK, true);
  m.stop('(a) Hawker dish, first time: nasi lemak, not saved, name + kcal + protein');
  await expect(status(page, 'Partial')).toBeVisible();

  // Day 3 (2 days ago): breakfast only, left Partial.
  await openFoodDay(page, 2);
  m.start();
  await quickManual(m, page, OATS, false);
  m.stop('Simple home breakfast, first time, typed in');
  await expect(status(page, 'Partial')).toBeVisible();

  // Day 4 (yesterday): a full day of repeats, marked complete.
  await openFoodDay(page, 1);
  m.start();
  await quickAdd(m, page, 'oats', OATS.name);
  await quickAdd(m, page, 'yog', YOGURT);
  await quickAdd(m, page, 'nasi', NASI_LEMAK.name);
  await m.tap(visible(page.getByRole('button', { name: 'Mark day complete', exact: true })));
  const fullDay = m.stop('(c) Full food day: 3 items, all repeats, marked complete');
  await expect(status(page, 'Complete')).toBeVisible();
  await expect(visible(page.getByText('1,200', { exact: true }).or(page.getByText('1200', { exact: true }))).first()).toBeVisible();

  // Day 5 (today): plans tomorrow's full-body session from the starter routine, then drops off.
  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  m.start();
  await m.tap(page.getByRole('button', { name: /Plan workout$/ }).first());
  await m.tap(page.getByRole('button', { name: 'Use Full body routine starter', exact: true }));
  await m.tap(page.getByRole('radio', { name: 'Set date and time', exact: true }));
  await m.tap(page.getByRole('button', { name: 'Tomorrow', exact: true }));
  await m.tap(page.getByRole('button', { name: 'Morning · 07:00', exact: true }));
  await m.tap(page.getByRole('button', { name: 'Save workout plan', exact: true }));
  await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeVisible();
  m.stop('Plan tomorrow from the Full body starter');

  // Days 5 and 6 pass with nothing logged. Day 7 (Mon 31 Aug): he comes back.
  await page.clock.setFixedTime(new Date(Date.parse('2026-08-31T04:00:00.000Z')));
  await page.reload();
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Missed session', exact: true })).toBeVisible();
  await expect(visible(page.getByRole('button', { name: 'Start now', exact: true }))).toBeVisible();
  const todayText = await page.locator('body').innerText();
  testInfo.annotations.push({ type: 'return-today-copy', description: todayText.replace(/\s+/g, ' ').slice(0, 1500) });
  expect(todayText).not.toMatch(/streak|you failed|shame/i);

  // Skipped days stay "Not logged", never 0 kcal.
  for (const [daysAgo, label] of [[5, 'Not logged'], [4, 'Partial'], [2, 'Not logged'], [1, 'Not logged']] as const) {
    await openFoodDay(page, daysAgo);
    await expect(status(page, label)).toBeVisible();
  }

  // (b) Repeat meal on return: today's lunch is the nasi lemak again.
  await openFoodDay(page, 0);
  m.start();
  await quickAdd(m, page, 'nasi', NASI_LEMAK.name);
  m.stop('(b) Repeat meal on return: nasi lemak via Quick add');

  // (d) Full body again, straight from the missed-session prompt.
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  m.start();
  await m.tap(visible(page.getByRole('button', { name: 'Start now', exact: true })));
  await expect(page.getByText('Planned workout loaded', { exact: true })).toBeVisible();
  const loads = page.getByRole('textbox', { name: 'Load (kg)', exact: true });
  const reps = page.getByRole('textbox', { name: 'Reps', exact: true });
  const blocks = [['80', ['12', '10', '10']], ['30', ['10', '10', '8']], ['25', ['10', '8', '8']], ['60', ['12', '12', '10']], ['20', ['10', '9', '8']]] as const;
  for (const [index, [load, r]] of blocks.entries()) {
    const first = index * 3;
    await m.type(loads.nth(first), load);
    await m.type(reps.nth(first), r[0]);
    await m.tap(page.getByRole('button', { name: /^Fill 2 blank loads/ }).first());
    await m.type(reps.nth(first + 1), r[1]);
    await m.type(reps.nth(first + 2), r[2]);
    await m.tap(page.getByRole('button', { name: /^Complete sets for / }).first());
  }
  await m.tap(page.getByRole('button', { name: /^(Save completed workout|Complete planned workout)$/ }));
  await expect(page.getByRole('heading', { name: 'Log workout', exact: true })).toHaveCount(0);
  m.stop('(d) Full body from the missed-session prompt: 5 exercises, 15 sets');
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  await expect(visible(page.getByText('No missed sessions', { exact: true }))).toBeVisible();

  if (process.env.PERSONA_REPORT) console.log(JSON.stringify(m.rows, null, 2));
  await testInfo.attach('persona-recreational-measurements.json', { body: JSON.stringify(m.rows, null, 2), contentType: 'application/json' });
  expect(fullDay.taps).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
