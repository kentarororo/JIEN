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
- Meal-photo estimates use the authenticated, consent-gated `analyze-food-photo` Edge
  Function through the tester's Vault-encrypted Gemini key, with an optional
  deployment-owned Gemini or Anthropic fallback. The compressed image
  stays in the account-scoped local retry queue and is not added to the durable meal
  log by capture alone. Web photo bytes use a separate account-scoped IndexedDB
  payload store, rather than inflating the serialized SQLite history. Capture or selection opens a review
  sheet immediately; a successful analysis inserts every normalized result into the
  editable meal draft exactly once. Retryable failures retain the photo and context,
  and saved AI-derived items carry request provenance plus a completed AI status.

USDA and Open Food Facts enrichment are best-effort. Search results remain usable if
the local cache write fails, and barcode digits remain visible if no product matches.

## Why not MyFitnessPal

MyFitnessPal does not provide a self-serve public food API. Its API is private and
available only to approved partners, so JIEN must not depend on access that has not
been granted. See MyFitnessPal's [API access page](https://www.myfitnesspal.com/apps/api/version).

The repository boundary remains provider-neutral so an approved commercial provider
can be added later. For Singapore/global packaged-food coverage, FatSecret is the
first commercial candidate to benchmark, but only after its contract explicitly
permits durable per-user offline nutrition snapshots. Open Food Facts-derived records
must remain attributed and logically distinguishable from proprietary datasets.

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
The supported optional deployment-fallback setup is
`powershell -ExecutionPolicy Bypass -File .\scripts\configure-photo-ai.ps1` from the
repository root. It uses the stable low-cost `gemini-3.5-flash-lite` image/structured-output model
and never writes the key into the Expo bundle or Git history.

Google sign-in supplies only the Supabase identity used for authentication and RLS.
No Google provider access token is sent to Gemini, and a Gemini/ChatGPT consumer
subscription is unrelated to inference. A separate Gemini API key is required. JIEN
allows 5 meal-photo calls per account per UTC day; Google separately controls free-tier
quota and any project billing.

Google responses are classified separately: 401/403 means the key/project did not
permit generation, 404 means the selected model is unavailable, 429 means project
quota is exhausted, and 400 means JIEN's request contract needs updating. The app
must not describe all of these as a rejected key.
