# Wellness AI runtime

The wellness chat is a network-dependent explanation layer over JIEN's local-first
records. Manual check-ins and deterministic progression continue to work without it.
Consent and the first-use health-guidance acknowledgement are checked both on the
device and again by the Edge Function before sensitive context reaches a provider.
The final consent notice is a release checkpoint and is intentionally not defined by
this technical document.

## Request and live-context sequence

1. The client validates consent, acknowledgement, and connectivity.
2. In one SQLite transaction it creates or updates the active conversation, writes
   the user message, reserves the next assistant UUID, and queues the user-owned rows.
3. The queue drains before the request. This makes recent local workouts, meals, and
   wellness logs available to the server-side context query.
4. The client sends `{ version: 1, data: ... }` with the active Supabase access token.
5. `wellness-chat` validates every identifier and deterministic-plan field without
   coercion, authenticates the user, rechecks consent and acknowledgement, and reads
   only that user's non-deleted recent rows through RLS.
6. If any required context query fails, the request returns `CONTEXT_UNAVAILABLE`;
   the provider is not called with a silently partial picture.
7. Gemini or Anthropic runs only through the shared server adapter. A tester-owned
   Gemini key is read only inside the Edge Function from Supabase Vault, with an
   optional deployment-owned fallback. Provider secrets and the user's Google identity
   token are never sent back to the client or forwarded as OAuth credentials.
8. The trusted function stores the reserved assistant row and returns the versioned
   success envelope. The client verifies the reserved conversation ID, assistant ID,
   sequence, timestamp, content, and model before caching it locally.

Dedicated manual sleep entries use the same private wellness timeline and are
available to the bounded recent-context query after sync. The app reports entered
duration and quality descriptively; neither the deterministic progression engine nor
adaptive nutrition changes a number from one sleep entry. Provider guidance must not
invent sleep stages, diagnoses, or unrecorded nights.

## Retry and diagnostics

The reserved assistant UUID is the idempotency key. A retry presents the same UUID;
if the completed row already exists and matches the conversation and sequence, the
function returns it before making another provider call. A mismatched existing row
returns `IDEMPOTENCY_CONFLICT` rather than leaking or overwriting content.

Failed user messages retain their immutable assistant UUID, request mode, and plan
brief locally. Safe bounded diagnostics add the stable error code, retryability,
request ID, and user-facing message. Retrying clears only those diagnostics. A
malformed success response is treated as `INVALID_RESPONSE` and never enters the
local conversation cache.

All failures use the shared envelope:

```json
{
  "error": {
    "code": "CONTEXT_UNAVAILABLE",
    "message": "Your recent context could not be loaded. Try again.",
    "retryable": true
  },
  "requestId": "..."
}
```

## Deployment check

GitHub Pages publishes only the Expo client. Deploy `wellness-chat` separately with
normal Supabase JWT verification and server-only provider secrets. After deployment,
an authenticated smoke test must confirm a v1 envelope, a matching reserved
assistant UUID, and a second identical request returning the saved row rather than
creating another message.

On Windows, `scripts/deploy-ai-slice.ps1` resolves a globally available Supabase CLI,
pnpm's hashed CLI link directory, or an explicit `SUPABASE_CLI_PATH`. Validate CLI
discovery without changing the remote project by running the script with
`-ResolveOnly`; omit that switch to apply pending migrations and deploy all three AI
functions. Function deployment uses Supabase's `--use-api` server-side bundler, so
Docker Desktop is not required. The script finishes by listing the remote functions;
the success message is printed only after that verification passes.

The same personal Gemini connection used for food photos supplies wellness replies.
JIEN does not impose a daily contextual-reply cap. The runtime keeps finite timeouts,
bounded retries, idempotent reply identifiers, and safe response-size limits, while
Gemini applies the user's project quota, rate limits, and billing policy. For zero-cost
use, keep the project on the Free tier without paid billing. If AI Studio offers a
project spend cap for a paid project, use `$0` or the lowest accepted value; Google
documents that spend-cap signals can lag and are not a strict zero-overage guarantee.
