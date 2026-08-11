# Offline sync

## Contract

SQLite is the source of truth for Phase 1 logging. Each workout, meal, target, or
notification-preference write and its `sync_queue` upsert are committed in the same
SQLite transaction. UI success never waits for the network.

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
