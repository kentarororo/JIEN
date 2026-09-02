# App recovery diagnostics

JIEN records a deliberately small recovery history after the local SQLite database
has opened. This helps a person confirm that the app recovered without creating a
second copy of their health or account data.

## Data boundary

The `runtime_diagnostics_v1` setting contains only:

- a schema version and total error count;
- the first and latest timestamps; and
- the latest stable recovery code: `LOCAL_STORAGE_ERROR`, `DATA_FORMAT_ERROR`, or
  `UI_RENDER_ERROR`.

Raw exception messages, component stacks, routes, record identifiers, account
details, and training, nutrition, wellness, or AI content are never written to this
history. It remains in the device's SQLite `app_settings` table, is not placed in the
sync queue, and is not included in the full-data export. Development builds may log
raw exceptions to the local developer console; production builds log only the stable
recovery code.

The Settings > Data > App recovery panel explains the boundary and can delete this
single local setting. Clearing it does not clear SQLite, IndexedDB, OPFS,
authentication, queued sync work, or any user record.

## Recovery boundary

The startup boundary catches failures before SQLite is available and therefore shows
a stable code without attempting to persist it. Once SQLite has opened, a nested
runtime boundary records the privacy-safe summary. Retrying the screen resets only
the React error state; it does not retry, delete, or rewrite stored records.

Remote crash reporting remains a later release decision. It requires a separate
privacy review and an explicit scrubbed event contract rather than sending raw
exceptions from this local history.
