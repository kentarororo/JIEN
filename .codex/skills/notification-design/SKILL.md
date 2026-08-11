---
name: notification-design
description: Product and implementation rules for JIEN notifications. Use when adding or changing notification permissions, preferences, scheduling, triggers, eligibility checks, copy, deep links, or delivery telemetry.
---

# JIEN notification design

Send only contextual, opt-in notifications tied to a real and current user need. Do not use generic streak or retention nags.

## Eligibility gate

A notification may be scheduled only when all are true:

1. The specific category is enabled by the user.
2. Current local data proves the trigger condition.
3. The message is still actionable at delivery time.
4. Quiet hours, cooldowns, and platform permission state allow it.
5. An equivalent notification is not already pending or recently delivered.

## Initial categories

- Meal gap: the user opted in, has an established multi-meal pattern, and a normally logged meal is missing late in their chosen day.
- Planned workout: the user opted in and a planned session is approaching; cancel when it is started, completed, skipped, or rescheduled.
- Sync attention: user action is required after persistent auth or validation failure; do not notify for ordinary transient retries.

## Copy and behavior

- State the observed context and the useful action in plain language.
- Avoid shame, urgency inflation, body judgment, or medical claims.
- Deep-link to the exact relevant flow.
- Re-check local eligibility before scheduling and cancel stale notifications after any related write.
- Keep categories independently configurable and store only necessary notification state.
