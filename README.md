# JIEN

JIEN is an offline-first Expo app for sustainable lifting and nutrition tracking.
SQLite is the on-device source of truth; authenticated changes are queued, pushed,
and restored from a Supabase backend with row-level security.

## Current build

- Expo Router tabs for Today, Training, Food, and Settings
- responsive multi-exercise workout logging, custom exercises, and optional RPE
- calendar-backed planned workouts that preserve prior sets and keep progression cues optional
- deterministic session-over-session overload and weekly volume summaries (no 1RM flows)
- searchable offline food starters, editable database/barcode results, and camera/library meal-photo analysis
- meal, food-item, macro-total, and versioned nutrition-target logging
- offline-first sleep duration/quality history with calendar review and editing
- native share / web download for workout CSV, nutrition CSV, and complete JSON
- opt-in planned-workout, history-aware meal-gap, and persistent sync-attention notifications with
  quiet hours, stale cancellation, and safe deep links
- optional Google or email authentication, persistent sessions, and two-way cloud restore
- warm cream, royal-brown, and wood-accented light/dark themes
- calm guided onboarding for goals, body baseline, equipment, joint considerations, diet, and AI consent

The approved interface hierarchy and moodboard consensus are recorded in
[docs/product-visual-direction.md](docs/product-visual-direction.md). Interface grammar,
error structure, and AI-copy constraints are recorded in
[docs/product-voice.md](docs/product-voice.md). Current and upcoming delivery gates are
recorded in [docs/roadmap.md](docs/roadmap.md).

## Local setup

Use a current Node.js release and pnpm.

```sh
pnpm install
cp .env.example .env.local
pnpm start
```

Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to enable
accounts and cloud sync. Logging and exports continue to work without them.

### Google sign-in setup

Google login is optional and uses Supabase Auth with PKCE. In Google Auth Platform,
create a **Web application** OAuth client with:

- authorized JavaScript origin: your Vercel production origin, for example
  `https://jien.vercel.app`
- authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`

Enable Google in **Supabase > Authentication > Providers**, then paste the client ID
and secret there. The secret is server-side configuration and must never be placed in
an `EXPO_PUBLIC_*` variable. Add these Supabase redirect allow-list entries:

- `https://<your-vercel-project>.vercel.app/**`
- `http://localhost:8081/`
- `jien://auth/callback`

The first successful account on a device owns that local database. Signing out keeps
the offline records, while signing into a different account is blocked instead of
silently merging two people's health data.

Online food search combines Open Food Facts with USDA FoodData Central when the
optional Supabase function is configured; barcode lookup falls back safely to Open
Food Facts. Completed manual or label-assisted entries can be saved as device-local
private foods and reused from offline search without delaying the meal save.
Consent-gated meal-photo analysis remains a Supabase Edge Function. The
provider boundaries and server-only setup are documented in [docs/food-data.md](docs/food-data.md)
and [supabase/functions/README.md](supabase/functions/README.md).
For Vercel, add the same two public Supabase values as project environment variables.
Local food search and manual logging remain available without them on supported hosts.

Useful checks:

```sh
pnpm typecheck
pnpm test
pnpm exec expo install --check
```

## Data flow

Every user write is committed to SQLite together with its sync-queue item in one
transaction. The runtime uploads queued upserts, then incrementally restores newer
cloud rows when the app opens, returns to the foreground, regains connectivity, or
finishes authentication. Supabase authentication and RLS scope remote rows to their
owner; both sides reject stale `client_updated_at` updates.

The remote model and security rules are documented in [docs/schema.md](docs/schema.md)
and implemented by the ordered SQL history in [supabase/migrations](supabase/migrations).
Apply pending migrations to the linked Supabase project before testing a newly
synced entity or column on another device.

## Native builds

Notifications and other native modules require a development build rather than the
basic Expo Go client.

```sh
pnpm exec expo run:ios
pnpm exec expo run:android
```

## Web deployment

Functional web testing uses the Vercel deployment. `vercel.json` keeps the supported
host response contract, runs the production export, and publishes `dist`:

1. Import this GitHub repository into Vercel.
2. Connect the Supabase Vercel integration, or add `EXPO_PUBLIC_SUPABASE_URL`
   and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as Production and Preview
   environment variables. The production build maps the integration-provided
   `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` names into Expo automatically.
3. Deploy, then add the resulting Vercel URL to the Supabase redirect allow-list and
   Google OAuth authorized JavaScript origins described above.

Do not set `EXPO_PUBLIC_BASE_URL` in Vercel. The production build uses the root path.
The build clears Metro's environment-sensitive cache, refuses to export without a
valid public Supabase URL and key, then validates the main-thread wa-sqlite WASM,
moves it to a stable public asset URL, and content-hashes the repaired entry bundle.

GitHub Pages remains useful only as a pointer and publishes a host-requirements
screen. Vercel web uses an account-scoped IndexedDB VFS without Expo's OPFS
access-handle worker or a SharedArrayBuffer requirement; native builds continue to
use persistent Expo SQLite. See `docs/web-tester-runtime.md` for lifecycle details.
