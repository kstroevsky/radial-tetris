# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable design decisions

- Favor a near-edge polar field on mobile, with the lower controls reaching toward the screen borders and only enough inset to preserve labels.
- Keep direct drag on the circle as the primary orbit gesture. Mobile also has an understated bottom orbit rail with arrow ends as a secondary option.
- Keep the mobile orbit-rail glow subtle and arrow-adjacent. Expand the invisible hit target instead: each side covers the last part of its line plus the outer space beyond its arrow, while leaving the rail artwork unchanged.
- Keep the left Spin capsule two-ended and light its active pole during a tap or pull. Keep Nudge visually distinct and single-ended, with directional gradient press/hold feedback instead of filling the whole control.
- Prefer a fullscreen game shell on normal-size viewports; preserve overflow only where compressing the play surface would harm usability.
- Keep the mobile document root scrollable enough for the browser's native pull-to-refresh gesture. Do not reintroduce a fixed body, root `overflow: hidden`, or `overscroll-behavior: none` merely to suppress redundant scrolling.
