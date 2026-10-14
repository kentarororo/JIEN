# Food-photo quality: research, implementation and release gate

Checkpoint: 14 October 2026. Implemented locally; not yet deployed or validated on a
weighed-meal photo benchmark. Do not call this an accuracy improvement measured in percent.

## What MacroFactor actually documents

MacroFactor's [product explanation](https://macrofactor.com/ai-food-logging/) describes
several model prompts, ingredient/recipe decomposition and database retrieval. It
prioritizes real food entries over generated nutrient values, exposes ingredients,
and allows portion edits. Its public description does not disclose the exact model,
prompt, matching algorithm or a reproducible accuracy benchmark. We are adopting the
documented principles, not claiming to reproduce proprietary implementation.

Its [help guide](https://help.macrofactorapp.com/en/articles/258-ai-food-logging)
recommends clear photos, optional meal context, a scale/reference and review of
ingredients and portions. A database does not fix a wrong portion or food identity.

[Nutrition5k](https://arxiv.org/abs/2103.03375) is a useful evaluation reference:
its annotated dishes include component weights and depth/video evidence. It is not
evidence that JIEN achieves the same performance on Singaporean meals from one photo.

## Diagnosis in JIEN

Previously one short prompt asked the model for both food identity/quantity and
nutrients. Shape validation accepted any finite values inside broad limits. A
model-generated confidence number appeared as a percentage despite having no
calibration against known meals. The prior synthetic label success established
connectivity and one transcription, not real-meal accuracy.

User-reported failure: a photo of half a fried-chicken sandwich with bread, lettuce,
white sauce and egg returned 960 kcal / 51 g protein / 57 g carbs / 58 g fat.
4/4/9 gives 954 kcal, so an arithmetic check alone would not catch the suspected
portion error. The photo and measured ingredients have not been supplied. Do not
assign an invented correct calorie value or automatically halve the result.

## Implemented first quality slice

1. **Versioned runtime rubric.** `photo-analysis-policy.ts` is consumed by both
   providers. It distinguishes label transcription from estimation; specifies totals
   for the returned quantity; handles cooked/raw, edible weight, shared dishes and
   already-partial portions; prohibits whole-dish/component double counting; and
   asks for explicit portion/oil/sauce assumptions. Regional mixed dishes are not
   silently treated as plain rice/noodles. Image text/context are untrusted input.
   A developer-only `SKILL.md` would not execute during a scan.
2. **Conservative nutrition lookup.** After model normalization, `photo-grounding.ts`
   optionally uses the existing server-side `USDA_FDC_API_KEY`. It queries only
   Foundation/SR Legacy foods for simple gram-based items. Exactly one normalized
   description match with all required nutrients and compatible units is necessary.
   It scales per-100-g data once. No brand, fuzzy or first-result selection; ambiguous,
   incomplete, absent and failed results remain explicitly estimated. Labels are
   never overwritten. The model cannot assert a verified USDA basis itself.
3. **Bounded cost/latency.** One model call; at most six deduplicated USDA requests,
   each with a four-second timeout, no automatic retries. No new model, subscription,
   provider keys or Composio permission changes. USDA receives food-query text, not
   the photo, account identifier or full meal description. UI discloses this lookup.
4. **Honest review.** Replace percentage confidence with estimated/AI-read-label/USDA
   nutrition provenance. Show model assumptions and check prompts. Display the actual
   USDA description/ID, since a correct database entry can still be the wrong match
   for the photographed food. Keep portion and nutrients editable.
5. **Sanity checks, not false precision.** Flag large energy/macro discrepancies and
   macro mass exceeding serving weight. These are product heuristics, not clinical
   cutoffs; never automatically overwrite calories to force a 4/4/9 equality.
6. **Preservation.** Review metadata survives draft recovery, queued-result parsing
   and the existing meal `aiContext` JSON. Removed food items lose their attached
   provenance. Manual saving remains local-first. No database migration, historic
   record rewrite or photo upload during testing. Pagehide flushes the latest draft
   rather than losing edits inside the 180-ms save debounce.

USDA [API documentation](https://fdc.nal.usda.gov/api-guide/) describes search/details,
key protection, rate limits and public-domain attribution. New food-database adapters
must preserve source licensing and not label crowdsourced entries as lab verified.

## What is deliberately not solved yet

- An exact match verifies database provenance, not the model's food identity or portion.
  Conservative matching will often abstain, especially for hawker/mixed dishes.
- Instructions cannot reveal hidden sauce, absorption of frying oil or food thickness.
- We have not benchmarked another model or added a more expensive second model call.
- No automatic learning from private logs, user-photo pooling, or model training.
- No new recipe hierarchy or fuzzy cross-database matching until evaluation supports it.

## Evaluation and next release gate

Keep engineering regression tests separate from nutrition-accuracy evaluation.
Build a consented set with original photos and independently measured ground truth:

| Case | Ground truth | Failure to check |
| --- | --- | --- |
| Half fried-chicken sandwich | Weighed bread, cooked filling, egg, sauce; actual fraction eaten | Reconstructing a whole sandwich; doubling bread faces; halving twice |
| Cooked rice + chicken | Each cooked edible weight | Dry-rice density; skin/bone; per-100-g double scaling |
| Chicken rice / laksa / fried noodles | Recipe or vendor data plus actual serving, where available | Wrong regional substitute; hidden oil/coconut milk |
| Shared plate / leftovers | Actual personal amount eaten | Logging every visible plate or uneaten food |
| Packaged label | Readable label, column, serving and eaten amount | kJ/kcal, per-serving/per-100-g, package vs serving |
| Blurry or occluded image | Known contents but deliberately inadequate image | Invented certainty rather than abstention/review |

Compare the same photos/context on old and new policy, with fixed model/config.
Record component identification, portion grams, signed/absolute kcal and macro error,
missing/doubled ingredients, database match correctness and abstention rate, correction
taps, latency and token cost. Repeat ambiguous examples; a single good sample is not
a benchmark. Exclude unknown-ground-truth anecdotes from numerical accuracy scores.
Include local foods; do not average away severe overestimation on partial portions.
No universal accuracy target is claimed before collecting a baseline.

Release together: updated web disclosure/review UI and `analyze-food-photo` backend.
Keep current authentication, consent and owner-funded model configuration. Require
an approved, bounded real-photo check before declaring the quality work complete.

## Engineering validation

- Full test command: 384 passing executions (8 + 10 + 21 pretests, 345 main).
- TypeScript typecheck passed.
- Production-mode Expo export passed using isolated E2E Supabase configuration;
  this is not a production-configured deployable bundle.
- Nine photo browser checks passed across desktop Chromium, Android emulation and
  iOS WebKit. Requests are mocked; they test upload, preserved retry context, evidence
  labels, editable nutrition, scaling and immediate-reload recovery, not AI accuracy.
- No paid model calls, real user-photo uploads, commits or deployments in this slice.
  Supabase photo-function deployment and a correctly configured production web build
  remain release steps. Do not deploy the current E2E `dist` output.
