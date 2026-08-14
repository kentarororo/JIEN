# Edge Functions

Deploy `food-search`, `food-barcode`, `analyze-food-photo`, and `wellness-chat` with
Supabase's normal JWT verification enabled. Configure these server-only secrets:

- `USDA_FDC_API_KEY` from USDA FoodData Central.
- `ANTHROPIC_API_KEY` for photo analysis.
- `ANTHROPIC_MODEL` set to the approved Claude vision-capable model for the environment.

The client never receives these secrets. Food search normalizes USDA results to a
100 g portion. Barcode lookup uses Open Food Facts and returns its attribution.
Photo analysis additionally checks the signed-in user's `ai_data_consent` flag.
Its client contract is versioned (`{ version: 1, data: ... }`) and always returns a
request ID in either the stable success or error envelope. A short authenticated
`capability` action checks consent and server-side provider configuration before the
browser uploads a selected photo. Provider calls have a finite timeout, and provider
output is rejected unless every food item passes strict numeric and text validation.

Deploy the photo function after changing its contract:

```powershell
supabase functions deploy analyze-food-photo --project-ref vrgkkcunbngjgqfmlcuh
```

`supabase secrets list --project-ref vrgkkcunbngjgqfmlcuh` can confirm the two
Anthropic secret names without displaying their values. Never place provider keys in
Expo or GitHub Pages environment variables.

`wellness-chat` verifies AI consent and the first-use medical disclaimer, reads the
signed-in user's recent training, food, wellness, and conversation rows through RLS,
and writes assistant messages with the service role. The deterministic plan brief is
provided by the client progression engine and is treated as immutable numeric input;
Claude explains it but does not replace its load, rep, or deload decisions.
