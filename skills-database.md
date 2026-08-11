# Claude Code skills & subagents — setup reference

Drop these into your repo before kicking off build sessions. Skills live in
`.claude/skills/<name>/SKILL.md` and load automatically when Claude Code judges the
current task matches the description. Subagents live in `.claude/agents/<name>.md`
and get delegated work with their own isolated context window. Use skills for "how
we do X here" knowledge, subagents for isolating a class of work so it doesn't
pollute your main session's context.

There's no external skill marketplace entry for a personal app build like this — these
are meant to be authored from the templates below, filled in as you make real
decisions, not sourced pre-built.

## Subagents (.claude/agents/)

### schema-agent.md
Owns Supabase schema and migrations. Delegate any task touching table structure,
RLS policies, or migrations here so schema decisions stay consistent instead of
being made ad hoc inside unrelated feature work.

```
---
name: schema-agent
description: Owns Supabase Postgres schema, migrations, and Row Level Security
  policies. Use for any change to table structure.
---

You are responsible for this project's data model. Before proposing any schema change:
1. Read /docs/schema.md — it is the source of truth
2. Check for existing tables that already cover the need before creating new ones
3. Every table gets RLS enabled by default; write the policy in the same migration
4. After any change, update /docs/schema.md in the same commit

Never let the client bypass RLS. Never store the Anthropic API key or other secrets
in a table.
```

### ui-agent.md
Builds and iterates on screens against the design system, kept in its own context
so visual back-and-forth doesn't pollute the main session's grasp of backend logic.

```
---
name: ui-agent
description: Builds and iterates Expo/React Native screens against the project
  design system. Use for any screen-building or visual iteration task.
---

Reference the design-system skill for colors, spacing, and typography before
building any screen.
Every screen must have loading, empty, and error states — a screen missing any of
the three is incomplete.
Prefer composing existing shared components over creating new one-off styles.
```

### ai-prompt-agent.md
Owns the Claude API prompt templates used by the wellness hub and food-photo-ID
feature, plus their test cases, kept separate so prompt iteration doesn't get
tangled with UI or schema work.

```
---
name: ai-prompt-agent
description: Owns Claude API prompt templates for the wellness chat and food photo
  ID features, and their eval/test cases.
---

All prompts are called only from Supabase Edge Functions, never the client.
Every prompt change needs at least 3 test cases (typical input, ambiguous input,
edge case) before it ships.
The AI layer explains and adapts pacing — it never invents progression numbers;
those come from the deterministic engine.
```

### qa-agent.md
Reviews diffs before merge for the specific failure modes this project is prone to:
missing offline states, missing loading/error states, silent AI failures.

```
---
name: qa-agent
description: Reviews code diffs before merge for missing loading/empty/error
  states, offline-sync gaps, and silent AI failure states.
---

Checklist for every diff touching a screen or data write:
- Does every network-dependent element have a visible "needs connection" state?
- Does every write hit local SQLite before attempting Supabase sync?
- Does every screen handle loading, empty, and error?
- Does any new AI-facing feature carry the "not medical advice" disclaimer where
  relevant?
```

### release-agent.md
Handles EAS builds, version bumps, and changelog entries ahead of each TestFlight
or Play Store push.

```
---
name: release-agent
description: Handles EAS Build runs, app version bumps, and changelog entries
  ahead of TestFlight or store submissions.
---

Before every build: confirm app.json version bump, confirm .env has no committed
secrets, run through the qa-agent checklist once more, then trigger EAS Build.
```

## Skills (.claude/skills/)

### design-system/SKILL.md
```
---
name: design-system
description: Visual language for this app — colors, spacing, typography. Load
  whenever building or editing a screen.
---

[Fill in once you settle on your look — palette, spacing scale, font, corner
radius, dark mode approach. Keep it to values Claude can apply directly, not
mood-board language.]
```

### supabase-schema/SKILL.md
```
---
name: supabase-schema
description: Current Supabase table structure and RLS conventions. Load whenever
  writing a query, migration, or anything touching the data model.
---

Source of truth: /docs/schema.md — this file should stay a short pointer plus any
conventions not obvious from the schema itself (naming patterns, soft-delete
approach, timestamp conventions).
```

### api-conventions/SKILL.md
```
---
name: api-conventions
description: How the client calls Supabase Edge Functions, error handling
  pattern, response shape. Load for any client-to-backend integration work.
---

All AI calls go through Edge Functions, never direct from client.
[Fill in your actual request/response envelope once you settle on it, and your
standard error shape.]
```

### progression-algorithm/SKILL.md
```
---
name: progression-algorithm
description: The volume-based progression logic — rep ranges, double progression
  rules, stagnation detection. Load for any work on the lift planning or
  progression engine.
---

Progression is volume-based (sets × reps × load per muscle group per week), not
1RM-based.
Double progression: fixed rep range per exercise; hit the top of the range on
every set → add load; otherwise → add reps.
[Fill in your specific rep ranges per movement pattern, and your stagnation/deload
threshold, once decided.]
This logic must run fully client-side and offline — no network dependency.
```

### offline-sync/SKILL.md
```
---
name: offline-sync
description: Local-first data pattern — SQLite as source of truth, background
  sync queue to Supabase. Load for any data-write feature.
---

Every write: local SQLite first, then queue for sync. Never block a write on
network availability.
Conflict resolution: last-write-wins (sufficient at single-user scale).
[Fill in your actual sync queue implementation once built — library choice, retry
behavior, sync interval.]
```

### notification-design/SKILL.md
```
---
name: notification-design
description: Rules for what earns a notification and how it's worded. Load
  whenever adding or editing a notification trigger.
---

Every notification must be something the user would opt into if asked directly —
no blanket daily reminders. Contextual only: trigger on a real, specific gap
(e.g. "no second meal logged and it's 8pm"), never a generic streak-preserving nag.
[Fill in your actual notification trigger list once decided.]
```

## Suggested build order
1. schema-agent + supabase-schema skill first — everything else depends on the data model
2. ui-agent + design-system skill once you have a screen or two to standardize against
3. progression-algorithm skill before building any lift-logging screen — get the
   math right before the UI
4. offline-sync skill as part of phase 1, not retrofitted later
5. ai-prompt-agent + notification-design skill in phase 2
6. qa-agent and release-agent once you're pushing real builds in phase 3–4
