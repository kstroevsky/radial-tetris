# Mobile controller analysis

## Problem observed

The current mobile controller meets minimum target size, but it is a single four-cell strip. It makes both thumbs reach toward the center, gives orbit and rotation nearly identical circular-arrow symbols, omits soft drop, and requires repeated tapping for every orbit step. The result is visually tidy but slow and error-prone during play.

Desktop controls are explicitly out of scope and must remain unchanged.

## Control models reviewed

| Model | Strengths | Failure modes | Fit for radial Tetris |
| --- | --- | --- | --- |
| Gesture-only | Maximum playfield space; direct and discoverable for casual play | Gesture thresholds create misdrops; fingers obscure the board; difficult to repeat precise movement | Keep as a secondary option through the existing board drag, not the only input |
| Uniform bottom button strip | Obvious and easy to implement | Center buttons sit outside natural thumb rest; equal visual weight hides action priority; repeat tapping is tiring | Current design; reject |
| Split virtual controller | Familiar two-thumb posture; reliable discrete actions; movement and actions are spatially distinct | Uses more vertical space and needs safe-area handling | Best primary controller |
| One-touch placement | Very fast for simple placements | Radial rotations and collision-dependent placement make prediction harder; removes useful player control | Poor match |

## Evidence from current interfaces

- The official Tetris mobile app supports both touch gestures and on-screen controls rather than forcing one input model. Its gesture scheme maps lateral swipes to movement, taps to rotation, swipe-down to hard drop, and hold-drag-down to soft drop. This establishes five distinct gameplay verbs and recognizes the need for both casual gestures and explicit controls. [Tetris Mobile controls](https://playstudios.helpshift.com/hc/en/16-tetris-mobile/faq/2944-tetris-controls/) and [App Store listing](https://apps.apple.com/us/app/tetris/id1491074310)
- Techmino places translucent movement controls on the left side of the playfield and rotation/drop actions on the right. The separation is more important than its exact visual style: each thumb owns one class of action.
- Falling Lightblocks offers gestures for casual play and adjustable on-screen buttons for experienced play. Its App Store description explicitly notes that gesture systems have limits for advanced play. [Falling Lightblocks](https://apps.apple.com/us/app/falling-lightblocks/id1453041696)
- Apple recommends placing frequent game controls within easy thumb reach, keeping secondary actions at the top, using at least 44 × 44 pt targets, and providing visible and tactile press states. [Apple game controls](https://developer.apple.com/design/human-interface-guidelines/game-controls)
- Android recommends at least 48 × 48 dp touch targets with 8 dp separation; 48 dp is approximately 9 mm. [Android touch targets](https://support.google.com/accessibility/android/answer/7101858?hl=en)
- A controlled study found a two-handed phone grip improved thumb tapping performance and precision compared with one-handed use. [Applied Ergonomics study](https://pubmed.ncbi.nlm.nih.gov/26360191/)

## Chosen mobile controller

Use a fixed, safe-area-aware two-thumb controller only below the existing 700 px mobile breakpoint:

- Left cluster: large left/right orbit arrows.
- Right cluster: one large rotate button plus a stacked soft-drop and hard-drop pair.
- Orbit and soft drop repeat while held. Initial movement occurs immediately, followed by a short delay and controlled repeat cadence.
- Rotate and hard drop remain deliberate single-press actions.
- Optional short vibration and a strong visual pressed state provide feedback when supported.
- The existing drag-around-the-board gesture remains available as an alternate input.
- Pause stays at the top as a secondary action.
- The existing desktop control row and keyboard mappings remain unchanged.

## Acceptance criteria

- Every mobile gameplay target is at least 56 px tall, with gaps between unrelated actions.
- Left/right arrows cannot be confused with the rotate glyph.
- Holding orbit repeatedly advances sectors; releasing immediately stops movement.
- Holding soft drop repeatedly nudges inward; hard drop locks exactly once.
- Two simultaneous pointers can operate movement and an action independently.
- Controls respect bottom safe-area insets and do not cover the board or score.
- Desktop layout and controls are pixel-for-pixel unaffected by the mobile-only controller.
- Mobile start, pause/resume, restart, all difficulty modes, and game-over flows remain playable.
