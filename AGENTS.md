# JIEN — shared rules for every agent

This is the one rulebook for everyone working in this repo: Codex, Grok, Claude and
Ken. If a tool-specific file (`CLAUDE.md`, `.codex/`) disagrees with this file, this
file wins. Change the rules here, not in copies.

## What this is
A cross-platform (iOS, Android, web) fitness and wellness app, built solo. The core
differentiator is a holistic AI layer that unifies lift tracking, diet tracking, and
free-form wellness input (feeling, injury, sleep, health-app data) into one adaptive
system. Most competitors (Hevy, Strong, MyFitnessPal, Cronometer) only cover one
slice and don't talk to each other. That gap is the product.

Full feature spec: `PROJECT_BRIEF.md`. Current milestones: `docs/roadmap.md`.

## Stack
- Client: Expo (React Native + Expo Router), TypeScript, pnpm
- Local data: SQLite on-device (source of truth for offline-first), background sync to Supabase
- Backend: Supabase (Postgres, Auth, Storage, Edge Functions)
- AI: provider-neutral Gemini/Anthropic adapters, called ONLY from Supabase Edge
  Functions, never directly from the client
- Subscriptions: RevenueCat
- Health data (phase 3+): react-native-health (iOS), react-native-health-connect
  (Android). Native only, requires a custom dev client, not available in Expo Go
- Export/backup (phase 3+): CSV/JSON generation client-side; optional sync to a real
  Google Sheet in the user's Drive via the `drive.file` OAuth scope only

## Core design decisions — do not relitigate without asking Ken
1. **Progression is volume-based, not 1RM-based.** Track total volume (sets × reps ×
   load) per muscle group per week. Progress via double progression within target rep
   ranges. Never build a max-effort or 1RM-testing flow.
2. **The progression engine is deterministic and runs fully offline**, client-side, as
   pure math over locally logged sets. It does not call the AI or need a network.
3. **The AI layer is separate and network-dependent.** It explains, contextualises and
   adapts tone/pacing based on subjective signals (soreness, sleep, mood, injury flags).
   It does not invent the underlying volume numbers. Offline, the app shows a clear
   "AI needs a connection" state, never a silent failure.
4. **Notifications are core from phase 1.** Contextual and opt-in only, no generic
   daily "log your food" nags.
5. **Export is a real Google Sheet, not a generic backup dump** (fixed template:
   Workouts tab, Nutrition tab) under the `drive.file` scope.

## Conventions
- All data access through `src/lib/db`. No raw fetch calls scattered through screens
- Every screen has loading, empty and error states. No bare happy path
- Every write hits local SQLite first, then queues for Supabase sync. Never block a
  write on network
- Small commits, one feature per commit
- Table structure lives in `docs/schema.md`. Update it before adding or changing
  tables; don't let it drift from the migrations
- Domain playbooks live in `.codex/skills/<name>/SKILL.md` (api-conventions,
  design-system, notification-design, offline-sync, progression-algorithm,
  supabase-schema). Every agent, not just Codex, reads the relevant one before
  touching that area

## Legal / compliance
- Every AI-generated training or nutrition suggestion carries a visible "not medical
  advice" disclaimer, shown at first use and reachable from settings at all times
- Sleep, injury and diet data are sensitive. Singapore PDPA applies from the first
  line of user data written. Confirm consent copy before shipping a write path
- This repo is **public**. Never commit keys, tokens, `.env` files, real user data or
  screenshots containing personal data

## Never
- Call an AI provider directly from the client
- Add a new npm dependency without checking Expo managed-workflow compatibility first
- Build a 1RM-chasing or max-effort-testing feature
- Request the broad Google `drive` scope (`drive.file` only)
- Push to `main`, or merge a PR outside the merge rule below. `main` deploys straight
  to the live web app

---

## Team and roles

| Who | Role | Owns | Branch prefix |
|---|---|---|---|
| **Ken** | Product owner | Priorities, taste, final call, **merging "taste" PRs** | — |
| **Claude** | Project manager | Issues, acceptance criteria, `docs/roadmap.md`, weekly review, **merging "easy" PRs** | `claude/` |
| **Codex** | Dev | Feature code, migrations, `docs/schema.md` | `codex/` |
| **Grok** | Tester + assistant dev | Test code (`**/*.test.ts`, `**/*.test.mjs`, `e2e/`), PR verification, small assigned tickets | `grok/` |

Agents don't talk to each other directly. **GitHub issues and PRs are the handover.**
If it isn't written on the issue or PR, the next agent doesn't know it.

## The loop (one feature)

1. **Ken → Claude.** Ken describes what he wants. Claude opens an issue from the
   *Task* template: goal, acceptance criteria, files in scope, out of scope. Labels:
   `agent:codex` (or `agent:grok` for a test/assistant ticket).
2. **Codex builds.** Branch `codex/<issue#>-<short-slug>` from latest `main`.
   Implement, run `pnpm typecheck` and `pnpm test`, open a PR with `Closes #<issue#>`,
   fill the PR template, add label `needs-test`.
3. **Grok verifies.** Check out the PR branch. Run `pnpm typecheck`, `pnpm test`, and
   the relevant `pnpm e2e:web` spec if UI changed. Check every acceptance criterion and
   the rules above. Add missing tests as `test:` commits on the same branch (test
   files only). Post one PR review comment with the verdict (format below).
4. **Fix round.** If the verdict is CHANGES, Codex fixes on the same branch and
   re-labels `needs-test`. Repeat step 3.
5. **Merge** (squash), per the merge rule below. Claude updates `docs/roadmap.md` if a
   milestone moved.

### Merge rule
**Claude merges** a PR when all of these hold: Grok's latest verdict is PASS on the
latest commit; the PR check is green; no database migration (`supabase/migrations/`);
no new npm dependency; no change to the core rules in this file; and it does only what
its issue's acceptance criteria already agreed. Claude merges oldest first, in batches,
and posts one line per merge for Ken.

**Ken merges** everything else: migrations (he applies them in Supabase first), new
flows or screens where look and feel is a judgement call, feature behaviour beyond the
agreed criteria, app direction and priorities, privacy/consent copy, money and store
decisions. If in doubt, it goes to Ken.

### Keeping the queue moving
- The work order lives in `docs/roadmap.md` under **Next up**. Pull from it; don't wait
  to be assigned.
- **Codex:** before starting anything new, fix any of your PRs with a CHANGES verdict.
  Then take the next open, unblocked item in your list. After opening a PR, go straight
  to the next item; don't stop until the list is empty or blocked.
- **Grok:** the routine tests every `needs-test` PR. Between runs, work your list.
  End each verdict with a **How Ken checks it** line: two or three taps on the live app
  after merge, since Vercel previews ask for a login.
- Blocked on a decision? Comment on the issue, add `needs-ken`, and move on to the next
  item instead of waiting.
- Skill packs such as pstack are welcome for *how* you work (TDD, prove it runs, fix
  root causes). This file still decides *what* gets built and the rules.

### Grok's verdict format
```
Verdict: PASS | CHANGES
Checked: typecheck ✓/✗ · unit tests ✓/✗ · e2e <spec> ✓/✗/n/a
Acceptance criteria: 1 ✓ · 2 ✓ · 3 ✗ (why)
Rule checks: offline-first ✓ · loading/empty/error states ✓ · no client AI calls ✓ · disclaimer n/a
Tests added: <files or "none">
Merge: easy | taste (why)
Findings (most severe first):
- <file:line> — what breaks, how to reproduce
```

### Labels
- `agent:codex` / `agent:grok` / `agent:claude`: who picks this up
- `needs-test`: PR is ready for Grok
- `needs-ken`: blocked on a decision, or ready to merge

### Working on the same branch
- Codex owns non-test files on a `codex/` branch; Grok only touches test files there
- Always `git pull --rebase` before you push
- Never force-push a branch another agent has committed to
- If you need to change something outside your lane, say so in the PR instead

## Definition of done
- [ ] `pnpm typecheck` and `pnpm test` pass (the PR check enforces this)
- [ ] Every acceptance criterion on the issue is met
- [ ] Loading, empty and error states exist for any new or changed screen
- [ ] Writes go local-first; offline behaviour checked
- [ ] `docs/schema.md` updated if tables changed
- [ ] Any new AI output shows the "not medical advice" disclaimer
- [ ] No secrets or personal data committed
- [ ] Grok's verdict is PASS

## How Ken starts each agent
From the repo folder on his desktop, one line is enough because this file carries the
rest:
- **Codex:** `Work issue #<n> as dev per AGENTS.md.`
- **Grok:** `Test PR #<n> as tester per AGENTS.md.`
- **Claude:** `Turn this into an issue: <idea>` or `Weekly JIEN review.`

Local tool setup and how to check what's installed: `docs/agents/local-setup.md`.
