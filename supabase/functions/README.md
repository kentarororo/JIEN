# Edge Functions

Deploy `food-search`, `food-barcode`, `ai-settings`, `analyze-food-photo`, and `wellness-chat` with
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

### Tester-owned key flow (default for the current beta)

Apply migration `20260816000200_user_ai_credentials.sql`, then deploy the three AI
functions:

```powershell
& $pnpm dlx supabase@latest db push
& $pnpm dlx supabase@latest functions deploy ai-settings --project-ref vrgkkcunbngjgqfmlcuh --use-api
& $pnpm dlx supabase@latest functions deploy analyze-food-photo --project-ref vrgkkcunbngjgqfmlcuh --use-api
& $pnpm dlx supabase@latest functions deploy wellness-chat --project-ref vrgkkcunbngjgqfmlcuh --use-api
```

Signed-in testers then open **Settings > AI connection**, follow the direct Google AI
Studio link, and paste their own Gemini key. `ai-settings` verifies the key against
`gemini-3.5-flash-lite` without sending user content, then stores it encrypted in
Supabase Vault. The browser receives only configured/source/model/limit metadata; it
never receives the stored key. The same personal key is resolved server-side for
meal-photo estimates and contextual wellness guidance. A hard JIEN allowance permits
5 photo requests and 10 contextual requests per account per UTC day.

Google controls the key's Free/Paid plan. A project with no paid billing uses the
Gemini free tier and stops at Google's quota; JIEN cannot upgrade it. If the tester
enables billing, Google may charge them. Google's current free-tier terms say
submitted content may be used to improve its products; the setup screen discloses
this before accepting a key. Google's project spend caps are separate, experimental,
and can lag, so JIEN's request allowance is an additional abuse bound—not a monetary
guarantee.

### Deployment-owned fallback (optional)

Create a JIEN-owned key in [Google AI Studio](https://ai.google.dev/gemini-api/docs/api-key),
then run the repository setup helper. It prompts securely for the key, saves it only
in Supabase Secrets, deploys the current function, and removes its temporary secret
file:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure-photo-ai.ps1
```

The helper selects the current stable low-cost `gemini-3.5-flash-lite` model, which accepts image
input and structured JSON output. One JIEN-owned Gemini key serves all authenticated
testers through the Edge Function.
Configure quotas, budget alerts, and key restrictions on that JIEN Google AI project.
Normal Google sign-in is identity only: JIEN does not request or forward the user's
Google access token, and a tester's Gemini consumer subscription does not fund JIEN
inference.

If configuring manually instead, set `PHOTO_AI_PROVIDER=gemini`, `WELLNESS_AI_PROVIDER=gemini`, `GEMINI_API_KEY`,
and `GEMINI_MODEL=gemini-3.5-flash-lite` in Supabase Edge Function Secrets, then deploy
the three AI functions. Secrets become available immediately, but the functions still
must be redeployed whenever its source code changes.

For an Anthropic-only deployment:

```powershell
supabase secrets set PHOTO_AI_PROVIDER="anthropic" WELLNESS_AI_PROVIDER="anthropic" ANTHROPIC_API_KEY="<JIEN-owned-Anthropic-key>" ANTHROPIC_MODEL="<approved-Claude-model>" --project-ref vrgkkcunbngjgqfmlcuh
supabase functions deploy analyze-food-photo wellness-chat --project-ref vrgkkcunbngjgqfmlcuh
```

Never place provider keys in Expo, GitHub Pages variables, browser storage, or Google
OAuth configuration. Deployment-owned keys use Supabase Function Secrets; tester-owned
keys use the authenticated `ai-settings` proxy and encrypted Supabase Vault storage.

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
