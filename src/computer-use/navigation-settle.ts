import { setTimeout as delay } from 'node:timers/promises'
import { compareVisibleState } from './visual-stability.js'
import type { LiveComputerBackend, LiveComputerCapturedFrame } from '../live-computer.js'
import type { LiveComputerTarget } from '../types.js'

export interface NavigationProbe {
  width: number
  height: number
  visualSample: string
}

/** Probes establish timing only, never action grounding or semantic success.
 * Always materialize a fresh full observation after the final probe. */
export async function settleNavigationFrame(input: {
  backend: Pick<LiveComputerBackend, 'capture' | 'probe'>
  target: LiveComputerTarget
  framePrefix: string
  initial: LiveComputerCapturedFrame
  signal: AbortSignal
  policy: { navigationSettleMaxMs: number; navigationSettlePollMs: number; navigationSettleStableFrames: number }
  useProbes: boolean
}) {
  const { backend, target, signal, policy } = input
  signal.throwIfAborted()
  const started = performance.now()
  let frame = input.initial
  let previous: NavigationProbe & { sha256?: string } = { width: frame.width, height: frame.height, visualSample: frame.visualSample ?? '', sha256: frame.sha256 }
  let stableFrames = 0, observations = 0, probes = 0, fullCaptures = 0
  let probing = input.useProbes && Boolean(backend.probe)
  let fallback: 'unsupported' | 'probe_failed' | null = null
  while (stableFrames < policy.navigationSettleStableFrames && performance.now() - started < policy.navigationSettleMaxMs) {
    signal.throwIfAborted()
    await delay(Math.min(policy.navigationSettlePollMs, Math.max(1, policy.navigationSettleMaxMs - (performance.now() - started))), undefined, { signal })
    const remaining = policy.navigationSettleMaxMs - (performance.now() - started)
    if (remaining <= 0) break
    if (probing) {
      let next: NavigationProbe | null = null
      try {
        next = await backend.probe!(target, AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.ceil(remaining)))]))
      } catch {
        signal.throwIfAborted()
        fallback = 'probe_failed'
      }
      signal.throwIfAborted()
      if (next) {
        probes += 1; observations += 1
        const unchanged = previous.width === next.width && previous.height === next.height
          && compareVisibleState(null, previous.visualSample, next) === 'unchanged'
        stableFrames = unchanged ? stableFrames + 1 : 0
        previous = next
        continue
      }
      fallback ??= 'unsupported'
      probing = false
      stableFrames = 0
    }
    frame = await backend.capture(target, `${input.framePrefix}-${++fullCaptures}`, { signal })
    signal.throwIfAborted()
    observations += 1
    const unchanged = previous.width === frame.width && previous.height === frame.height
      && compareVisibleState(previous.sha256, previous.visualSample, frame) !== 'changed'
    stableFrames = unchanged ? stableFrames + 1 : 0
    previous = { width: frame.width, height: frame.height, visualSample: frame.visualSample ?? '', sha256: frame.sha256 }
  }
  // A stalled event loop can consume the budget before even the first probe.
  // Never return the pre-wait frame as though it were a fresh observation.
  if (probing || fullCaptures === 0) {
    frame = await backend.capture(target, `${input.framePrefix}-final`, { signal })
    signal.throwIfAborted()
    fullCaptures += 1
    if (previous.width !== frame.width || previous.height !== frame.height
      || compareVisibleState(null, previous.visualSample, frame) !== 'unchanged') stableFrames = 0
  }
  return { frame, stableFrames, observations, probes, fullCaptures, fallback, elapsedMs: performance.now() - started }
}
