# Edge Functions

Deploy `food-search`, `food-barcode`, `analyze-food-photo`, and `wellness-chat` with
Supabase's normal JWT verification enabled. Configure these server-only secrets:

- `USDA_FDC_API_KEY` from USDA FoodData Central.
- `PHOTO_AI_PROVIDER` set to `gemini`, `anthropic`, or `auto`.
- `WELLNESS_AI_PROVIDER` optionally set to `gemini`, `anthropic`, or `auto`; it
  defaults to `auto` when omitted.
- `GEMINI_API_KEY` and `GEMINI_MODEL` for JIEN-owned Gemini photo and wellness
  inference.
- `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` when Anthropic is selected or retained as
  the `auto` fallback.

An explicit provider never falls through when its key or model is missing. `auto` is
deterministic: it uses a complete Gemini configuration first, then a complete
Anthropic configuration. Model secrets contain bare model names, not URLs.

The client never receives provider secrets. Photo analysis checks the authenticated
user's `ai_data_consent` flag before checking provider configuration. Its version 1
contract always returns a request ID in the stable success or error envelope. The
`capability` action checks auth, consent, and selected-provider configuration before
the browser uploads a photo. Provider calls have a finite timeout, and output is
rejected unless every food item passes strict numeric and text validation.

Gemini uses Google's official `generateContent` API with inline base64 image data and
a structured JSON response schema. See the official
[image input](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding)
and [structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
documentation.

## Configure Gemini AI features

From the repository, replace the quoted placeholders with JIEN-owned server values:

```powershell
supabase secrets set PHOTO_AI_PROVIDER="gemini" GEMINI_API_KEY="<JIEN-owned-Gemini-key>" GEMINI_MODEL="<approved-Gemini-model>" --project-ref vrgkkcunbngjgqfmlcuh
supabase functions deploy analyze-food-photo wellness-chat --project-ref vrgkkcunbngjgqfmlcuh
supabase secrets list --project-ref vrgkkcunbngjgqfmlcuh
```

One JIEN-owned Gemini key serves all authenticated testers through the Edge Functions.
Configure quotas, budget alerts, and key restrictions on that JIEN Google AI project.
Normal Google sign-in is identity only: JIEN does not request or forward the user's
Google access token, and a tester's Gemini consumer subscription does not fund JIEN
inference.

For an Anthropic-only deployment:

```powershell
supabase secrets set PHOTO_AI_PROVIDER="anthropic" WELLNESS_AI_PROVIDER="anthropic" ANTHROPIC_API_KEY="<JIEN-owned-Anthropic-key>" ANTHROPIC_MODEL="<approved-Claude-model>" --project-ref vrgkkcunbngjgqfmlcuh
supabase functions deploy analyze-food-photo wellness-chat --project-ref vrgkkcunbngjgqfmlcuh
```

Never place provider keys in Expo, GitHub Pages variables, browser storage, or Google
OAuth configuration. Supabase secrets are the only supported location.

Food search normalizes USDA results to a 100 g portion. Barcode lookup uses Open Food
Facts and returns its attribution.

`wellness-chat` verifies AI consent and the first-use medical disclaimer, reads the
signed-in user's recent training, food, wellness, and conversation rows through RLS,
and writes assistant messages with the service role. Gemini and Anthropic share one
normalized, time-bounded contract. The deterministic plan brief is treated as
immutable numeric input; the selected model explains it but does not replace its
load, rep, or deload decisions.

The request contract rejects malformed or coercible plan values. Required live-
context query failures stop before provider use, and the reserved assistant UUID is
validated as the retry idempotency key. See `docs/wellness-ai.md` for the end-to-end
sequence, stable error behavior, and deployment smoke-test expectations.
