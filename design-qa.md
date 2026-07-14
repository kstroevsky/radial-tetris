# Design QA

- Source visual truth: `/Users/kstroevsky/.codex/attachments/5e91de4f-4f15-4aa7-9127-3ded66d86188/image-1.jpg`
- Implementation screenshot: `/Users/kstroevsky/Documents/radial-tetris/output/qa/gameplay.png`
- Combined comparison: `/Users/kstroevsky/Documents/radial-tetris/output/qa/reference-vs-gameplay.png`
- Focused board evidence: `/Users/kstroevsky/Documents/radial-tetris/output/web-game/final/shot-0.png`
- Pause-state evidence: `/Users/kstroevsky/Documents/radial-tetris/output/qa/paused-stable.png`
- Responsive evidence: `/Users/kstroevsky/Documents/radial-tetris/output/qa/mobile-ready.png`
- Viewports: 1440 × 900 desktop; 390 × 844 responsive check.
- State: active gameplay after pointer orbit, keyboard rotation, inward nudge, and hard drop; settled pause state; ready state on mobile.

## Full-view comparison evidence

The combined reference-versus-gameplay image confirms the implementation carries forward the source's defining visual system: black field, fine Cartesian underlay, cyan/green/yellow polar mapping, labeled axes, concentric geometry, and a bright central `eᶻ` origin. The source is a mathematical concept diagram rather than a game-screen specification, so the three-column telemetry HUD and touch controls are intentional product additions around the faithful central field.

## Focused region comparison evidence

The final canvas capture shows crisp annular cells, visible ghost projection, continuous 360° sector lines, concentric rings, angle labels, radial `i` labels, entry-vector marker, and central origin. A focused region is necessary because the board details are too small to judge precisely in the full-page comparison.

## Findings

No actionable P0, P1, or P2 visual differences remain.

### Required fidelity surfaces

- Fonts and typography: the mathematical surface uses Georgia/serif labels and an italic origin mark analogous to the source; compact monospace telemetry creates a readable game hierarchy without competing with the reference diagram.
- Spacing and layout rhythm: the circular board remains the dominant region, with symmetric telemetry panels, consistent hairline borders, stable gutters, and controls directly below the playfield. Desktop and 390px layouts show no horizontal overflow or clipped primary actions.
- Colors and visual tokens: near-black ground, dark-cyan Cartesian lines, cyan/green/yellow polar grid, pale scientific labels, and restrained neon pieces match the reference's contrast and palette direction.
- Image quality and asset fidelity: the reference's geometry is implemented as a live high-DPI canvas because it is the interactive game surface, not a replaceable static illustration. Browser captures show sharp curves, cells, labels, and underlay lines.
- Copy and content: instrumentation labels, vector degrees, ring integrity, field load, score, level, controls, ready/pause copy, and status messages are concise and internally consistent.

## Interaction and browser evidence

- Pointer drag changed the active sector around the circle.
- Arrow rotation changed piece orientation.
- Inward nudge decreased the active ring index.
- Hard drop locked the piece, changed score, and spawned the next form.
- Pause produced `mode: paused`; Resume returned `mode: playing`.
- Fullscreen entered successfully and Escape exited it.
- Restart returned to `mode: playing` with score `0`.
- Deterministic engine smoke covered 360° wrapping, rotation, hard drop, pause, and complete-ring collapse.
- Final browser run produced no console or page errors.
- Mobile check reported `scrollWidth: 390` at a 390px viewport.

## Comparison history

- Initial pass: blocked because the configured in-app browser rejected local preview navigation.
- Browser pass 1: local Playwright was approved; ready and gameplay screens were captured. A canvas-only helper intermittently sampled partial backing-store tiles, while whole-page captures were complete.
- Browser pass 2: rendering was changed to event-driven presentation and deterministic state stepping. Whole-page desktop, pause, and responsive captures remained complete; the final headed canvas capture was complete and error-free.
- Final pass: the combined source/implementation comparison found no actionable P0/P1/P2 mismatch.

## Implementation checklist

- [x] Reference-matched polar field and Cartesian underlay.
- [x] Responsive desktop and mobile layouts.
- [x] Keyboard, pointer, touch, pause, fullscreen, and restart interactions.
- [x] Deterministic text-state and time-step hooks.
- [x] Production build and engine smoke test.
- [x] Browser interaction, console, and visual QA.

## Follow-up polish

- [P3] A future pass could add optional sound and persistent high scores; neither is required by the source or core radial-Tetris loop.

## 2026-07-14 invisible mobile gestures QA

- Source visual truth: `/var/folders/3v/x1mcnkjx34v_q3qbx98mhd_40000gn/T/TemporaryItems/NSIRD_screencaptureui_a4Y6un/Screenshot 2026-07-14 at 20.24.19.png`
- Primary implementation comparison: `/Users/kstroevsky/Documents/radial-tetris/output/playwright/mobile-390x844-first-guide.png`
- Compact-phone evidence: `/Users/kstroevsky/Documents/radial-tetris/output/playwright/mobile-320x568-first-guide.png`
- Gameplay/help/pause/game-over evidence: matching `mobile-390x844-*` and `mobile-320x568-*` captures in `/Users/kstroevsky/Documents/radial-tetris/output/playwright/`
- Regression evidence: `/Users/kstroevsky/Documents/radial-tetris/output/playwright/tablet-834x900-active.png` and `/Users/kstroevsky/Documents/radial-tetris/output/playwright/desktop-1440x1000-active.png`
- Required client evidence: `/Users/kstroevsky/Documents/radial-tetris/output/web-game-client-final/shot-0.png` with matching `state-0.json`

The source and 390 × 844 implementation were inspected together in one comparison pass. The implementation preserves the reference's dark scientific field, cyan hairlines, lime hard-drop emphasis, compact verb/action rows, serif headline, and board-as-controller message while adapting that instructional concept into the requested first-use modal. No normal-play sensor artwork remains.

The first compact capture exposed one P2 fit defect: the `Tap outside to start` line was clipped at 320 × 568. A short-height-only guide rule reduced internal padding, title size, row height, and gaps. The follow-up capture shows the complete card and instruction without changing surrounding navigation, telemetry, footer, board frame, or system controls. No actionable P0, P1, or P2 visual differences remain.

Interaction QA verifies clockwise-only tap rotation, two-way relative orbit, stationary hold-to-soft-drop, quick single hard drop, slow-inward/ambiguous/outward rejection, four-command orbit frame batching, piece-boundary cleanup, extra-finger rejection, failed capture, off-target release, reused pointers, blur, pause, restart, first-use persistence, inside-panel tap rejection, backdrop/Escape dismissal, foreground-visible help timing, and one-time resume. The old phone controller elements and stale hint are absent; the help target is accessible and at least 44px. Canvas `touch-action: none` and scrollable-root behavior remain intact.

Visual inspection passed for ready, first-use guide, active gameplay, reopened help, pause, and game-over at 390 × 844 and 320 × 568. Tablet 834 × 900 and desktop 1440 × 1000 captures confirm their existing controller and layout paths are unchanged. Browser runs produced no console or page errors.

The follow-up phone pass enlarged the canvas to at least 386 CSS pixels on a 390px viewport and restored a 3× canvas backing store. The active captures are 1170 × 2532 and 960 × 1704 pixels for the 390 × 844 and 320 × 568 fixtures. The polar grid is near-edge without clipping its labels; the updated `Hold` and `Quick swipe in` rows still fit at both sizes. Passive mobile copy and decoration report `user-select: none` and `pointer-events: none`, while the gameplay buttons retain `pointer-events: auto`.

final result: passed
