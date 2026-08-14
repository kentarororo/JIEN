# JIEN

JIEN is an offline-first Expo app for sustainable lifting and nutrition tracking.
SQLite is the on-device source of truth; authenticated changes are queued, pushed,
and restored from a Supabase backend with row-level security.

## Current build

- Expo Router tabs for Today, Training, Food, and Settings
- responsive multi-exercise workout logging, custom exercises, and optional RPE
- deterministic session-over-session overload and weekly volume summaries (no 1RM flows)
- searchable offline food starters, editable database/barcode results, and AI meal-photo scaffolding
- meal, food-item, macro-total, and versioned nutrition-target logging
- native share / web download for workout CSV, nutrition CSV, and complete JSON
- opt-in, context-aware missing-meal notification scaffolding
- optional Google or email authentication, persistent sessions, and two-way cloud restore
- warm cream, royal-brown, and wood-accented light/dark themes
- calm guided onboarding for goals, body baseline, equipment, joint considerations, diet, and AI consent

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

- authorized JavaScript origin: `https://kentarororo.github.io`
- authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`

Enable Google in **Supabase > Authentication > Providers**, then paste the client ID
and secret there. The secret is server-side configuration and must never be placed in
an `EXPO_PUBLIC_*` variable. Add these Supabase redirect allow-list entries:

- `https://kentarororo.github.io/JIEN/`
- `http://localhost:8081/`
- `jien://auth/callback`

The first successful account on a device owns that local database. Signing out keeps
the offline records, while signing into a different account is blocked instead of
silently merging two people's health data.

Online food search and barcode lookup use Open Food Facts directly and work without
a JIEN account. Consent-gated Claude photo analysis remains a Supabase Edge Function;
its server-only setup is in [supabase/functions/README.md](supabase/functions/README.md).
For GitHub Pages, add the same two public Supabase values as repository secrets when
you are ready to enable sign-in and AI features. Local food search and manual logging
remain available without them.

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
and implemented by [the initial migration](supabase/migrations/20260811000100_initial_schema.sql)
plus [the account-ownership migration](supabase/migrations/20260814000100_account_ownership.sql).

## Native builds

Notifications and other native modules require a development build rather than the
basic Expo Go client.

```sh
pnpm exec expo run:ios
pnpm exec expo run:android
```

Web hosting must preserve the `Cross-Origin-Embedder-Policy: require-corp` and
`Cross-Origin-Opener-Policy: same-origin` response headers required by the SQLite
WebAssembly worker. The local Expo server config already supplies them.

## GitHub Pages test build

Pushes to `main` run the Pages workflow and publish the static Expo build at
`https://kentarororo.github.io/JIEN/`. The build uses Expo Router's `/JIEN` base URL.
Because GitHub Pages cannot set the cross-origin isolation headers needed by
Expo SQLite, the Pages artifact includes the MIT-licensed `coi-serviceworker` bridge;
the first visit may reload once while it takes control. This is a test deployment
constraint, not the preferred long-term production hosting setup.
