# Persona testing

Three synthetic lifters used for friction runs (issue #27). They are invented test
characters, not real people. Use them only on disposable dummy accounts and delete each
account afterwards through **Settings > Data > Delete account**.

What a run measures, per persona:

- **Taps.** Clicks, plus one tap for each field focused, plus keyboard submits. Scrolling
  is not counted, so screens that need a lot of scrolling are noted separately.
- **Characters typed.**
- **Seconds.** App wait time measured by the script, plus an estimate of human time
  (1.2 s per tap + 0.3 s per typed character + app wait). The estimate is a planning
  aid. It is not a measured human time.
- **Anything that blocked, confused or showed a wrong number.**

Tasks: (a) a typical hawker meal, (b) a repeat meal, (c) a full food day, (d) a workout
session. Food comes first, because food is where JIEN loses to MacroFactor.

## 1. The founder-type lifter (primary)

Intermediate. Comes from MacroFactor for food and a separate logger app for training.

**Training week.** 4–5 sessions on a push/pull split: Mon push, Tue pull, Thu push,
Fri pull, Sat optional push. Machines and cables over free weights. Avoids
wrist-loading free-weight moves. Extra rear-delt and core work. Uses drop sets and slow
eccentrics. Weighs in every morning while cutting slowly.

- Push: Machine Chest Press, Cable Fly, Machine Shoulder Press, Reverse Pec Deck,
  Rope Pressdown (last set + drop set), Cable Crunch.
- Pull: Lat Pulldown, Seated Cable Row, Machine High Row, Rope Face Pull, Cable Curl,
  Cable Crunch.

**Typical food day.** Mostly hawker and kopitiam food, plus a few repeat home meals and
shakes. He tracks pragmatically: a rough portion is fine.

- Breakfast: kaya toast set, 2 soft-boiled eggs, kopi C
- Lunch: chicken rice and kopi C, or mee rebus
- Dinner: a repeat home meal, e.g. a salmon rice bowl
- Snack: whey protein shake

**What "good" feels like.** He logs a meal in seconds, standing at the stall. His usual
foods are one tap away. Kopi C is never typed twice. A forgotten day can be back-filled
in under a minute. Logging a set is: type the load once, type the reps, done.

**7-day journey.**

| Day | Food | Training |
|---|---|---|
| 1 | First use. Search chicken rice, kopi C and mee rebus. Create whatever is missing. Save the shake. | Push day with a drop set on pressdowns |
| 2 | Repeat the shake and yesterday's dinner. | Pull day |
| 3 | Full day of repeat foods: breakfast set, chicken rice, home bowl, shake. Mark the day complete. | Rest |
| 4 | Forgets to log lunch. Back-fills it on day 5. | Push day: repeat last push with the Progress option |
| 5 | Back-fill day 4, then log today. | Pull day |
| 6 | Eats out (mee rebus, kopi C). Logs partially and leaves the day Partial. | Rest |
| 7 | Reviews the week: calories versus target, food days complete versus partial. | Optional push |

## 2. Recreational lifter

**Training week.** 2–3 full-body sessions from a starter routine. Sometimes skips a whole
week. Mixes machines and dumbbells.

**Typical food day.** Logs food only on some days, usually lunch and dinner, using a
mix of packaged foods (barcode) and simple home meals. Rarely weighs anything.

**What "good" feels like.** The app doesn't nag or shame him after a missed week. A
skipped day stays "not logged", not 0 kcal. Starting again takes one tap. The next
workout is obvious.

**7-day journey.**

| Day | Food | Training |
|---|---|---|
| 1 | Logs lunch from a barcode and dinner manually. | Full body A from the starter routine |
| 2 | Logs nothing. | — |
| 3 | Logs breakfast only. Leaves the day Partial. | — |
| 4 | Logs a full day. Marks it complete. | Full body B |
| 5 | Logs nothing. | Misses the planned session. Checks the missed-session prompt. |
| 6 | Logs nothing. | — |
| 7 | Returns. Logs today. Checks that days 2, 5 and 6 aren't counted as 0 kcal. | Full body A again |

## 3. Competitive bodybuilder in prep

**Training week.** 6 days of high volume, e.g. a push/pull/legs routine run twice.
4–6 exercises a session, 3–4 sets each, with occasional drop and failure sets.

**Typical food day.** Logs every day. Weighs food in grams. 5–6 near-identical meals
built from the same ingredients (rice, chicken breast, egg whites, oats, whey,
vegetables). Needs recipes and repeat meals, plus exact macros against targets.

**What "good" feels like.** Gram-level portions that scale exactly. Yesterday's meals
can be copied in one action. Macros are shown to the gram against targets. Training
volume per muscle is visible and trustworthy.

**7-day journey.**

| Day | Food | Training |
|---|---|---|
| 1 | Creates the ingredients and a recipe (once #14 lands). Logs 6 meals in grams. Sets macro targets. | Push A |
| 2 | Copies day 1, then changes 2 portions. | Pull A |
| 3 | Copies again. Adds a cheat item. | Legs A |
| 4 | Logs 6 meals with one portion change. | Push B |
| 5 | Logs 6 meals. | Pull B |
| 6 | Logs 6 meals. | Legs B |
| 7 | Reviews weekly macro adherence and volume per muscle. | Rest |

## How to run

- **Live app** (https://jien-coral.vercel.app). The web app signs in with **Google
  only**. Email sign-up exists only on native builds (Settings > Account). A live run
  therefore needs a dedicated, synthetic QA Google account that Ken sets up. It must
  never be a personal account. Never commit its credentials.
- **Repeatable spec:** `e2e/persona-founder.spec.ts` runs persona 1's food days and push
  day against the isolated e2e build (fake Supabase, Open Food Facts stubbed to "no
  match"). It never touches production. It runs on the Pixel 7 and iPhone 13 projects
  and skips the desktop project. Set `PERSONA_REPORT=1` to print the measured table:

  ```
  PERSONA_REPORT=1 pnpm e2e:web e2e/persona-founder.spec.ts --project=android-chrome
  ```

  The spec assumes the first hawker search finds nothing. When the Singapore starter
  set (#21) lands, update step (a) to tap the result, then compare the numbers (AC6 of
  #27).

## Results

### Persona 1, run 1: 2026-10-22, `main` @ 78e031c, isolated e2e build, Pixel 7 and iPhone 13

The live run was blocked by Google-only sign-in (see "How to run"). The numbers below
come from the same `main` build that Vercel deploys. Both phone projects gave the same
tap counts.

| Task | Taps | Typed chars | App wait | Est. human time |
|---|---|---|---|---|
| (a) Hawker meal, first time: chicken rice + kopi C, both saved for reuse | 17 | 55 | 2.0 s | ~39 s |
| (a) Hawker dish, first time: mee rebus, not saved | 9 | 27 | 1.1 s | ~20 s |
| (b) Repeat meal: saved protein shake from Quick add | 2 | 0 | 0.4 s | ~3 s |
| (b) Repeat meal: yesterday's unsaved mee rebus (via its entry > Log this again today) | 5 | 0 | 0.4 s | ~6 s |
| (c) Full food day: 7 items, all previously saved, then mark complete | 21 | 30 | 4.0 s | ~38 s |
| (d) Push day: 5 machine/cable exercises, 16 sets including 1 drop set | 46 | 57 | 2.9 s | ~75 s |

The friction findings are in the #27 comment.
