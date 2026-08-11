---
name: offline-sync
description: JIEN's SQLite-first persistence and Supabase background-sync pattern. Use for any data-write feature, local repository, sync queue, conflict handling, connectivity behavior, or offline state.
---

# JIEN offline sync

Treat local SQLite as the on-device source of truth for manual logging. A network round trip must never gate a user write.

## Write path

1. Validate and normalize the input locally.
2. In one SQLite transaction, write the entity and enqueue an idempotent sync operation.
3. Update UI from local data immediately.
4. Drain the queue in the background when connectivity is available.
5. Mark success only after Supabase acknowledges the mutation; retain retry metadata on failure.

## Queue and conflict rules

- Use client-generated UUIDs and idempotent upserts.
- Include operation type, entity table, entity ID, serialized payload, attempt count, next-attempt time, creation time, and last error.
- Retry transient failures with bounded exponential backoff and jitter. Do not retry auth or validation failures indefinitely.
- Resolve conflicts last-write-wins using `updated_at`; use `deleted_at` tombstones so deletes sync safely.
- Process related parent rows before children and preserve failed operations for inspection.
- Expose useful sync state without blocking logging.

## Network-dependent features

- Queue offline food photos for later upload and processing.
- Cache prior AI responses for reading.
- Show an explicit "AI needs a connection" state for new AI requests.
