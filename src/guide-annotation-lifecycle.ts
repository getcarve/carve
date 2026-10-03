import type { LiveComputerOverlayRect, LiveComputerOverlayWindowState } from './live-computer-overlay.js'

/** Input age is session-wide, not selected-window evidence. Capsule clicks,
 * typing, and minimization must not invalidate unchanged drawing geometry. */
export function guideGeometryInvalidated(state: LiveComputerOverlayWindowState, previousBounds: LiveComputerOverlayRect | undefined, capsuleHeld: boolean): boolean {
  if (!state.available || !state.bounds) return true
  if (previousBounds && (previousBounds.width !== state.bounds.width || previousBounds.height !== state.bounds.height)) return true
  return !state.focused && !capsuleHeld
}
