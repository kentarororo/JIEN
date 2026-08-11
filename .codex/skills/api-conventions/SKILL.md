---
name: api-conventions
description: Request, response, authentication, and error conventions for JIEN Supabase Edge Functions. Use for any client-to-backend integration, AI call, webhook, Edge Function, or network error state.
---

# JIEN API conventions

All AI calls go through authenticated Supabase Edge Functions. Never expose the Anthropic API key to the client.

## Envelope

- Send JSON requests with a versioned payload: `{ "version": 1, "data": { ... } }`.
- Return success as `{ "data": T, "requestId": string }`.
- Return failure as `{ "error": { "code": string, "message": string, "retryable": boolean }, "requestId": string }`.
- Use stable, machine-readable error codes and safe user-facing messages. Do not return provider secrets, raw stack traces, or sensitive prompt context.

## Client behavior

1. Call APIs through the shared client under `/lib/db`; do not scatter raw fetches through screens.
2. Attach the active Supabase access token and reject unauthenticated calls server-side.
3. Set a finite timeout and make retries explicit, bounded, and safe for idempotency.
4. Show a clear connection-required state for AI features. Never leave an indefinite spinner.
5. Cache readable prior AI responses locally, but do not pretend new AI work succeeded offline.
6. Show the not-medical-advice notice at first AI use and keep it reachable from settings.
