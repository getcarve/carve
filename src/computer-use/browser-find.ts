import type { LiveComputerCapturedFrame } from '../live-computer.js'
import type { LiveComputerElement } from '../types.js'
import { isBrowserFindField } from './effects.js'

/** A unique, visible receiver, never a guessed page search box. Native dispatch
 * still revalidates window ownership, focus, obstructions and delivery. */
export function browserFindReceiver(frame: LiveComputerCapturedFrame, focused: boolean): LiveComputerElement | null {
  const candidates = frame.elements.filter(e => isBrowserFindField(e) && e.enabled !== false && !e.obstructed
    && (!focused || e.focused === true) && e.bounds!.x >= 0 && e.bounds!.y >= 0
    && e.bounds!.x + e.bounds!.width <= frame.width && e.bounds!.y + e.bounds!.height <= frame.height)
  return candidates.length === 1 ? candidates[0]! : null
}

/** Only close the exact browser Find surface we just used. Do not send Escape:
 * its effect depends on focus and could dismiss an unrelated page dialog. */
export function browserFindClose(frame: LiveComputerCapturedFrame, query: string): LiveComputerElement | null {
  const field = browserFindReceiver(frame, false)
  if (!field || field.valueComplete !== true || field.value !== query) return null
  const candidates = frame.elements.filter(e => e.role === 'AXButton' && !e.sensitive && !e.obstructed
    && e.enabled !== false && /^close find(?: bar)?$/iu.test(e.name.trim()) && e.bounds
    && Math.abs(e.bounds.y - field.bounds!.y) < 45 && e.bounds.x >= 0 && e.bounds.y >= 0
    && e.bounds.x + e.bounds.width <= frame.width && e.bounds.y + e.bounds.height <= frame.height
    && Math.abs(e.bounds.x - field.bounds!.x) < 600)
  return candidates.length === 1 ? candidates[0]! : null
}
