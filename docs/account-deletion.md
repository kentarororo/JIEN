# Account deletion

JIEN exposes permanent account removal under **Settings > Data**, after the export
controls. The user must expand the destructive panel and type `DELETE`; no account ID
is sent by the client or accepted by the server.

## Ordered deletion

1. The client sends a version 1 request through the authenticated `delete-account`
   Edge Function contract.
2. The function verifies the bearer token and derives the owner from
   `auth.getUser(token)`.
3. The service role calls `delete_user_ai_credential` first. Its database trigger
   deletes the corresponding encrypted Supabase Vault secret.
4. The service role hard-deletes that Auth user. Foreign keys cascade through the
   public profile, workouts, sets, exercises, meals, foods, nutrition targets,
   wellness logs, AI history, notification preferences, and retained private usage
   rows.
5. Only after that success response, the client cancels scheduled operating-system
   notifications, clears account-scoped browser meal-photo payloads, and atomically
   resets SQLite.
6. The SQLite transaction removes account records, queued sync work, owner/cursor
   settings, diagnostics, custom exercises, private foods, and cached search results,
   then restores the 132 built-in exercises and 18 built-in food entries.
7. Local Supabase authentication is cleared last so the database provider remains
   mounted until cleanup completes.

The local database file is not dropped, OPFS is not touched, and no unrelated browser
storage is cleared. Regular sign-out still preserves offline data.

## Failure and retry rules

- If authentication, connectivity, confirmation, credential removal, or Auth deletion
  fails, the server does not confirm success and the local database remains intact.
- If cloud deletion succeeds but device cleanup fails, Settings states that the cloud
  account is already gone and offers **Finish clearing this device**. That retry does
  not repeat the cloud request.
- Local SQLite removal and built-in catalog reseeding share one exclusive transaction,
  so a failed transaction restores the pre-cleanup database image.
- Exports are generated before deletion only at the user's explicit request. They are
  not uploaded by the deletion workflow.

## Verification

The database integration test populates account records, resets them, verifies every
personal table is empty, confirms catalog counts and schema version, and runs SQLite
integrity and foreign-key checks. Browser QA performs deletion through Settings,
signs the same isolated identity back in, completes onboarding, and verifies the old
workout does not return.
