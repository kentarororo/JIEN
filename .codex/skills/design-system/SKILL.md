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

## Approved tokens

Pending the first visual-direction checkpoint. Once selected, record the exact palette, type scale, spacing scale, corner radii, elevation, and light/dark semantic mappings here before building the first real screen.
