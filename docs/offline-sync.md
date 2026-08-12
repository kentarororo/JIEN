# Offline sync

## Contract

SQLite is the source of truth for manual logging. Each workout, meal, target,
wellness measurement or check-in, user-authored AI message, or notification
preference write and its `sync_queue` upsert is committed in the same SQLite
transaction. UI success for manual logging never waits for the network.

Client-generated UUIDs make retries idempotent. One queue row is retained per
`(table_name, entity_id)`, so a newer local edit replaces an older queued payload.
Parents are pushed before children and failures use bounded exponential backoff.

## Runtime states

| State | Meaning | User-facing behavior |
| --- | --- | --- |
| `synced` | Queue processed or already empty | Show the processed count |
| `offline` | No usable connection | Keep all rows queued locally |
| `not_configured` | Supabase public environment is absent | Local mode remains available |
| `signed_out` | No authenticated owner | Offer account entry; retain queue |
| `partial` | Some rows synced before a retryable failure | Show the error and retry later |

The app attempts sync at startup, when returning to the foreground, when connectivity
returns, and when the user chooses **Sync now**.

## Conflict rule

Queued payloads carry `client_updated_at`. The Supabase update trigger keeps the
existing row if its logical timestamp is newer, providing last-write-wins behavior
for delayed offline writes. This is intentionally simple for the initial single-user
scope. A future bidirectional pull pass must apply newer remote rows to SQLite before
multi-device use is treated as complete.

Soft-deletion tombstones use the same queue path. Hard delete is reserved for
privileged maintenance outside the client.

## Local onboarding profile

`user_profile` is a singleton SQLite mirror for onboarding answers. Goals, available
equipment, injury or joint considerations, diet pattern, and AI consent are committed
together only when onboarding finishes. Its queued `users` operation is bound to the
authenticated Supabase user ID at sync time, allowing onboarding to work before an
account exists without inventing a remote owner.

The onboarding body baseline is a normal local `wellness_logs` row and is queued in
the same transaction as the profile. Height and optional body-fat details live in
the row's structured metadata; body weight remains canonical kilograms.

## Wellness chat cache

`ai_conversations` and `ai_messages` mirror the active wellness thread on device.
Prior user and assistant messages remain readable without a connection. A new AI
reply is deliberately different from a manual check-in: the client requires a
signed-in connection, writes and queues the user message locally, drains current
context to Supabase, and only then invokes the authenticated `wellness-chat` Edge
Function. The returned assistant message is cached locally but is not re-queued,
because the trusted function has already written it remotely.

Each pending user message reserves a stable assistant-message UUID. If the provider,
network, or local cache step fails, the same request can be retried idempotently.
The client prevents a newer prompt from overtaking an unresolved reply so message
sequence numbers cannot diverge between SQLite and Postgres.

The first-use medical disclaimer acknowledgement follows the profile queue path and
must reach Supabase before the Edge Function will send context to the AI provider.
The function reads recent structured rows through the signed-in user's RLS scope;
the service role is used only to write the assistant-role message that clients are
not permitted to forge.
