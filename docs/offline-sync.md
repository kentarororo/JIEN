# Offline sync

## Contract

SQLite is the source of truth for manual logging and planning. Each workout plan,
completed workout, meal, target,
wellness measurement or check-in, user-authored AI message, or notification
preference write and its `sync_queue` upsert is committed in the same SQLite
transaction. UI success for manual logging never waits for the network.

Client-generated UUIDs make retries idempotent. One queue row is retained per
`(table_name, entity_id)`, so a newer local edit replaces an older queued payload.
Parents are pushed before children. Transient failures use bounded exponential
backoff (one minute base, one hour maximum) with +/- 25% jitter so multiple devices do
not retry in lockstep. The next-attempt timestamp is persisted, preventing app
foreground or connectivity events from creating a tight retry loop.

Failures are reduced to stable, non-sensitive categories before they are stored or
shown. Network interruptions, timeouts, HTTP 408/429, and server 5xx responses are
transient. Authentication/session failures, RLS or authorization denials, invalid
payloads, schema mismatches, and missing configuration require action. Their queue
rows are retained with `retry_paused = 1`; they are not discarded and background
events do not repeatedly submit them. A newer local edit resets the row because it
replaces the queued payload. **Sync now** or a new authenticated session deliberately
unpauses the row so an account, schema, or app-state correction can be tested.

## Runtime states

| State | Meaning | User-facing behavior |
| --- | --- | --- |
| `synced` | Queue processed or already empty | Show the processed count |
| `offline` | No usable connection | Keep all rows queued locally |
| `not_configured` | Supabase public environment is absent | Local mode remains available |
| `signed_out` | No authenticated owner | Offer account entry; retain queue |
| `partial` | Some rows synced before a retryable failure | Show the error and retry later |
| `action_required` | A queued row needs sign-in, permission, schema, configuration, or payload attention | Keep it paused and queued; show a safe next step and allow a deliberate retry |
| `account_conflict` | The signed-in user differs from the device owner | Sign out and do not upload or merge records |

The app attempts sync at startup, after authentication, when returning to the
foreground, when connectivity returns, and when the user chooses **Sync now**.

On web, wa-sqlite runs on the main thread with `IDBBatchAtomicVFS`, avoiding Expo's
OPFS access-handle worker. The VFS commits page versions atomically to strict-durability,
account-scoped IndexedDB storage; SQLite transactions still contain local rows, the
outbox, pull cursors, and device-only photo jobs. Web Locks fence stale tabs. On the
first v2 open, a valid older account-owned snapshot can be copied page-by-page into
the new VFS without deleting either the legacy snapshot or any OPFS bytes. Native
SQLite persistence is unchanged. See `web-tester-runtime.md` for startup and teardown.

Planned workouts use the same `workouts` queue row as completed sessions. Their
versioned `plan_json` contains the previous-set snapshot and separate deterministic
progression cues needed to start offline. Completing a plan updates that same UUID
to `completed` and inserts observed sets in one SQLite transaction; skipping or
deleting it writes a status change or tombstone through the same queue.

## Conflict rule

Queued payloads carry `client_updated_at`. The Supabase update trigger keeps the
existing row if its logical timestamp is newer, providing last-write-wins behavior
for delayed offline writes. This remains an intentionally simple conflict rule, but
bidirectional restore now makes the profile, workouts, nutrition, wellness,
notification preferences, and cached AI history available on another signed-in
device.

After queued writes are pushed, the client pulls owned tables into SQLite in
parent-before-child order. Each table uses a stable `(client_updated_at, id)` cursor
stored in `app_settings`; the cursor advances in the same transaction as the rows.
JSON and array values are serialized for SQLite, booleans become `0/1`, tombstones
are retained, and remote data only replaces a local row when its logical timestamp
is at least as new. A full reconciliation runs at least daily so a late upload
created offline with an older client clock cannot be missed permanently by the
incremental cursor.

Soft-deletion tombstones use the same queue path. Hard delete is reserved for
privileged maintenance outside the client.

## Local onboarding profile

`user_profile` is a singleton SQLite mirror for onboarding answers. Goals, available
equipment, injury or joint considerations, diet pattern, and AI consent are committed
together only when onboarding finishes. Its queued `users` operation is bound to the
authenticated Supabase user ID at sync time, allowing onboarding to work before an
account exists without inventing a remote owner.

The first authenticated user ID is stored locally as `cloud_owner_user_id`. Signing
out does not remove offline records. A different account is blocked from sync until
an explicit future account-switch/reset flow exists, preventing accidental
cross-account health-data merges.

## Portable export boundary

The full JSON export is a versioned, deterministic envelope over active/current
SQLite records. It contains the onboarding profile, the exercise catalogue needed
to interpret sets, workouts and sets, meals and food-item provenance, nutrition
target history, wellness/body measurements, AI conversations and messages, and
notification preferences. Structured SQLite JSON columns are emitted as JSON arrays
or objects rather than encoded strings.

The envelope records `schemaVersion`, `generatedAt`, local database schema version,
and the cloud owner ID when present. Tombstones are intentionally excluded for a
user-readable export and this policy is declared as `active_records_only`. Auth
tokens, Supabase keys, raw sync queue payloads/errors, pull cursors, browser storage,
and device-only scheduled notification identifiers are never selected. CSV export
contracts remain unchanged.

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

## Offline meal-photo queue

Compressed meal photos and typed context can be placed in the device-only
`meal_photo_jobs` queue without blocking manual meal entry. On web, raw photo bytes
live in a separate account-scoped IndexedDB payload store; SQLite retains only a
small reference so full-database snapshots cannot exhaust mobile Safari/WASM memory.
Legacy inline web jobs are externalized at runtime before sync/analysis. Raw image data never
enters the generic Supabase sync queue or portable export. When a signed-in
connection and AI consent are available, the runtime checks capability before any
photo upload, analyzes one job at a time, strictly parses the response, clears the
raw image, and exposes the editable result from the Food screen.

Transient failures use bounded one-to-sixteen-minute exponential delays and stop
after five attempts. Authentication, consent, and provider-configuration failures
remain visible as action-required rather than retrying in a loop. Processing rows
older than five minutes are safely reclaimed after an interrupted app session.

## In-progress core-loop recovery

On authenticated web builds, workout and meal forms keep a small, account-scoped
recovery draft so a mobile-browser refresh does not discard an unfinished log. Meal
drafts include editable portions, macros, and AI provenance, but never raw photo
bytes, auth material, or search state. A queued photo continues to use the separate
IndexedDB payload store described above. Recovery keys include the signed-in user
UUID and logging context, and are removed only after the corresponding SQLite write
commits successfully. Reminder reconciliation is best-effort after that commit so a
notification failure cannot invite a duplicate meal retry.
