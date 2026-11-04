import { expect, test, type Locator, type Page } from '@playwright/test';
import { collectPageErrors, completeOnboarding, fixJienClock, prepareIsolatedJienContext } from './helpers';

/**
 * Persona 3 (competitive bodybuilder in prep) friction journey from docs/qa/personas.md (issue #27).
 * Runs against the isolated e2e build with the fake Supabase origin from helpers.ts, never against
 * production. Open Food Facts is stubbed to "no match", so gram foods come from the built-in
 * starter set (per-100 g references) and the rest are typed in. Recipes (#14) are not on `main`
 * yet, so day 1 builds meals from single ingredients. The clock is fixed: day 1 = Sat 29 Aug 2026,
 * day 3 = Mon 31 Aug 2026 (helpers' FIXED_NOW). Set PERSONA_REPORT=1 to print the measured table.
 */
test.use({ actionTimeout: 10_000 });

type Row = { task: string; taps: number; chars: number; seconds: number };

class Meter {
  rows: Row[] = [];
  notes: string[] = [];
  private taps = 0; private chars = 0; private started = 0;
  constructor(readonly page: Page) {}
  start() { this.taps = 0; this.chars = 0; this.started = Date.now(); }
  async tap(target: Locator) { await target.click(); this.taps += 1; }
  async type(target: Locator, text: string) { await target.fill(text); this.taps += 1; this.chars += text.length; }
  async submit(target: Locator) { await target.press('Enter'); this.taps += 1; }
  stop(task: string) {
    const row = { task, taps: this.taps, chars: this.chars, seconds: Math.round((Date.now() - this.started) / 100) / 10 };
    this.rows.push(row); return row;
  }
}

const visible = (locator: Locator) => locator.filter({ visible: true });
const status = (page: Page, label: string) => visible(page.getByLabel(`Food day status: ${label}`, { exact: true }));

async function openFoodDay(page: Page, daysAgo: number) {
  await page.getByRole('tab', { name: 'Food', exact: true }).click();
  const back = visible(page.getByRole('button', { name: 'Back to today', exact: true }));
  if (await back.count()) await back.click();
  for (let day = 0; day < daysAgo; day += 1) await visible(page.getByRole('button', { name: 'Previous day', exact: true })).click();
}

type Gram = { search: string; name: string; grams: string };
type Typed = { name: string; kcal: string; protein: string; carbs: string; fat: string; save: boolean };
type Part = Gram | Typed;

/** One meal through Add food: starter foods found by search and set in grams, typed foods entered in full. */
async function logMeal(m: Meter, page: Page, parts: Part[]) {
  await m.tap(visible(page.getByRole('button', { name: 'Add food', exact: true })).first());
  for (const [index, part] of parts.entries()) {
    if ('grams' in part) {
      const search = page.getByLabel('Food search', { exact: true });
      await m.type(search, part.search);
      await m.submit(search);
      await m.tap(visible(page.getByRole('button', { name: new RegExp(`^${part.name.replace(/[,()]/g, '.')} \\d`) })).first());
      await expect(page.getByRole('textbox', { name: 'Food', exact: true }).nth(index)).toHaveValue(part.name);
      await m.type(page.getByLabel('Quantity', { exact: true }).nth(index), part.grams);
    } else {
      if (index > 0) await m.tap(page.getByRole('button', { name: 'Add a blank food', exact: true }));
      else await m.tap(page.getByRole('button', { name: 'Enter food manually', exact: true }));
      await m.type(page.getByRole('textbox', { name: 'Food', exact: true }).nth(index), part.name);
      for (const [label, value] of [['Calories', part.kcal], ['Protein (g)', part.protein], ['Carbs (g)', part.carbs], ['Fat (g)', part.fat]] as const) {
        await m.type(page.getByLabel(label, { exact: true }).nth(index), value);
      }
      if (part.save) await m.tap(page.getByRole('button', { name: 'Save as private food', exact: true }).nth(index));
    }
  }
  await m.tap(page.getByRole('button', { name: 'Add to day', exact: true }));
  await expect(page.getByRole('heading', { name: 'Food', exact: true }).last()).toBeVisible();
}

// Synthetic, rounded portions for test input only; not nutrition advice.
const chicken = (grams: string): Gram => ({ search: 'chicken', name: 'Chicken breast, cooked', grams });
const rice = (grams: string): Gram => ({ search: 'rice', name: 'White rice, cooked', grams });
const oats = (grams: string): Gram => ({ search: 'oats', name: 'Rolled oats, dry', grams });
const broccoli = (grams: string): Gram => ({ search: 'broccoli', name: 'Broccoli, cooked', grams });
const WHEY: Typed = { name: 'Whey isolate (1 scoop, 30 g)', kcal: '110', protein: '25', carbs: '1', fat: '0', save: true };
const EGG_WHITES: Typed = { name: 'Egg whites (200 g)', kcal: '104', protein: '22', carbs: '1', fat: '0', save: true };

test('persona 3 bodybuilder in prep: six gram-weighed meals, copy days, then review', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name === 'edge-desktop', 'Persona runs use phone viewports only.');
  test.setTimeout(420_000);
  const errors = collectPageErrors(page);
  await prepareIsolatedJienContext(context, page);
  await context.route('https://world.openfoodfacts.org/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0, products: [], status: 0 }),
    headers: { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' },
  }));
  const DAY = 24 * 60 * 60 * 1000;
  await fixJienClock(page, -2 * DAY);
  await completeOnboarding(page);
  const m = new Meter(page);

  // Day 1: set exact macro targets first, from the Food tab.
  await openFoodDay(page, 0);
  m.start();
  await m.tap(visible(page.getByRole('button', { name: /^\W*Nutrition details$/ })).first());
  await m.tap(visible(page.getByRole('button', { name: /^(Set|Edit) macro targets$/ })).first());
  for (const [label, value] of [['Daily calories', '2600'], ['Protein (g)', '240'], ['Carbs (g)', '300'], ['Fat (g)', '45']] as const) {
    await m.type(visible(page.getByLabel(label, { exact: true })).first(), value);
  }
  await m.tap(visible(page.getByRole('button', { name: 'Save targets', exact: true })));
  await expect(visible(page.getByRole('button', { name: 'Save targets', exact: true }))).toHaveCount(0);
  m.stop('Day 1: set calorie and macro targets');
  await openFoodDay(page, 0);
  // Day 1: six meals, every portion weighed.
  const meals: [string, Part[]][] = [
    ['Meal 1: oats 80 g + whey (first time, whey typed and saved)', [oats('80'), WHEY]],
    ['Meal 2: chicken 150 g + rice 200 g + broccoli 100 g', [chicken('150'), rice('200'), broccoli('100')]],
    ['Meal 4: egg whites (first time, typed and saved) + rice 150 g', [EGG_WHITES, rice('150')]],
    ['Meal 5: chicken 200 g + rice 150 g + broccoli 150 g', [chicken('200'), rice('150'), broccoli('150')]],
    ['Meal 6: oats 40 g + saved whey found by search', [oats('40'), { search: 'whey', name: WHEY.name, grams: '1' }]],
  ];
  const dayStart = m.rows.length;
  // Real meal times on day 1 (SGT): 07:00, 10:00, 13:00 (meal 3), 16:00, 19:00, 22:00.
  const mealHoursUtc = ['2026-08-28T23:00', '2026-08-29T02:00', '2026-08-29T08:00', '2026-08-29T11:00', '2026-08-29T14:00'];
  for (const [index, [task, parts]] of meals.entries()) {
    await page.clock.setFixedTime(new Date(`${mealHoursUtc[index]}:00.000Z`));
    m.start(); await logMeal(m, page, parts); m.stop(`(c) Day 1 ${task}`);
    if (index === 1) {
      // Meal 3 (13:00) is meal 2 again: one tap on "Copy previous meal".
      await page.clock.setFixedTime(new Date('2026-08-29T05:00:00.000Z'));
      m.start();
      await m.tap(visible(page.getByRole('button', { name: 'Copy previous meal', exact: true })));
      await expect(visible(page.getByRole('button', { name: /^Edit Chicken breast, cooked, 248 calories$/ }))).toHaveCount(2);
      m.stop('(b) Day 1 Meal 3: same as meal 2, via Copy previous meal');
    }
  }
  const day1 = m.rows.slice(dayStart).reduce((sum, row) => ({ taps: sum.taps + row.taps, chars: sum.chars + row.chars, seconds: sum.seconds + row.seconds }), { taps: 0, chars: 0, seconds: 0 });
  m.rows.push({ task: '(c) Day 1 total: 6 meals, 15 items', ...day1, seconds: Math.round(day1.seconds * 10) / 10 });
  await expect(status(page, 'Partial')).toBeVisible();
  const day1Text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  m.notes.push(`day1 food tab: ${day1Text.slice(0, 900)}`);
  await testInfo.attach('day1-food.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  // Day 2: copy day 1 in one action, then change two portions.
  await page.clock.setFixedTime(new Date(Date.parse('2026-08-30T04:00:00.000Z')));
  await page.reload();
  await openFoodDay(page, 0);
  m.start();
  await m.tap(visible(page.getByRole('button', { name: 'Copy yesterday', exact: true })));
  await expect(visible(page.getByRole('button', { name: /^Edit Chicken breast, cooked/ }))).toHaveCount(3);
  m.stop('(b) Day 2: copy day 1');
  m.start();
  for (const [name, grams] of [['Chicken breast, cooked', '180'], ['White rice, cooked', '250']] as const) {
    await m.tap(visible(page.getByRole('button', { name: new RegExp(`^Edit ${name.replace(/[,()]/g, '.')}`) })).first());
    const portion = page.getByLabel('Portion', { exact: true });
    m.notes.push(`edit dialog portion for ${name}: "${await portion.inputValue()}"`);
    await m.type(portion, grams);
    await m.tap(page.getByRole('button', { name: 'Save portion', exact: true }));
    await expect(page.getByLabel('Portion', { exact: true })).toHaveCount(0);
  }
  await page.waitForTimeout(800);
  m.stop('Day 2: change two portions (first chicken row 200 → 180 g, first rice row 150 → 250 g)');
  await page.reload(); await openFoodDay(page, 0); await expect(status(page, 'Partial')).toBeVisible();
  m.notes.push(`day2 rows: ${JSON.stringify(await visible(page.getByRole('button', { name: /^Edit / })).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))))}`);

  // Day 3: copy again and add a cheat item.
  await page.clock.setFixedTime(new Date(Date.parse('2026-08-31T04:00:00.000Z')));
  await page.reload();
  await openFoodDay(page, 0);
  m.start();
  await m.tap(visible(page.getByRole('button', { name: 'Copy yesterday', exact: true })));
  await logMeal(m, page, [{ name: 'Kaya toast set', kcal: '420', protein: '14', carbs: '48', fat: '19', save: false }]);
  m.stop('(b) Day 3: copy day 2 + one cheat item typed in');
  await expect(status(page, 'Partial')).toBeVisible();
  await visible(page.getByRole('button', { name: /^\W*Nutrition details$/ })).first().click();
  m.notes.push(`day3 macros: ${(await page.locator('body').innerText()).replace(/\s+/g, ' ').match(/CALORIES.{0,400}/)?.[0]}`);
  const day3Text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  m.notes.push(`day3 food tab: ${day3Text.slice(0, 1200)}`);
  await testInfo.attach('day3-food.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await expect(status(page, 'Partial')).toBeVisible();

  if (process.env.PERSONA_REPORT) console.log(JSON.stringify({ rows: m.rows, notes: m.notes }, null, 2));
  await testInfo.attach('persona-bodybuilder-measurements.json', { body: JSON.stringify({ rows: m.rows, notes: m.notes }, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});
