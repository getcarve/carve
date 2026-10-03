import { adaptiveCaptureProfile } from './capture-timing.js'

export type AdaptiveCaptureReason = 'initial' | 'window_changed' | 'content_changed' | 'heartbeat' | 'motion_checkpoint' | 'motion_settled'

export interface AdaptiveProbe {
  observedAtMs: number
  app: string
  windowId: number
  width: number
  height: number
  excluded: boolean
  selfObservation: boolean
  meanDifference: number
  changedAreaRatio: number
}

export interface AdaptiveDecision {
  capture: boolean
  reason: AdaptiveCaptureReason | null
  phase: 'watching' | 'settling' | 'motion' | 'waiting'
}

/**
 * Pure adaptive timing policy. The native helper decides only how different
 * two in-memory probe frames are; this state machine decides whether that
 * difference is evidence worth saving.
 */
export class AdaptiveCaptureController {
  private windowKey: string | null = null
  private lastCaptureAtMs: number | null = null
  private pendingSinceMs: number | null = null
  private lastMeaningfulChangeAtMs: number | null = null
  private pendingReason: 'initial' | 'window_changed' | 'content_changed' | null = null
  private motionSinceMs: number | null = null
  private wasInMotion = false

  observe(probe: AdaptiveProbe): AdaptiveDecision {
    const profile = adaptiveCaptureProfile
    if (probe.selfObservation || probe.excluded) {
      this.windowKey = null
      this.pendingSinceMs = null
      this.lastMeaningfulChangeAtMs = null
      this.pendingReason = null
      this.motionSinceMs = null
      this.wasInMotion = false
      return { capture: false, reason: null, phase: 'waiting' }
    }

    const nextWindowKey = `${probe.app}\u0000${probe.windowId}\u0000${probe.width}x${probe.height}`
    const first = this.windowKey === null
    const windowChanged = !first && this.windowKey !== nextWindowKey
    this.windowKey = nextWindowKey

    if (first || windowChanged) {
      this.pendingSinceMs = probe.observedAtMs
      this.lastMeaningfulChangeAtMs = probe.observedAtMs
      this.pendingReason = first ? 'initial' : 'window_changed'
      this.motionSinceMs = null
      this.wasInMotion = false
      return { capture: false, reason: null, phase: 'settling' }
    }

    const meaningful = probe.meanDifference >= profile.meanDifferenceThreshold
      && probe.changedAreaRatio >= profile.changedAreaThreshold
    if (meaningful) {
      this.pendingSinceMs ??= probe.observedAtMs
      this.pendingReason ??= 'content_changed'
      this.lastMeaningfulChangeAtMs = probe.observedAtMs
      this.motionSinceMs ??= probe.observedAtMs
      if (probe.observedAtMs - this.motionSinceMs >= profile.motionAfterMs) {
        this.wasInMotion = true
        if (this.captureGap(probe.observedAtMs) >= profile.motionCaptureGapMs) return this.capture(probe.observedAtMs, 'motion_checkpoint', 'motion')
        return { capture: false, reason: null, phase: 'motion' }
      }
      if (probe.observedAtMs - this.pendingSinceMs >= profile.maximumSettleMs && this.captureGap(probe.observedAtMs) >= profile.minimumCaptureGapMs) {
        return this.capture(probe.observedAtMs, 'content_changed', 'settling')
      }
      return { capture: false, reason: null, phase: 'settling' }
    }

    if (this.pendingSinceMs !== null && this.lastMeaningfulChangeAtMs !== null) {
      if (probe.observedAtMs - this.lastMeaningfulChangeAtMs >= profile.settleMs && this.captureGap(probe.observedAtMs) >= profile.minimumCaptureGapMs) {
        return this.capture(probe.observedAtMs, this.wasInMotion ? 'motion_settled' : this.pendingReason ?? 'content_changed', 'watching')
      }
      return { capture: false, reason: null, phase: this.wasInMotion ? 'motion' : 'settling' }
    }

    if (this.lastCaptureAtMs !== null && probe.observedAtMs - this.lastCaptureAtMs >= profile.heartbeatMs) {
      return this.capture(probe.observedAtMs, 'heartbeat', 'watching')
    }
    return { capture: false, reason: null, phase: 'watching' }
  }

  noteCaptureResult(observedAtMs: number, stored: boolean): void {
    // A heartbeat that finds an exact duplicate still resets its full-check
    // clock; otherwise an unchanged screen would cause a full capture attempt
    // on every 500 ms probe after the first heartbeat.
    this.lastCaptureAtMs = observedAtMs
    if (stored) this.windowKey ??= ''
  }

  reset(): void {
    this.windowKey = null
    this.lastCaptureAtMs = null
    this.pendingSinceMs = null
    this.lastMeaningfulChangeAtMs = null
    this.pendingReason = null
    this.motionSinceMs = null
    this.wasInMotion = false
  }

  private captureGap(observedAtMs: number): number {
    return this.lastCaptureAtMs === null ? Number.POSITIVE_INFINITY : observedAtMs - this.lastCaptureAtMs
  }

  private capture(observedAtMs: number, reason: AdaptiveCaptureReason, phase: AdaptiveDecision['phase']): AdaptiveDecision {
    this.lastCaptureAtMs = observedAtMs
    if (reason === 'motion_checkpoint') {
      this.pendingSinceMs = observedAtMs
      this.lastMeaningfulChangeAtMs = observedAtMs
      this.pendingReason = 'content_changed'
      this.wasInMotion = true
      return { capture: true, reason, phase }
    }
    this.pendingSinceMs = null
    this.lastMeaningfulChangeAtMs = null
    this.pendingReason = null
    this.motionSinceMs = null
    this.wasInMotion = false
    return { capture: true, reason, phase }
  }
}
