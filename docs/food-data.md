# Food data and meal-photo analysis

JIEN keeps saved meals as editable SQLite snapshots. A provider outage or later label
change therefore cannot rewrite a user's history, and manual logging never depends on
a network service.

## Current sources

- The on-device starter/recent-food cache answers immediately and works offline.
- [USDA FoodData Central](https://fdc.nal.usda.gov/api-guide/) supplies generic and
  branded food search through the `food-search` Supabase Edge Function when its
  server-only API key is configured.
- [Open Food Facts](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/)
  supplies global community-contributed search and barcode matches. Its values can be
  incomplete, so JIEN displays the source and keeps every portion and macro editable.
- [FatSecret Platform](https://platform.fatsecret.com/platform-api) supplies localized
  branded and generic search through the authenticated `food-search` Edge Function
  only when server credentials and explicit durable-snapshot licensing are both
  configured. JIEN uses v5 detailed servings, preferring FatSecret's default serving
  and then a 100 g serving, and displays `FatSecret Platform` on every returned item.
- Meal-photo estimates use the authenticated, consent-gated `analyze-food-photo` Edge
  Function through the tester's Vault-encrypted Gemini key, with an optional
  deployment-owned Gemini or Anthropic fallback. The compressed image
  stays in the account-scoped local retry queue and is not added to the durable meal
  log by capture alone. Web photo bytes use a separate account-scoped IndexedDB
  payload store, rather than inflating the serialized SQLite history. Capture or selection opens a review
  sheet immediately; a successful analysis inserts every normalized result into the
  editable meal draft exactly once. Retryable failures retain the photo and context,
  and saved AI-derived items carry request provenance plus a completed AI status.

FatSecret, USDA, and Open Food Facts enrichment are best-effort. FatSecret and USDA
run behind the signed-in server boundary while Open Food Facts remains the no-account
fallback. Search results remain usable if the local cache write fails, and barcode
digits remain visible if no product matches.

## Why not MyFitnessPal

MyFitnessPal does not provide a self-serve public food API. Its API is private and
available only to approved partners, so JIEN must not depend on access that has not
been granted. See MyFitnessPal's [API access page](https://www.myfitnesspal.com/apps/api/version).

The repository boundary remains provider-neutral. FatSecret is implemented as the
first localized commercial provider, but its standard API terms say search responses
may permanently store only `food_id` and `serving_id`; JIEN's offline-first meal log
also needs to retain the selected name, portion, and nutrition snapshot. Credentials
alone therefore do not activate the provider. The deployment must have a FatSecret
agreement that explicitly permits those durable per-user snapshots and set the
licensing assertion described below. Open Food Facts-derived records remain
attributed and logically distinguishable from proprietary datasets.

JIEN never bulk-caches FatSecret search results. An unselected result remains in the
current search screen only. If the user selects it and saves the meal, the editable
nutrition values become part of that user's durable meal snapshot; that specific use
is why the licensing assertion is required.

## Server configuration

The client contains and stores no provider secret. Testers connect a personal key in
Settings > AI connection; `ai-settings` verifies it with a minimal real
`generateContent` request—not just a model lookup—and stores it encrypted
in Supabase Vault. Deployment owners may still configure `USDA_FDC_API_KEY`,
`PHOTO_AI_PROVIDER`, and the selected provider pair (`GEMINI_API_KEY` plus
`GEMINI_MODEL`, or `ANTHROPIC_API_KEY` plus `ANTHROPIC_MODEL`) as Supabase secrets and
deploy the functions listed in `supabase/functions/README.md`. `auto` prefers a
complete Gemini pair and then a complete Anthropic pair. Without those secrets,
local/manual logging and Open Food Facts lookup remain available; the photo review
sheet names the deployment action required instead of leaving a selected photo inert.

FatSecret configuration is server-only:

- `FATSECRET_CLIENT_ID` and `FATSECRET_CLIENT_SECRET` are the Platform OAuth client.
- `FATSECRET_REGION=SG` and `FATSECRET_LANGUAGE=en` localize the v5 search; omit both
  to use FatSecret's US default.
- `FATSECRET_OFFLINE_SNAPSHOT_LICENSED=true` is an explicit deployment assertion that
  JIEN's FatSecret agreement permits the permanent editable nutrition snapshots used
  by its SQLite-first meal history. Do not set it for Basic/Premier Free access or on
  the assumption that credentials alone grant storage rights.

The Edge Function requests an OAuth client-credentials token with `premier` scope,
caches that token only in the server isolate until shortly before expiry, and never
sends credentials or access tokens to the browser. If any FatSecret setting is absent,
the license assertion is false, or the provider is temporarily unavailable, USDA and
Open Food Facts continue without deleting or rewriting any local meal data.
The supported optional deployment-fallback setup is
`powershell -ExecutionPolicy Bypass -File .\scripts\configure-photo-ai.ps1` from the
repository root. It uses the stable low-cost `gemini-3.5-flash-lite` image/structured-output model
and never writes the key into the Expo bundle or Git history.

Google sign-in supplies only the Supabase identity used for authentication and RLS.
No Google provider access token is sent to Gemini, and a Gemini/ChatGPT consumer
subscription is unrelated to inference. A separate Gemini API key is required. JIEN
does not impose a daily meal-photo cap; Google controls the project's quota, rate
limits, and billing. JIEN still bounds photo size, request duration, retries, and
provider output so uncapped product access does not mean an unbounded request.

Google responses are classified separately: 401/403 means the key/project did not
permit generation, 404 means the selected model is unavailable, 429 means project
quota is exhausted, and 400 means JIEN's request contract needs updating. The app
must not describe all of these as a rejected key.

`scripts/deploy-ai-slice.ps1` resolves the installed Supabase CLI directly and uses
server-side function bundling, so Docker is not required. Before `db push`, it checks
that every local migration version has a matching remote version. If another release
records a version concurrently, it rechecks the complete history and continues only
when every local migration is confirmed remotely; genuine migration failures still
stop the deployment.
