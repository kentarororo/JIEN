# UI audit vs best-in-class (#59)

Run 2026-11-04 by Grok on the local e2e build of main `a1b3c88` (fake QA account, synthetic data only), Chromium with touch emulation at 390×844 and 360×800, light and dark. Comparisons with Hevy, Strong and MacroFactor are described in words; no assets copied. Screenshots are not committed.

Scores are 1–5 (5 = matches best-in-class). Columns: **H** hierarchy (one obvious primary action) · **T** type scale · **S** spacing rhythm · **Tap** targets ≥ 44 pt · **R** thumb reach of primary action · **N** number legibility · **F** feedback/motion · **E** empty/loading/error polish · **K** safe areas & keyboard overlap · **D** dark-mode contrast.

## Ranked (worst first)

| # | Screen | H | T | S | Tap | R | N | F | E | K | D | Total | Issue |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Active workout | 2 | 3 | 2 | 5 | 2 | 3 | 3 | 3 | 2* | 4 | 29 | #61 |
| 2 | Add food + search | 2 | 4 | 3 | 5 | 2 | 3 | 3 | 3 | 3* | 4 | 32 | #62 |
| 3 | Today | 3 | 4 | 3 | 5 | 3 | 2 | 3 | 2 | 4 | 4 | 33 | #63 (+#45) |
| 4 | Food day view | 2 | 4 | 4 | 4 | 2 | 3 | 4 | 4 | 4 | 4 | 35 | #64 |
| 5 | Train, history, charts | 2 | 3 | 4 | 5 | 3 | 4 | 3 | 4 | 4 | 3 | 35 | #65 |
| 6 | Edit portion | 4 | 4 | 3 | 5 | 2 | 4 | 3 | 4 | 3* | 4 | 36 | #66 |
| 7 | Settings | 4 | 4 | 4 | 5 | 4 | — | 3 | 4 | 4 | 4 | 36/45 | #67 |

\* Keyboard overlap can't be seen in a headless browser; scored from layout (primary action only at the bottom of a long scroll) and needs a real-phone check.

## Measured
- Tap targets: 0 visible controls under 44×44 px on any captured screen, both sizes. Good.
- Type scale: 8 sizes in use (12, 14, 16, 18, 21, 22, 28, 36 px, plus 24 on headers); 21 and 22 px sit together, worth folding into one step under #60.
- No horizontal overflow at 360 px on any captured screen.
- Dark mode: automated contrast check found no real AA failures (the only flags were header text over a transparent background, a false positive). One semantic issue: an unchanged "0.0%" shows in the success green (#65).
- Tabular figures are already used for the main numbers on Today, Food and Train.

## Top 3 fixes per screen
See each issue for the before description, target pattern and testable criteria.

1. **Active workout (#61)**: ~410 px per set card (only ~2 sets visible) → Strong/Hevy one-row sets; setup (name, unit, RPE guide, rest timer) pushes Exercise 1 to y≈690 → Hevy header menu; no persistent Finish → Hevy sticky top bar.
2. **Add food (#62)**: five equal-weight buttons under search → MacroFactor search-first with scan/photo as icons; results start at y≈930 (behind tab bar) → results right under the field; truncated barcode placeholder → reveal barcode entry on demand.
3. **Today (#63)**: counts ("1 Food items") instead of kcal/protein vs target → MacroFactor dashboard; empty "No missed sessions" card takes ~250 px → hide when empty; weigh-in below the fold → already #45.
4. **Food day view (#64)**: three strong buttons compete (My foods, Add food, Mark day complete) → one primary; Add food top-left, out of reach → bottom/floating add; ISO date "2026-11-04" and faint arrows → human date, 44 pt chevrons.
5. **Train (#65)**: four buttons before any content → group secondary actions; long sentences as display headlines and three paragraphs in the history hero → Hevy number-first chart cards; 0.0 % in success green → neutral.
6. **Edit portion (#66)**: Close top-right → bottom sheet/bottom dismiss; unit chips wrap at 390 → one row; ISO date eyebrow → human date.
7. **Settings (#67)**: focus outline on touch-tapped tab → `:focus-visible` only; cramped segmented control at 360; redundant eyebrow (taste).

## Taste: Ken decides
- Palette (warm browns/creams) and card-heavy layout: consistent and calm; not scored down. Best-in-class apps use flatter lists with fewer nested cards, but that's a direction call.
- Uppercase eyebrows on every screen header.
- Hero number on Food: remaining-first (MacroFactor) vs logged-first.
- Compact set row look (table vs cards) and whether to show an elapsed workout timer.
- History as the default Train segment once there's data.
