---
name: supabase-schema
description: JIEN's Supabase Postgres schema and Row Level Security conventions. Use for migrations, table or column changes, database queries, generated types, storage policies, and any code that reads or writes synced cloud data.
---

# JIEN Supabase schema

Treat `/docs/schema.md` as the human-readable source of truth and `supabase/migrations/` as the executable history.

## Conventions

- Read `/docs/schema.md` before changing the data model and update it in the same change.
- Use lowercase `snake_case`, UUID primary keys, `timestamptz`, and UTC timestamps.
- Give every user-owned row a non-null `user_id` tied to `auth.users(id)`.
- Enable RLS on every application table in the migration that creates it.
- Scope every client policy with `(select auth.uid()) = user_id`; never trust a client-supplied owner without an RLS check.
- Prefer explicit foreign-key delete behavior and document intentional cascades.
- Use `created_at`, `updated_at`, and nullable `deleted_at` for syncable entities. Treat `deleted_at` as a tombstone, not an immediate hard delete.
- Add indexes for foreign keys, sync cursors, and common time-range queries.
- Keep API keys and service-role secrets out of tables and client code.
- Route all client data access through `/lib/db`.
