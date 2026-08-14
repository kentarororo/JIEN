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
  Function. The image stays in temporary client memory for review/retry and is not
  added to the durable meal log by capture alone. Capture or selection opens a review
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

The client contains no provider secret. Deployment owners configure `USDA_FDC_API_KEY`,
`ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL` as Supabase secrets and deploy the functions
listed in `supabase/functions/README.md`. Without those secrets, local/manual logging
and Open Food Facts lookup remain available; the photo review sheet reports that AI
analysis is unavailable instead of discarding the selected image.
