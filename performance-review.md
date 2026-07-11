# Mobile Performance Review

## Optimization contract

- User outcome: responsive touch-and-key controls with no visible board regression on a phone-sized PWA.
- Workload: 16 consecutive hard drops at a 390 × 844 mobile viewport with device scale factor 3 in local Chromium.
- Primary metric: synchronous input-to-game-state work during a hard drop.
- Guardrails: unchanged rules, visible board fidelity, PWA offline reload, touch controls, persistent high score, no console errors.
- Scope: browser emulation is representative of viewport and DPR, but not a substitute for thermal and battery measurements on a physical device.

## Baseline

The original renderer drew into an offscreen high-DPI canvas, then copied the whole surface with `getImageData()` and `putImageData()` for every board update.

| Metric | Baseline |
|---|---:|
| Canvas readbacks in 16 hard drops | 16 |
| Canvas writebacks in 16 hard drops | 16 |
| Pixels copied per direction | 8,761,600 |
| Pixels per board draw | 547,600 |
| Median synchronous input work | 2.2 ms |
| Maximum synchronous input work | 2.7 ms |

The code review also found a 10 Hz React HUD update even when gameplay had not visibly changed, a full polar-grid redraw for each board update, uncoalesced pointer-move rendering, and a new empty particle array allocated every animation frame.

## Accepted changes

1. Removed full-canvas pixel readback and writeback; the board now renders directly to the visible hardware-backed canvas.
2. Cached the immutable Cartesian/polar grid, axis labels, and ring labels in a size-specific canvas layer. Dynamic draws now repaint only game state: settled cells, active piece, ghost, effects, and core.
3. Capped phone-sized boards at DPR 1.5, reducing board pixels from 547,600 to 308,025 (43.75% fewer pixels) while retaining clear mobile geometry.
4. Made HUD state updates event-driven: input, gravity, clears, and effects update it; idle gameplay no longer rerenders React ten times per second.
5. Coalesced pointer orbit updates to one animation-frame application, avoiding repeated geometry work during fast drags.
6. Removed the idle particle-array allocation path; particle compaction now happens in place only while particles exist.

## After measurement

| Metric | After |
|---|---:|
| Canvas readbacks in 16 hard drops | 0 |
| Canvas writebacks in 16 hard drops | 0 |
| Pixels per board draw | 308,025 |
| Median synchronous input work | 0.2 ms |
| Maximum synchronous input work | 0.4 ms |
| Renderer average reported draw duration | 1.06 ms |

This is a measured 43.75% reduction in rendered pixels and roughly 91% lower median synchronous key-action time for this controlled workload. The input timings include browser scripting overhead and should be treated as a regression guard rather than a device-wide frame-rate claim.

## Correctness and PWA guardrails

- Engine smoke passed: 360° sector wrap, orbit, rotation, particle update, drop, pause, and full-ring collapse.
- Gameplay test passed with live state snapshots and a visually inspected game capture.
- Production PWA has a valid standalone manifest, 192px and 512px icons, a controlling service worker, and an offline reload that reaches the game.
- Mobile touch orbit changed the active sector; the high score persisted after reload.
- Browser console errors: none.

## Residual risks and next evidence

- The game still uses a lightweight animation-frame clock for gravity and effects. That is intentional for timing accuracy, but physical-device testing should measure battery and thermal behavior during a 10-minute session.
- Test one lower-memory Android and one recent iPhone before treating the emulator results as release performance targets.
- If effects become more elaborate, profile the particle pass before adding pooling or a worker.

## Result

Accepted. The optimized path removes the dominant memory-copy cost, preserves gameplay behavior, and passes functional, PWA, touch, offline, and console guardrails.
