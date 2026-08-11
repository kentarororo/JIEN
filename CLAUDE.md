# Project: [JIEN] — holistic wellness AI app

## What this is
A cross-platform (iOS, Android, web) fitness and wellness app, built solo. The core
differentiator is a holistic AI layer that unifies lift tracking, diet tracking, and
free-form wellness input (feeling, injury, sleep, health-app data) into one adaptive
system — most competitors (Hevy, Strong, MyFitnessPal, Cronometer) only cover one
slice and don't talk to each other. That gap is the product.

## Stack
- Client: Expo (React Native + Expo Router), TypeScript
- Local data: SQLite on-device (source of truth for offline-first), background sync to Supabase
- Backend: Supabase (Postgres, Auth, Storage, Edge Functions)
- AI: Anthropic Claude API — called ONLY from Supabase Edge Functions, never directly
  from the client
- Subscriptions: RevenueCat
- Health data (phase 3+): react-native-health (iOS), react-native-health-connect
  (Android) — native only, requires a custom dev client, not available in Expo Go
- Export/backup (phase 3+): CSV/JSON generation client-side; optional sync to a real
  Google Sheet in the user's Drive via the `drive.file` OAuth scope (narrow, basic
  verification only — do not request the broad `drive` scope)

## Core design decisions — do not relitigate without asking
1. **Progression is volume-based, not 1RM-based.** Track total volume (sets × reps ×
   load) per muscle group per week. Progress via double progression within target rep
   ranges. This reflects an explicit long-term-sustainability-over-injury-risk
   philosophy — never build a max-effort or 1RM-testing flow.
2. **The progression engine is deterministic and runs fully offline**, client-side, as
   pure math over locally logged sets. It does not call the AI or need a network
   connection.
3. **The AI layer is separate and network-dependent.** It explains, contextualizes, and
   adapts tone/pacing based on subjective signals (soreness, sleep, mood, injury flags)
   — it does not invent the underlying volume numbers. When offline, the app must show
   a clear "AI needs a connection" state, never a silent failure.
4. **Notifications are core from phase 1**, not a later bolt-on. Contextual and opt-in
   only — no generic daily "log your food" nags.
5. **Export is a real Google Sheet, not a generic backup dump.** Google's Drive API
   terms restrict using Drive as generic app-content backup without special approval —
   build this as the user exporting/updating an actual spreadsheet they own (fixed
   template: Workouts tab, Nutrition tab), which is an allowed productivity use case
   under the `drive.file` scope.

## Conventions
- All data access through `/lib/db` — no raw fetch calls scattered through screens
- Every screen has loading, empty, and error states — no bare happy path
- Every write hits local SQLite first, then queues for Supabase sync — never block a
  write on network
- Small commits, one feature per commit

## Data model
See PROJECT_BRIEF.md for the full feature spec. Table structure lives in
/docs/schema.md — update that file before adding or changing tables, don't let it
drift from the actual migrations.

## Legal / compliance
- Every AI-generated training or nutrition suggestion carries a visible "not medical
  advice" disclaimer — shown at first use and reachable from settings at all times
- Sleep, injury, and diet data are treated as sensitive. Singapore PDPA applies from
  the first line of user data written, not just at public launch — confirm consent
  copy before shipping the write path, not after

## Never
- Call the Anthropic API directly from the client
- Add a new npm dependency without checking Expo managed-workflow compatibility first
- Build a 1RM-chasing or max-effort-testing feature
- Request the broad Google `drive` scope — `drive.file` only
