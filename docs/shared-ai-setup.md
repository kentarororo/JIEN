# Shared AI for the JIEN test deployment

The app owner funds photo analysis and contextual replies for every authenticated,
consenting account. This is not limited to the current two testers. Manual logging
and deterministic training progression do not require an AI provider.

## Secure setup

Never paste a provider key into chat, source files, a public environment variable,
or the browser bundle. In the JIEN Supabase project, open **Edge Functions → Secrets**
and save the key as `ANTHROPIC_API_KEY`. No database migration is needed for this switch.
The existing production name `KEN_ANTHROPIC_API_KEY` is also accepted server-side;
`ANTHROPIC_API_KEY` takes priority if both are present. Neither is returned to clients.

After reviewing the local changes and deploying the web client, run:

```powershell
.\scripts\configure-photo-ai.ps1 -Provider anthropic -CredentialMode app -UseExistingKey
```

This sets the non-secret configuration below and deploys only `ai-settings`,
`analyze-food-photo`, and `wellness-chat`. It does not run database migrations.
Without `-UseExistingKey`, the script instead requests a masked key in your terminal;
its temporary secret file is removed in `finally`. Prefer the dashboard route to avoid
writing the key to a local temporary file at all.

```text
AI_CREDENTIAL_MODE=app
PHOTO_AI_PROVIDER=anthropic
WELLNESS_AI_PROVIDER=anthropic
ANTHROPIC_MODEL=claude-haiku-5-5
```

Organization-wide/multi-workspace Anthropic keys also require
`ANTHROPIC_WORKSPACE_ID=wrkspc_...`, using the ID from Console → Workspaces.
Pass `-AnthropicWorkspaceId wrkspc_...` to the setup script, or set this server-only
configuration in Supabase Secrets. Both adapters send it as `anthropic-workspace-id`;
it is never taken from client input. Single-workspace/legacy keys can omit it.
Malformed IDs fail configuration checks. See
[Anthropic workspace routing](https://platform.claude.com/docs/en/manage-claude/workspaces).

Haiku 5.5 is selected for low-cost photo extraction and brief contextual replies.
The adapters omit sampling parameters and use low effort with finite output budgets
(4,096 photo / 2,048 reply tokens) and timeouts. See Anthropic's
[model documentation](https://platform.claude.com/docs/en/models/haiku-5-5/overview)
and [migration requirements](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide).
Mocked tests are not evidence of model access or extraction accuracy on a real account.

## Routing and safeguards

- App mode skips personal Vault lookup completely. Old Gemini credentials stay intact
  but cannot override Anthropic or become a fallback on failure.
- Missing provider configuration or an invalid credential mode fails closed.
- Without the mode setting, legacy `personal-first` routing remains in place.
- Settings reports photo-provider configuration, not proven connectivity. Keep both
  provider selectors aligned (the setup script does this).
- A stale browser attempting to save a personal key in app mode receives
  `AI_MANAGED_BY_APP` before any paid verification request.
- Existing consent/authentication checks still apply. Only server code sees the key.
- Photo estimates remain editable and are not saved as a meal automatically. Failed
  requests retain the selected photo and description for an explicit retry.
- There is no JIEN daily request cap. All accounts share the owner's provider credit,
  quota, and rate limits. Use a dedicated provider workspace, review its spending
  controls, and turn off automatic credit reload for a fixed prepaid balance.

## Release validation

1. Deploy web changes before enabling shared mode; old cached Settings cannot parse
   an Anthropic status and may need a refresh.
2. Confirm Settings shows **Anthropic configured**, owner-funded usage, and no key form
   on both accounts.
3. With the owner's approval, analyze one non-personal test image; inspect the returned
   editable food, description, and provider usage. Do not create a test meal in personal history.
4. Check one contextual reply with consent and verify that deterministic targets are unchanged.
5. Test explicit retry on provider failure without duplicate food and confirm no secret
   appears in client network responses or logs.

Rollback: set `AI_CREDENTIAL_MODE=personal-first` and restore the previous provider/model
settings. Previously saved personal Gemini keys will be used again. No food, workout,
authentication, SQLite, or Vault data needs to be deleted.

## Release checkpoint (2026-10-12)

- Full `pnpm test`: 372 passing test executions, including pretest suites.
- Typecheck and PowerShell setup-script syntax check passed.
- Production-mode QA export: 29 routes built with isolated test Supabase settings.
- Twelve focused browser checks passed across desktop, Android emulation, and
  iPhone WebKit. Six additional repeated WebKit retry checks passed after the
  lifecycle change. These provider responses were mocked, not paid live requests.
- The intermittent WebKit description-loss failure was reproduced during immediate
  typing after upload. The description input now waits for the modal's `onShow`
  lifecycle before accepting edits. Browser regression checks submit immediately
  after filling and change the description before retry; no fixed sleep is used.
  This is a lifecycle hardening change, not proof that every iOS keyboard race is resolved.
- Supabase `ai-settings`, `analyze-food-photo`, and `wellness-chat` are deployed with
  app-funded Anthropic routing. No database migrations or personal record writes were run.
- Vercel CLI is authenticated and linked to the existing `jien` project in
  `kennethangww-1335s-projects`; no replacement project was created. Local environment
  files, deployment credentials, and Supabase CLI caches are excluded from deployment uploads.
- The production web build succeeded with 29 routes. Deployment
  `dpl_CnRyR5c55MJFnDX4gPPmJJxpvpHa` was verified and promoted to
  `https://jien-coral.vercel.app`. Its entry bundle is
  `entry-ad60cffef63830cd853058c4309438c7.js`, with production Supabase configuration
  and no isolated-test endpoint. The web release does not resolve an invalid provider key.
- Live Settings loaded successfully on the existing signed-in account and displays
  **Anthropic configured**, owner-funded usage, and **No personal key needed**. The
  production HTML returns HTTP 200 with the expected bundle and COOP/COEP headers.
- A single approved synthetic-label request reached Anthropic using the app credential
  but returned upstream HTTP 401 (`PROVIDER_AUTH_INVALID`). The server log request ID was
  `b491aa2e-e0fb-4112-83ac-7a0c4cb7212f`. No meal was saved. The owner must replace
  `KEN_ANTHROPIC_API_KEY` in Supabase Secrets (or supply the canonical key, which takes
  precedence). Never paste the key into chat. Live extraction and wellness replies
  remain unverified until the key is accepted; do not interpret Settings configuration
  or mocked tests as proof of provider access.
- No Git commit has been made. Keep these workspace changes when committing.

### Replacement-key follow-up (2026-10-12)

- After the owner replaced the key, live request
  `df5f27ef-2c03-464d-a617-67143d2c6f73` returned upstream HTTP 400 rather than 401.
  The previous authentication failure is no longer the observed error; scans are
  still not verified working. The provider Console showed US$9.92 credit and
  auto-reload disabled at that check.
- Added allowlisted Anthropic error types and fixed diagnostic categories. Raw
  provider messages, keys, images, and prompts are never logged or returned.
  `x-jien-provider-reason` exposes only the fixed category on authenticated failures.
- The owner approved up to two additional synthetic scans. The first returned
  `PROVIDER_REQUEST_INVALID`, request `16ed0e77-a281-4489-aa42-9031664da232`, category
  `account`. This means the provider error text mentions account, organization, or
  workspace; it does not establish the precise restriction. One approved scan remains.
- The diagnostic backend is deployed. Provider Console access must be restored to
  inspect the account restriction; the Chrome connection used earlier is unavailable.
  No billing, model, permissions, or credential changes were made during this follow-up.
  No test meal was saved. Do not repeat key rotation or buy more credit on this evidence.

### Workspace-routing fix and live success (2026-10-12)

- Console inspection showed the replacement JIEN key has Organization scope.
  The adapters were missing the workspace request header required by that key type.
- Added optional, validated workspace routing across provider resolution, shared
  credentials, photo requests, wellness requests and Settings capability checks.
  Set the existing Default workspace ID on Supabase and deployed all three AI
  functions. No billing, permissions, key, model or database changes were required.
- The final approved synthetic scan succeeded in production (HTTP 200), request
  `7ebc9c75-90d5-4013-bad6-dcd5eef0f90e`. It returned Test cereal, 50 g, 200 kcal,
  protein 10 g, carbohydrate 30 g, fat 4 g and fibre 3 g, matching the fixture.
  No meal or reusable food was saved; the synthetic result is an unsaved draft.
- Focused provider/credential tests: 25 passed. Full suite: 375 test executions
  passed (8 + 10 + 21 + 336). Typecheck and diff whitespace validation passed.
  Regression tests exercise environment → app credentials → request headers for
  both providers, optional legacy behavior and malformed workspace IDs.
- A fresh local production web build was attempted but stopped at its configuration
  guard: this shell and `.env.local` do not supply the required public Supabase URL/key.
  No web code changed in this follow-up and no new web deployment was attempted.
- Photo access is now live-verified. Wellness uses the same deployed routing fix,
  but a separate paid live wellness reply has not been run. Real meal photos still
  require human review; a successful label test does not establish universal accuracy.
- No commit was made. This is a backend-only follow-up; the existing Vercel web
  deployment remains in place.

### Changed areas

- AI routing/adapters: `supabase/functions/_shared/{user-ai,photo-provider,wellness-provider}.ts`
  and the `ai-settings`, `analyze-food-photo`, and `wellness-chat` function entry points.
- Client: `src/app/settings/ai.tsx`, `src/app/(tabs)/settings.tsx`,
  `src/app/meals/new.tsx`, `src/lib/db/{ai-settings-contract,meal-photo-api}.ts`,
  and `src/lib/meal-photo-flow.ts`.
- Regression coverage: corresponding AI/provider/photo-flow tests plus
  `e2e/ai-settings.spec.ts` and `e2e/meal-photo.spec.ts`.
- Operations: `scripts/configure-photo-ai.ps1`, `.gitignore`, `.vercelignore`,
  and this release note.
