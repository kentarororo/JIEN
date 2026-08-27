# JIEN product voice

JIEN uses direct, factual interface language. Copy should read like a well-designed
tool: clear about the current state, specific about consequences, and explicit about
the next available action.

## Core pattern

Write interface messages in this order when the information applies:

1. **State:** what happened or what is available.
2. **Consequence:** what changed, or what did not change.
3. **Action:** what the person can do next.

For example: `Another page still has local storage open. No local data was deleted.
Wait a moment and retry.`

## Rules

- Use short, sentence-case labels built from familiar product terms.
- Name the record, value, or process instead of referring vaguely to “this,” “it,” or
  a “next step.”
- Describe safeguards as verifiable outcomes: `No records were deleted` is better than
  `Your data is safe`.
- Keep JIEN as the product name, not a character. Prefer `Progression suggestions
  appear below the set` to `JIEN will guide you`.
- Avoid motivational filler, implied judgment, and assistant-style phrases such as
  `next small win`, `when you are ready`, `starts here`, or `make it your own`.
- Use `AI` only when the distinction matters. Name the provider, transmitted context,
  consent requirement, cost boundary, and model limitation precisely.
- Keep health language neutral. Report logged values and uncertainty without claiming
  diagnosis, recovery, safety, or expected outcomes.
- Error copy must preserve the technical distinction between retryable, blocked, and
  destructive states. Rewriting tone must never weaken a safety or consent boundary.

## Engineering enforcement

`scripts/ui-copy-quality.test.mjs` scans product copy for known personified and generic
assistant phrases. It runs in `pretest`, alongside the feature-level UI contract tests.
The automated list is deliberately narrow: reviews must still apply the principles
above to new copy that is technically allowed but unclear.
