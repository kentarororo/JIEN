import { expect, test, type Locator, type Page } from '@playwright/test';
import { completeOnboarding, prepareIsolatedJienContext } from './helpers';

/**
 * Persona 1 (founder-type lifter) friction journey from docs/qa/personas.md (issue #27).
 * Runs against the isolated e2e build with the fake Supabase origin from helpers.ts, never
 * against production or any other network service: the fake Supabase origin has no food-search
 * results and Open Food Facts is stubbed to "no match", so hawker dishes are entered manually the
 * first time. Live search coverage is checked by hand on the live app (docs/qa/personas.md).
 * Taps = clicks plus one tap per field focused plus keyboard submits. Set
 * PERSONA_REPORT=1 to print the measured table.
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

type Food = { name: string; kcal: string; protein: string; carbs: string; fat: string };
// Synthetic, rounded portions for test input only; not nutrition advice.
const CHICKEN_RICE: Food = { name: 'Chicken rice (roasted)', kcal: '600', protein: '25', carbs: '75', fat: '20' };
const KOPI_C: Food = { name: 'Kopi C', kcal: '90', protein: '1', carbs: '15', fat: '3' };
const MEE_REBUS: Food = { name: 'Mee rebus', kcal: '560', protein: '20', carbs: '80', fat: '17' };
const SHAKE: Food = { name: 'Whey protein shake', kcal: '120', protein: '24', carbs: '3', fat: '1' };
const KAYA_TOAST: Food = { name: 'Kaya toast set', kcal: '300', protein: '6', carbs: '40', fat: '13' };
const HOME_BOWL: Food = { name: 'Home salmon rice bowl', kcal: '650', protein: '40', carbs: '70', fat: '22' };

const visible = (locator: Locator) => locator.filter({ visible: true });

async function openFoodDay(page: Page, daysAgo: number) {
  await page.getByRole('tab', { name: 'Food', exact: true }).click();
  const back = visible(page.getByRole('button', { name: 'Back to today', exact: true }));
  if (await back.count()) await back.click();
  for (let day = 0; day < daysAgo; day += 1) await visible(page.getByRole('button', { name: 'Previous day', exact: true })).click();
}

/**
 * Fill row `index` of the Add food draft; optionally save it as a private food for reuse.
 * `quick` enters only name, kcal and protein (carbs and fat are optional since #30), which is
 * what a hurried user does for a one-off dish.
 */
async function enterFood(m: Meter, page: Page, index: number, food: Food, saveForReuse: boolean, quick = false) {
  if (index > 0) await m.tap(page.getByRole('button', { name: 'Add a blank food', exact: true }));
  await m.type(page.getByRole('textbox', { name: 'Food', exact: true }).nth(index), food.name);
  const macros = [['Calories', food.kcal], ['Protein (g)', food.protein], ['Carbs (g)', food.carbs], ['Fat (g)', food.fat]] as const;
  for (const [label, value] of quick ? macros.slice(0, 2) : macros) {
    await m.type(page.getByLabel(label, { exact: true }).nth(index), value);
  }
  if (saveForReuse) {
    // Since #30 the reuse controls sit under each row's collapsed More details (one extra tap).
    await m.tap(page.getByRole('button', { name: 'More details', exact: true }).last());
    await m.tap(page.getByRole('button', { name: 'Save as private food', exact: true }).last());
    await expect(page.getByText(new RegExp(`${food.name.replace(/[()]/g, '\\$&')}.*saved|Saved`, 'i')).first()).toBeVisible();
  }
}

async function searchThenManual(m: Meter, page: Page, query: string) {
  await m.tap(visible(page.getByRole('button', { name: 'Add food', exact: true })).first());
  const search = page.getByLabel('Food search', { exact: true });
  await m.type(search, query);
  await m.submit(search);
  await expect(page.getByText(`Create private food for “${query}”`, { exact: true })).toBeVisible();
}

async function addToDay(m: Meter, page: Page) {
  await m.tap(page.getByRole('button', { name: 'Add to day', exact: true }));
  await expect(page.getByRole('heading', { name: 'Food', exact: true }).last()).toBeVisible();
}

async function saveInMyFoods(page: Page, food: Food) {
  await page.getByRole('tab', { name: 'Food', exact: true }).click();
  await visible(page.getByRole('button', { name: 'My foods', exact: true })).click();
  await page.getByRole('button', { name: /^Create (a )?saved food$/ }).first().click();
  await page.getByLabel('Food name', { exact: true }).fill(food.name);
  await page.getByLabel('Serving quantity', { exact: true }).fill('1');
  await page.getByLabel('Serving unit', { exact: true }).fill('serving');
  for (const [label, value] of [['Calories', food.kcal], ['Protein (g)', food.protein], ['Carbs (g)', food.carbs], ['Fat (g)', food.fat]] as const) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByRole('button', { name: 'Save food', exact: true }).click();
  await expect(page.getByText(food.name, { exact: true }).first()).toBeVisible();
}

/** Repeat a saved food from the Food tab's Quick add: type a few letters, tap it, confirm. */
async function quickAdd(m: Meter, page: Page, query: string, name: string, portion?: string) {
  const field = visible(page.getByLabel('Quick add', { exact: true }));
  await expect(field).toHaveValue('');
  await expect(visible(page.getByText('Recent & common', { exact: true })).first()).toBeVisible();
  const item = visible(page.getByRole('button', { name: `Add ${name}`, exact: true })).first();
  // Minimal path: tap it straight from "Recent & common" when it is listed, otherwise type to find it.
  if (!(await item.count())) {
    await m.type(field, query);
    await expect(visible(page.getByText('Saved matches', { exact: true })).first()).toBeVisible();
  }
  await m.tap(item);
  if (portion) await m.type(page.getByLabel('Portion', { exact: true }), portion);
  await m.tap(page.getByRole('dialog').getByRole('button', { name: 'Add to day', exact: true }));
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('persona 1 founder-type lifter: hawker food first, then a push day', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name === 'edge-desktop', 'Persona runs use phone viewports only.');
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepareIsolatedJienContext(context, page);
  // Keep the spec off the public internet: the no-account Open Food Facts fallback answers "no match".
  await context.route('https://world.openfoodfacts.org/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0, products: [] }),
    headers: { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' },
  }));
  await completeOnboarding(page);
  const m = new Meter(page);

  // Day 1 (6 days ago), lunch: first-ever hawker meal. Search finds nothing, so enter it and save both items.
  await openFoodDay(page, 6);
  m.start();
  await searchThenManual(m, page, 'chicken rice');
  await enterFood(m, page, 0, CHICKEN_RICE, true);
  await enterFood(m, page, 1, KOPI_C, true);
  await addToDay(m, page);
  m.stop('(a) Hawker meal, first time: chicken rice + kopi C, saved for reuse');

  // Day 1 dinner: single hawker dish, first time, not saved (what a hurried user does).
  m.start();
  await searchThenManual(m, page, 'mee rebus');
  await enterFood(m, page, 0, MEE_REBUS, false, true);
  await addToDay(m, page);
  const hurriedDish = m.stop('(a) Hawker dish, first time: mee rebus, not saved, name + kcal + protein');
  // #30 AC4/AC5: search, submit, name, kcal, protein, Add to day. With carbs and fat required (run 1) this path was 9 taps.
  expect(hurriedDish.taps).toBe(7);

  // Day 1 snack: protein shake created once and saved.
  m.start();
  await m.tap(visible(page.getByRole('button', { name: 'Add food', exact: true })).first());
  await m.tap(page.getByRole('button', { name: 'Enter food manually', exact: true }));
  await enterFood(m, page, 0, SHAKE, true);
  await addToDay(m, page);
  m.stop('Protein shake, first time, saved');

  // Day 2: repeat a saved food from Quick add.
  await openFoodDay(page, 5);
  m.start();
  await quickAdd(m, page, 'whey', SHAKE.name);
  m.stop('(b) Repeat meal: saved protein shake via Quick add');

  // Day 2: repeat yesterday's unsaved mee rebus. Today's build does not list unsaved foods under
  // Recent & common, so the fastest path is via yesterday's entry. If a later build lists it, use that.
  const recentMee = visible(page.getByRole('button', { name: `Add ${MEE_REBUS.name}`, exact: true }));
  testInfo.annotations.push({ type: 'unsaved-food-in-recents', description: String(await recentMee.count() > 0) });
  if (await recentMee.count()) {
    m.start();
    await quickAdd(m, page, 'mee', MEE_REBUS.name);
  } else {
    m.start();
    await m.tap(visible(page.getByRole('button', { name: 'Previous day', exact: true })));
    await m.tap(visible(page.getByRole('button', { name: /^Edit Mee rebus/ })).first());
    await m.tap(page.getByRole('button', { name: 'Edit nutrition or view original entry', exact: true }));
    await m.tap(visible(page.getByRole('button', { name: 'Log this again today', exact: true })));
    const loggingFor = await page.getByText(/Logging for/).first().innerText();
    // Known friction: the copy targets the real today, not the day being viewed (5 days ago).
    testInfo.annotations.push({ type: 'log-again-target', description: loggingFor });
    await addToDay(m, page);
  }
  m.stop("(b) Repeat meal: yesterday's unsaved mee rebus");

  // Day 3 (4 days ago): a full food day using only foods seen before, the fastest path the app offers.
  // Kaya toast and the home bowl are set up once in My foods; not counted in the full-day row.
  for (const food of [KAYA_TOAST, HOME_BOWL]) await saveInMyFoods(page, food);
  await openFoodDay(page, 4);
  m.start();
  await quickAdd(m, page, 'kaya', KAYA_TOAST.name); // breakfast
  await quickAdd(m, page, 'egg', 'Whole egg', '2');
  await quickAdd(m, page, 'kopi', KOPI_C.name);
  await quickAdd(m, page, 'chicken rice', CHICKEN_RICE.name); // lunch
  await quickAdd(m, page, 'kopi', KOPI_C.name);
  await quickAdd(m, page, 'salmon', HOME_BOWL.name); // dinner, repeat home meal
  await quickAdd(m, page, 'whey', SHAKE.name); // snack
  await m.tap(page.getByRole('button', { name: 'Mark day complete', exact: true }));
  const fullDay = m.stop('(c) Full food day: 7 items, all repeats, marked complete');
  await expect(page.getByLabel('Food day status: Complete', { exact: true })).toBeVisible();
  await expect(page.getByText('1,994', { exact: true }).or(page.getByText('1994', { exact: true })).first()).toBeVisible();

  // Push day on machines and cables, with a drop set on the last pressdown set.
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  m.start();
  await m.tap(page.getByRole('button', { name: /Log workout/ }).first());
  const loads = page.getByRole('textbox', { name: 'Load (kg)', exact: true });
  const reps = page.getByRole('textbox', { name: 'Reps', exact: true });
  const exercises: Array<{ name: string; search?: string; load: string; reps: [string, string, string] }> = [
    { name: 'Machine Chest Press', load: '55', reps: ['10', '9', '8'] },
    { name: 'Cable Fly', search: 'cable fly', load: '15', reps: ['12', '12', '10'] },
    { name: 'Machine Shoulder Press', load: '35', reps: ['10', '9', '8'] },
    { name: 'Reverse Pec Deck', load: '30', reps: ['15', '14', '12'] },
    { name: 'Rope Pressdown', search: 'pressdown', load: '25', reps: ['12', '10', '9'] },
  ];
  for (const [blockIndex, exercise] of exercises.entries()) {
    const offset = await loads.count() - 3;
    if (blockIndex > 0) {
      await m.tap(page.getByRole('button', { name: 'Add another exercise', exact: true }));
    }
    const first = blockIndex === 0 ? 0 : offset + 3;
    if (blockIndex > 0 || exercise.name !== 'Machine Chest Press') {
      if (exercise.search) {
        await m.type(page.getByLabel(`Find exercise for exercise ${blockIndex + 1}`), exercise.search);
        await m.tap(page.getByRole('button', { name: new RegExp(`^${exercise.name} .*Choose$`) }).first());
      } else {
        await m.tap(page.getByRole('button', { name: exercise.name, exact: true }).last());
      }
    }
    await m.type(loads.nth(first), exercise.load);
    await m.type(reps.nth(first), exercise.reps[0]);
    await m.tap(page.getByRole('button', { name: /^Fill 2 blank loads/ }).first());
    await m.type(reps.nth(first + 1), exercise.reps[1]);
    await m.type(reps.nth(first + 2), exercise.reps[2]);
    if (exercise.name === 'Rope Pressdown') {
      await m.tap(page.getByRole('button', { name: 'Add set', exact: true }).last());
      await m.tap(page.getByRole('radio', { name: 'Drop', exact: true }).last());
      await m.type(loads.last(), '15');
      await m.type(reps.last(), '10');
    }
    await m.tap(page.getByRole('button', { name: new RegExp(`Complete sets for ${exercise.name}`) }));
  }
  await m.tap(page.getByRole('button', { name: 'Save completed workout', exact: true }));
  await expect(page.getByRole('heading', { name: 'Log workout', exact: true })).toHaveCount(0);
  m.stop('(d) Push day: 5 machine/cable exercises, 16 sets incl. 1 drop set');

  if (process.env.PERSONA_REPORT) console.log(JSON.stringify(m.rows, null, 2));
  await testInfo.attach('persona-founder-measurements.json', { body: JSON.stringify(m.rows, null, 2), contentType: 'application/json' });
  expect(fullDay.taps).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
