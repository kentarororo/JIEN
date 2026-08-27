---
name: design-system
description: Visual language and UI implementation rules for JIEN. Use whenever designing, building, or reviewing an Expo Router screen, shared component, navigation treatment, theme token, typography, spacing, color, or interaction state.
---

# JIEN design system

Apply the chosen token set from `src/theme/` rather than embedding visual values in screens.

## Required workflow

1. Read the current tokens and component primitives before editing UI.
2. Do not build a product screen until the initial visual direction has been approved and recorded here.
3. Reuse shared components before adding one-off screen styles.
4. Include loading, empty, error, offline, disabled, pressed, and focus states wherever they apply.
5. Prefer platform-native behavior, restrained motion, strong hierarchy, and decoration only when it improves comprehension.
6. Verify light and dark themes, dynamic type, contrast, reduced motion, and touch targets of at least 44 by 44 points.
7. Apply `docs/product-voice.md` to every user-visible label, status, empty state, error, notification, and AI disclosure.

## Product voice

Use direct product language in the order **state → consequence → action**.

- Keep JIEN as a product name, not a character. Do not write copy that says JIEN will
  guide, carry, keep, build, recommend, wait, or understand on the user's behalf.
- Prefer verifiable outcomes over reassurance: `No records were deleted` rather than
  `Your data is safe`.
- Avoid generic assistant and motivational language such as `next small win`, `when you
  are ready`, `starts here`, `at a glance`, or `make it your own`.
- Name the affected record or process and the next available action.
- Preserve precise safety, privacy, consent, billing, and medical limitations.
- Run the copy-quality harness and update it when a repeated failure mode is found.

## Approved tokens

Direction: **Warm Utility**, softened with pastel cream, royal-brown, and restrained wood accents.

### Color

Use semantic tokens from `src/theme/tokens.ts` only.

- Light: canvas `#F7F1E7`, surface `#FFFBF5`, raised surface `#FFFDF9`, primary text `#2B211B`, secondary text `#6E6056`, border `#E4D7C8`, royal-brown action `#71452F`, pastel brown `#E8D3C2`, wood accent `#B98462`.
- Dark: canvas `#17120F`, surface `#211A16`, raised surface `#2A211B`, primary text `#F7EFE4`, secondary text `#BDAEA1`, border `#49392F`, royal-brown action `#D7A47E`, pastel brown `#4A352A`, wood accent `#AA7554`.
- Semantic feedback: sage success, ochre warning, muted terracotta danger. Do not use accent colors as decoration.
- Follow the OS theme by default and allow an explicit light/dark override. Dark mode is separately mapped, never mechanically inverted.

### Typography

Use the platform system face (SF Pro on iOS, Roboto on Android) and dynamic type. Scale: caption `12/16`, label `14/20`, body `16/24`, body-large `18/24`, section `22/28`, title `28/34`, display `36/42`. Use weights 400, 500, 600, and 700. Use tabular numerals for loads, reps, calories, and macros.

### Layout

- Spacing: `4, 8, 12, 16, 20, 24, 32, 40, 48`.
- Radius: `8` compact controls, `12` buttons and inputs, `16` cards, `24` sheets. Use full pills only for chips and statuses.
- Minimum touch target: 44 by 44 points.
- Use one subtle shadow only for floating surfaces; prefer borders and tonal separation elsewhere.
