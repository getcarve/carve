/**
 * Turn-taking between the person and Carve for the one keyboard and mouse.
 *
 * Carve's input needs its window in front, so before this gate every step
 * re-raised that window: a person who opened a new window, or went back to
 * work elsewhere, was pulled back each time, and keys they were typing could
 * land in Carve's window (26 September review, docs/multi-window-ux-plan-2026-09-26.md).
 *
 * The rule the website promises: touch the keyboard or mouse and Carve steps
 * back; it resumes only after you have been idle for a moment. Leave its
 * window and it waits for you there rather than pulling you back.
 *
 * Probes carry ages and counts only, never what was pressed or where.
 */
import type { LiveComputerTarget } from './types.js'

export type PersonTurnReason = 'clear' | 'person_in_window' | 'person_elsewhere'

export interface PersonTurnProbe {
  /** False without Accessibility trust or when the input monitor failed; the gate then admits (the old behavior). */
  monitoring: boolean
  /** The target window is the focused window of the frontmost application. */
  targetFocused: boolean
  /** One of Carve's own windows (the capsule or the main window) is frontmost. */
  carveFrontmost: boolean
  /** Clicks, key presses and scrolls by the person since launch. */
  commandCount: number
  /** Milliseconds since the person last touched the keyboard or mouse, moves included. */
  idleMs: number
}

export interface PersonTurnDecision {
  admitted: boolean
  reason: PersonTurnReason
}

/** How long the person must be still before Carve takes the next step in a window they are using. */
export const personTurnIdleMs = 1_500

type WindowKey = Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>

/**
 * `baseline` is the person's command count the last time the target was the
 * front window (or Carve delivered input). If the target is no longer in front
 * and the person has not issued a command since, Carve's own step moved focus
 * (a link that opened a window, a dialog): that is Carve's to recover, as
 * before. If the person has, they chose another window, and Carve waits.
 */
export function decidePersonTurn(probe: PersonTurnProbe, baseline: number | null, idleThresholdMs = personTurnIdleMs): PersonTurnDecision {
  if (!probe.monitoring) return { admitted: true, reason: 'clear' }
  if (!probe.targetFocused && !probe.carveFrontmost) {
    if (baseline !== null && probe.commandCount === baseline) return { admitted: true, reason: 'clear' }
    return { admitted: false, reason: 'person_elsewhere' }
  }
  return probe.idleMs >= idleThresholdMs ? { admitted: true, reason: 'clear' } : { admitted: false, reason: 'person_in_window' }
}

export interface PersonTurnState {
  reason: Exclude<PersonTurnReason, 'clear'>
  since: number
  target: WindowKey
}

/**
 * One gate per desktop process; the keyboard and mouse are shared by every
 * session. `observe` runs on the overlay tick so the baseline tracks the
 * person between steps; `wait` holds a step until it is Carve's turn.
 */
export class PersonTurnGate {
  private baselines = new Map<string, number>()
  private waiting: PersonTurnState | null = null
  private listeners = new Set<() => void>()
  private stateAt = 0

  constructor(private readonly probe: (target: WindowKey) => PersonTurnProbe | null, private readonly options: {
    pollMs?: number
    idleThresholdMs?: number
    now?: () => number
    onYield?: (state: PersonTurnState) => void
    onRelease?: (state: PersonTurnState, waitedMs: number) => void
  } = {}) {}

  /** Record where the person is. Call on every overlay tick for the working target. */
  observe(target: WindowKey): void {
    const probe = this.read(target)
    if (probe?.monitoring && probe.targetFocused) this.baselines.set(key(target), probe.commandCount)
  }

  /** Carve just delivered input to this window: whatever focus it has now is Carve's doing. */
  noteCarveInput(target: WindowKey): void {
    const probe = this.read(target)
    if (probe?.monitoring) this.baselines.set(key(target), probe.commandCount)
  }

  check(target: WindowKey): PersonTurnDecision {
    const probe = this.read(target)
    if (!probe) return { admitted: true, reason: 'clear' }
    const baseline = this.baselines.get(key(target)) ?? null
    // Once the person has left for another window, touching the capsule is
    // not coming back: only their own return (or Continue, which raises the
    // window) ends the wait. Otherwise reading the capsule would pull them back.
    if (!probe.targetFocused && this.waiting?.reason === 'person_elsewhere' && sameWindow(this.waiting.target, target)) return { admitted: false, reason: 'person_elsewhere' }
    const decision = decidePersonTurn(probe, baseline, this.options.idleThresholdMs)
    if (decision.admitted && probe.targetFocused) this.baselines.set(key(target), probe.commandCount)
    return decision
  }

  /** Holds until Carve may take the next step in `target`, or until
   * `interrupted` reports that the person paused or redirected the task (the
   * caller then handles that instead of acting). Returns the milliseconds spent waiting. */
  async wait(target: WindowKey, signal: AbortSignal, interrupted: () => boolean = () => false): Promise<number> {
    const now = this.options.now ?? Date.now
    let decision = this.check(target)
    if (decision.admitted) return 0
    const startedAt = now()
    while (!decision.admitted && !interrupted()) {
      signal.throwIfAborted()
      this.setWaiting({ reason: decision.reason as PersonTurnState['reason'], since: this.waiting?.target && sameWindow(this.waiting.target, target) ? this.waiting.since : startedAt, target })
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, this.options.pollMs ?? 120)
        const onAbort = () => { clearTimeout(timer); reject(signal.reason instanceof Error ? signal.reason : new Error('Stopped while waiting for the person')) }
        signal.addEventListener('abort', onAbort, { once: true })
      }).catch((error: unknown) => { this.clearWaiting(target, now() - startedAt); throw error })
      decision = this.check(target)
    }
    // At least 1 ms: a caller told "0" assumes nothing happened meanwhile.
    const waited = Math.max(1, now() - startedAt)
    this.clearWaiting(target, waited)
    return waited
  }

  /** The step currently held for the person, if any, for the capsule. */
  state(): PersonTurnState | null {
    return this.waiting ? { ...this.waiting, target: { ...this.waiting.target } } : null
  }

  /** Bumps whenever the held state changes, so presentations can re-render. */
  revision(): number { return this.stateAt }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private read(target: WindowKey): PersonTurnProbe | null {
    try { return this.probe(target) } catch { return null }
  }

  private setWaiting(state: PersonTurnState): void {
    const changed = !this.waiting || this.waiting.reason !== state.reason || !sameWindow(this.waiting.target, state.target)
    const first = !this.waiting
    this.waiting = state
    if (!changed) return
    this.stateAt++
    if (first) this.options.onYield?.(state)
    for (const listener of this.listeners) listener()
  }

  private clearWaiting(target: WindowKey, waitedMs: number): void {
    if (!this.waiting || !sameWindow(this.waiting.target, target)) return
    const released = this.waiting
    this.waiting = null
    this.stateAt++
    this.options.onRelease?.(released, waitedMs)
    for (const listener of this.listeners) listener()
  }
}

function key(target: WindowKey): string { return `${target.bundleIdentifier}#${target.windowId}` }
function sameWindow(left: WindowKey, right: WindowKey): boolean { return left.windowId === right.windowId && left.bundleIdentifier === right.bundleIdentifier }
