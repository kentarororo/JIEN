# JIEN product visual direction

JIEN uses **Warm Utility**: a calm, tactile training log with cream, royal-brown,
wood, sage, and ochre semantic tokens. The product should feel authored and
practical, not like a generic AI dashboard or a decorative fitness template.

## Moodboard consensus

The useful patterns from the app moodboard are structural rather than cosmetic:

- lead daily screens with a compact seven-day rhythm and reveal the full month on demand;
- give each screen one dominant purpose and one clearly primary action;
- use compact icon-led rows and two-column tiles for secondary actions;
- reveal analytics, history, and large taxonomies progressively;
- prefer whitespace, alignment, and tonal surfaces over nested accent borders;
- keep copy factual, short, and sentence case;
- preserve detailed records while reducing how many controls appear at once.

JIEN should not copy the moodboard's candy colors, decorative 3D objects, or
image-heavy presentation. The existing Warm Utility palette is the identity;
the moodboard informs hierarchy, density, and pacing.

## Product application

- **Today:** date, workout/meal actions, week strip, selected-day status, then summaries.
  The full calendar and itemized day workspace remain one action away.
- **Training:** the next action and overview come first; searchable history is a peer view,
  not the bottom of a long analytics feed.
- **Exercise targets:** search and review remain fast; duplicate or invalid mappings show a
  reason; the editor reveals one muscle region at a time while preserving every option.
- **Food and Wellness:** lead with the current day's state and a single logging action;
  historical detail and educational explanations stay available through disclosure.

## Visual rollout

The visual system should be proven in complete product slices, then reused rather than
re-skinning every route independently:

1. **Today:** establish the expressive daily canvas, factual signal tiles, primary-action
   weighting, and week-first rhythm.
2. **Training and workout logging:** carry the same hierarchy into the next-session cue,
   active set entry, and progression review without reducing logging density.
3. **Food and Wellness:** reuse the daily canvas and signal tiles for fuel, recovery, and
   check-ins while keeping clinical or nutrition detail quiet until requested.
4. **History and settings:** finish with calmer utility treatments; these screens should
   feel related without competing visually with daily actions.

The standout quality comes from composition, useful numbers, and deliberate contrast—not
additional colors, gradients, or decorative illustrations.

### Alpha 2.1 quality gate

History and Settings complete the current visual rollout. Settings groups general
preferences, reminders, and account/data controls without removing any capability;
training history retains search, muscle filters, and direct record access. The slice is
accepted only after the isolated browser loop in [browser-qa.md](browser-qa.md) passes,
including real IndexedDB persistence, newer-tab handoff, supported widths, light/dark
visual baselines, and programmatic form labels.

## Acceptance bar

- no horizontal overflow at 360, 390, 768, or 1280 CSS pixels;
- one level-one heading per screen and logical level-two sections;
- every interactive target is at least 44 by 44 points;
- visible pressed, disabled, busy, and keyboard-focus states;
- light and dark themes use semantic tokens only;
- no local record, draft, sync, or completed-workout behavior changes for visual polish.

All visible language also follows [the JIEN product voice](product-voice.md).
