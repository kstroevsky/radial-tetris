# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable design decisions

- Favor a near-edge polar field on mobile, with the lower controls reaching toward the screen borders and only enough inset to preserve labels.
- Keep direct drag on the circle as the primary orbit gesture. Mobile also has an understated bottom orbit rail with arrow ends as a secondary option.
- Keep the mobile orbit-rail glow subtle and arrow-adjacent. Expand the invisible hit target instead: each side covers the last part of its line plus the outer space beyond its arrow, while leaving the rail artwork unchanged.
- Keep the left Spin capsule two-ended and light its active pole during a tap or pull. Keep Nudge visually distinct and single-ended, with directional gradient press/hold feedback instead of filling the whole control.
- Mobile polar-controller feedback uses a soft blue radial halo for the large ambient glow and a yellow radial ring for either active pole. Never use a linear fill inside the capsule. The two Spin icons must use the same glyph, size, and weight, mirrored only for direction.
- Keep the Nudge action icon at the same visual weight and scale as Spin’s icons; it is a direct glyph, so it must retain an explicit base font after label styles change.
- Prefer a fullscreen game shell on normal-size viewports; preserve overflow only where compressing the play surface would harm usability.
- Keep the mobile document root scrollable enough for the browser's native pull-to-refresh gesture. Do not reintroduce a fixed body, root `overflow: hidden`, or `overscroll-behavior: none` merely to suppress redundant scrolling.
- Show a deliberately tiny footer credit on every main gameplay layout: `2026 | Created and delivered by kstroevsky`, with `kstroevsky` linking to GitHub. On phone it may be fixed at the safe-area edge, but must hide behind a modal overlay.
- Treat 701–1100px widths as a compact tablet mode: keep the game shell viewport-height when the viewport is at least 620px high, use a shallow system strip, and constrain the start card so all three difficulty choices remain visible.
