# Landing motion and cursor

Implemented in the existing WSL checkout, preserving concurrent UI work.

- `world/src/frontend/ui-ux/StudioMotion.tsx`: cursor lifecycle and direct DOM pointer tracking; landing image decode/error handling and one-time section reveals.
- `world/src/frontend/studio-motion.css`: staged hero entrances, image/section transitions, button feedback, and a minimal 22px frosted cursor. Final cursor has 7% white fill, 3px backdrop blur, and a thin white/dark edge for dark, white, and gold surfaces. Hover grows 22%; press contracts.
- `world/src/frontend/ui-ux/Studio.tsx`: mounts the cursor, invokes the landing hook, reserves hero dimensions and prioritizes hero loading. Other changes in this file belong to concurrent UI work.

Verification: production build and TypeScript pass (existing large-chunk warning). Full suite: 383 tests passed with two workers; initial parallel run hit the existing 5-second statistical performance threshold, and the isolated rerun passed. Chromium checks passed for cursor hover/press, keyboard/native fallback, blur cleanup, reduced motion, touch viewport, image decode/loading failure, cached hero during scenario switch, scroll reveals, and no horizontal overflow at 390px. No browser page errors. Final transparent cursor visually checked over gold and white buttons. Tests used the already-installed Playwright from /home/tim/Relay; no packages installed.

Remaining: physical-device frame-rate profiling was not performed. Changes are local, uncommitted, and not deployed.

## Additional motion pass

Added bounded pointer-driven hero artwork tilt (1.4/1.8 degrees, 4px maximum lateral drift), independently staggered section children and agent portraits, animated tab/link underlines, avatar hover lift/rotation, and CTA lift/press feedback. The minimal transparent cursor is unchanged. Revealed sections retain their state when changing scenario tabs. Motion resets on pointer leave, keyboard Tab, window blur, visibility changes, and reduced-motion preference changes. No idle animation loop or per-frame React updates.

Validation: production build passed with the existing chunk-size warning. Browser assertions passed for artwork tilt, keyboard reset, child reveals, retained reveal state across tab changes, reduced-motion reset, cursor hover/press, mobile overflow, image delay/error handling, and no page errors. Existing 383-test evidence applies to unchanged data/navigation logic; this pass was checked through the affected browser flow. Physical-device profiling remains unperformed.
