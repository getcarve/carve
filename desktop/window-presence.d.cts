export type PresenceFrameState = 'selected' | 'thinking' | 'working' | 'attention' | 'paused' | 'complete' | 'background' | 'waiting'
export function framePresence(value: {
  frameVisible?: boolean
  decision?: unknown
  planApproval?: unknown
  guidance?: unknown
  budgetCheckpoint?: unknown
  failure?: unknown
  workConsent?: unknown
  phase?: string
  steeringPaused?: boolean
  theme?: string
  mode?: string
  health?: string
} | null | undefined): PresenceFrameState
