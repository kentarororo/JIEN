# Food library, community catalogue and training entry points

## This increment

- Training presents Log workout and Log cardio together above Overview/History.
- Private foods retain name, optional brand and barcode, serving and label macros.
- Save as private food / Update private food writes SQLite and its sync queue in one
  transaction. The meal is still saved separately; meal edits do not change a product.
- Local search includes private foods by name, brand or exact barcode. Barcode lookup
  prefers a saved private match, then cached provider products, then online lookup.
- Create food with this barcode carries the entered code into an editable blank food.
- Existing custom foods migrate without deleting the original cache copy. Cloud
  restore, JSON export and account deletion include the new library.
- Share with community explicitly publishes food details to all signed-in accounts
  after successful sync. Offline publication is queued, not already visible. Stop
  sharing queues withdrawal; ordinary edits retain the current visibility.
  Withdrawal changes visibility only, not unfinished meal edits. Outbox responses
  acknowledge only the exact payload sent: an in-flight publication cannot erase
  a newer queued withdrawal or mark that newer edit as failed.
- Community entries are labelled unverified. The UI does not offer publication for
  provider results or AI estimates. Contributors must check labels/recipes and have
  the right to publish their data; this is not automatic accuracy/licensing review.
- Online community search supports name + brand terms and exact barcode. Community
  discovery is not cached, so withdrawal/moderation applies on the next search.
  Nutrition already saved in someone's private meal history remains unchanged.

## Privacy and storage architecture

`public.private_foods` is the owner library, despite its optional sharing setting.
Direct access remains owner-only under RLS. An authenticated `search_community_foods`
RPC returns published name, brand, barcode, serving and nutrition only. It never
returns contributor identity, private catalogue identity, meal dates, notes, photos
or activity timestamps. It excludes tombstones, withdrawals and server-moderated
`community_hidden` entries. Clients cannot change that moderation flag. Deleting a
contributor account removes its catalogue entries; other people's saved nutrition
snapshots remain their own records. Existing private foods never publish automatically.

## Release order

1. Apply `supabase/migrations/20261008000100_private_foods.sql` in the project's
   Postgres SQL Editor (not Logs Explorer), or through the normal migration workflow.
2. Verify with two disposable accounts: only published fields are discoverable by B;
   B cannot read/edit A's owner rows; anonymous RPC access is rejected; withdrawal,
   moderation and account deletion remove the result. Test actual Postgres grants.
3. Deploy the web/native client. Do not deploy it before the table exists: missing
   schema pauses sync rather than silently claiming a backup.
4. Verify offline save -> reconnect -> second-device restore and community discovery.
   Local/HTTP-mocked QA is not a live RLS audit.

No migration or deployment is performed automatically by this implementation.

## Catalogue boundaries

Meal logs are private account records; provider discovery results remain a local
read-through cache. A food becomes reusable account data through Save private food.
The community catalogue is a shared product library, not a public feed of members'
meals or a complete replacement for all nutrition-app features. Community values
remain unverified until a real review process exists. Never present personal meal
history, photos or AI estimates as verified product data.

Remaining usability work: a dedicated My foods manager (edit/remove without starting
a meal), recipes, local aliases/regional metadata, duplicate/barcode resolution,
label evidence, user reports, moderation UI, rate limiting and revision history.
Multiple entries can share a barcode: own foods take precedence locally; community
matches have stable name/ID order. The first match is not necessarily authoritative.

SQLite is persistent (including the browser persistence adapter), but browser data
can be evicted or cleared. Account backup exists only after successful sync.
Signed-out/local-only use is not a cloud backup.

## Validation — October 8, 2026

- Full standard test command: 366 passing test executions (8 + 10 + 21 + 327).
- Typecheck passes. Production-mode web export produces 29 routes using isolated
  QA Supabase configuration; this is not a Vercel deployment.
- SQLite integration covers legacy backfill, rollback on outbox failure, stable
  identity, cloud restore/stale-write rejection/tombstones, export and account reset.
- Browser integration covers main cardio actions in both Training views, reload,
  offline barcode reuse, explicit sharing and an in-flight publication followed by
  withdrawal. Synthetic HTTP fixtures do not establish real cross-account RLS.
- Final full browser run: **51 passed, 11 existing profile-specific skips, 1 failed**.
  Both new journeys passed on desktop Edge, Android-emulated Chromium and iOS WebKit.
  The remaining failure is `meal-photo.spec.ts` on iOS WebKit: the mocked analysis
  request received an empty description after `Synthetic cereal label` was entered.
  This is unresolved, not a green whole-app release. No real Gemini request was made.
- An earlier full browser run hit three iOS/WebKit interaction timeouts in existing
  scheduling/meal-details journeys. No timeouts, assertions or skips were weakened.
  Those journeys passed in the final run; the intermittent interaction risk remains.
  Keep physical-device touch and interruption testing in the release gate.
