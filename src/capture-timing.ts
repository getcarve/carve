import type { CaptureTiming } from './types.js'

export const fixedCaptureIntervals = [2, 5, 10, 15, 30] as const
export const adaptiveCaptureProfile = {
  id: 'balanced-v1' as const,
  probeIntervalMs: 500,
  settleMs: 600,
  maximumSettleMs: 2_000,
  minimumCaptureGapMs: 2_000,
  heartbeatMs: 15_000,
  motionAfterMs: 2_000,
  motionCaptureGapMs: 10_000,
  meanDifferenceThreshold: 0.018,
  changedAreaThreshold: 0.055,
}

export function timingFromLegacy(intervalSeconds: number): CaptureTiming {
  return intervalSeconds > 0 ? { mode: 'fixed', intervalSeconds } : { mode: 'manual' }
}

export function normalizeCaptureTiming(value: unknown, legacyIntervalSeconds = 0): CaptureTiming {
  if (!value || typeof value !== 'object') return timingFromLegacy(legacyIntervalSeconds)
  const candidate = value as { mode?: unknown; profile?: unknown; intervalSeconds?: unknown }
  if (candidate.mode === 'adaptive') {
    if (candidate.profile !== undefined && candidate.profile !== adaptiveCaptureProfile.id) throw new Error('Unknown adaptive capture profile')
    return { mode: 'adaptive', profile: adaptiveCaptureProfile.id }
  }
  if (candidate.mode === 'manual') return { mode: 'manual' }
  if (candidate.mode === 'fixed') {
    if (typeof candidate.intervalSeconds !== 'number' || !Number.isFinite(candidate.intervalSeconds) || candidate.intervalSeconds <= 0 || candidate.intervalSeconds > 300) {
      throw new Error('Fixed capture interval must be between 0 and 300 seconds')
    }
    return { mode: 'fixed', intervalSeconds: candidate.intervalSeconds }
  }
  throw new Error('Capture timing mode must be adaptive, fixed, or manual')
}

export function legacyIntervalForTiming(timing: CaptureTiming): number {
  return timing.mode === 'fixed' ? timing.intervalSeconds : 0
}

export function captureTimingLabel(timing: CaptureTiming): string {
  if (timing.mode === 'adaptive') return 'Adaptive'
  if (timing.mode === 'manual') return 'Manual'
  return `Every ${timing.intervalSeconds}s`
}
