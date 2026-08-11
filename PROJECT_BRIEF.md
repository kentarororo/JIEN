# Project brief — holistic wellness AI app

## One-line vision
A single AI-driven interface that unifies lift tracking, diet tracking, and holistic
wellness input (feeling, injury, sleep, health-app data) into one adaptive system —
instead of three apps that never talk to each other.

## The gap this fills
The standard fitness stack today is a nutrition app, a recovery tracker, and a workout
logger, each seeing roughly a third of the picture and never sharing context. A
workout logger doesn't know sleep was bad; a nutrition app doesn't know today was a
90-minute leg day. The person is left to synthesize all of it manually. No major app
in the category (Hevy, Strong, MyFitnessPal, Cronometer, MacroFactor) has closed this
gap yet — that's the wedge.

## Who it's for
v1 user is the founder himself — a Singapore-based lifter who trains machine/cable-
based (wrist-injury-aware), wants visible long-term composition change without
chasing PRs, and tracks pragmatically rather than on a rigid meal plan. Expand from
there once the core loop is genuinely good.

## Core features

### 1. Lift tracking and planning
- Log sets: exercise, weight, reps, RPE (optional)
- Planning covers all body parts and goals, structured around volume-based
  progression, not 1RM
- Deterministic progression engine (see below) runs fully offline
- Rear delts and core are first-class, not afterthoughts

### 2. Diet and macro tracking
- Manual logging, macro counters, based on adaptive principles — adjust targets from
  actual trend data over time, not just a static formula, closer to how MacroFactor
  works than a fixed Mifflin-St Jeor calculator
- AI food photo ID: photo + typed context → Claude vision call → structured estimate
  (items, portions, calories, macros, confidence flag). Good enough for real-world
  estimation; not a lab-grade nutrition database on day one.

### 3. Wellness AI hub
- Free-form input: feeling, injury, manual exercise entry, sleep, health-app/watch data
- Reads recent structured data (last 7–30 days of lifts, macros, sleep) straight from
  Supabase into the prompt context — no vector DB needed at this scale
- Explains and adapts pacing; does not override the deterministic progression numbers

### 4. Notifications (core from phase 1)
- Contextual and opt-in only — e.g. "no second meal logged and it's 8pm" only if
  that's a real gap, never a blanket daily ping
- Design test: every notification must be something the person would choose to
  receive if asked directly, not a generic retention mechanic

### 5. Export and backup
- Underlying artifact: structured CSV/JSON generated client-side from local + synced
  data — ships in phase 1
- Delivery (phase 3+): sync to a real Google Sheet in the user's own Drive (fixed
  template — Workouts tab, Nutrition tab) via the Sheets/Drive API on the narrow
  `drive.file` scope
- Note: Google's Drive API terms restrict using Drive as generic backend backup for
  app content without special approval. This stays clean because it's a genuine
  user-owned spreadsheet the person can open and edit themselves, not an opaque
  backup blob. Build and frame it as "export to Sheets," not "backup to Drive."

## Progression algorithm (deterministic core)
- Track total volume (sets × reps × load) per movement pattern / muscle group, per week
- Progress via double progression: fixed rep range per exercise (e.g. 8–12); once
  every set hits the top of the range, add load; until then, add reps
- Track weekly volume trend per muscle group; flag stagnation or unplanned drops as a
  possible deload signal
- The AI layer can adjust pacing and exercise selection based on subjective input
  (soreness, joint flags, sleep, motivation) — it explains changes in plain language,
  it does not silently override the volume math
- No 1RM testing, no max-effort flows

## Offline architecture
- Local SQLite is the source of truth on-device for all manual logging (lifts, meals,
  wellness check-ins) — writes are instant, no network required
- A background sync queue pushes to Supabase when connectivity returns; last-write-
  wins conflict resolution is sufficient at single-user scale
- The progression engine is pure client-side math over local data — works fully
  offline
- AI features (chat, food photo ID, adaptive explanations) require the Claude API and
  cannot run offline:
  - Chat: cache the last several AI responses so prior guidance is readable offline,
    even if new questions can't be asked
  - Food photos: can be captured offline, queued locally, and auto-processed the
    moment connectivity returns — never blocks the logging flow
  - UI must show an explicit "AI needs a connection" state — never a silent failure
    or a spinner that never resolves

## Data model (starting tables)
`users`, `workouts`, `exercises`, `sets`, `meals`, `food_items`, `wellness_logs`,
`ai_conversations`, `notification_preferences` — full schema to be proposed by Claude
Code against this brief, documented in /docs/schema.md, Postgres + Row Level Security
throughout.

## Onboarding (treat as core product, not a form)
Capture on day one: training experience level, available equipment, injury/joint
flags, current goals (composition, strength, or both), typical diet pattern, and
consent for AI use of this data. This is what makes "auto-tailoring" actually work —
a thin onboarding produces a generic app.

## Tech stack
Expo (React Native + Router) · Supabase (Postgres/Auth/Storage/Edge Functions) ·
Claude API via Edge Functions · RevenueCat · EAS Build · react-native-health /
react-native-health-connect (phase 3+)

## Roadmap
| Phase | Focus | Time |
|---|---|---|
| 0 — Foundation | Repo, CLAUDE.md, design system, schema, auth | 1–2 weeks |
| 1 — Core loop | Offline-first lift logging + volume progression, diet/macro logging, CSV export, notification scaffolding | 4–6 weeks |
| 2 — AI layer | Wellness chat wired to live context, AI food photo ID, AI-generated plan explanations | 4–6 weeks |
| 3 — Health + polish | HealthKit/Health Connect, sleep input, Google Sheets export, notification tuning, UI polish | 4–6 weeks |
| 4 — Launch | TestFlight beta, App Store + Play Store submission, RevenueCat paywall, privacy policy | 2–3 weeks |

## Monetization
Free tier: manual lift + diet logging, basic history. Paid tier ($8–12/month or
$60–90/year, annual-first): AI wellness hub, food photo ID, adaptive plan generation,
health integrations, unlimited history/export. Apple Small Business Program (15%
commission, automatic for new developers under $1M/year) and RevenueCat (free to
$2,500 MTR, ~1% beyond) apply.

## Legal / compliance
"Not medical advice" disclaimer at first AI use and in settings at all times.
Singapore PDPA applies to sleep/injury/diet data from the first write, not just at
public launch.

## Explicitly not doing (v1)
- No 1RM / max-effort testing flows
- No social feed or community layer
- No wearable hardware partnership
- No broad Google `drive` scope — `drive.file` only
