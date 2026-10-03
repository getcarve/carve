import type { LiveComputerAction, LiveComputerPhysicalActionReceipt, LiveComputerTarget } from './types.js'

/** Whether an operation may be repeated after its physical delivery is known
 * but its application-level effect is not. This is controller policy, never a
 * model assertion. */
export type LiveComputerInteractionRetryPolicy = 'safe_once' | 'observe_then_once' | 'never_auto_retry'

export type LiveComputerInteractionPhase =
  | 'prepared'
  | 'delivering'
  | 'observing'
  | 'verified'
  | 'failed'
  | 'uncertain'
  | 'cancelled'

/** One controller-owned lifecycle for an operation on the global foreground
 * input lane. Text is represented only by the digest already carried by the
 * specialized input transaction; this record never stores screen or payload
 * plaintext. */
export interface LiveComputerInteractionTransaction {
  id: string
  actionId: string
  objectiveId: string
  actionKind: LiveComputerAction['kind']
  targetWindowId: number | null
  targetElementId: string | null
  beforeFrameSha256: string | null
  phase: LiveComputerInteractionPhase
  retryPolicy: LiveComputerInteractionRetryPolicy
  deliveryProgress: 'none' | 'partial' | 'complete'
  delivery: LiveComputerPhysicalActionReceipt['delivery'] | null
  effectObservations: number
  startedAt: string
  updatedAt: string
}

const terminalPhases = new Set<LiveComputerInteractionPhase>(['verified', 'failed', 'cancelled'])

export function liveComputerInteractionIsTerminal(transaction: LiveComputerInteractionTransaction): boolean {
  return terminalPhases.has(transaction.phase)
}

export function liveComputerActionNeedsInteractionTransaction(action: Pick<LiveComputerAction, 'kind'>): boolean {
  return action.kind !== 'wait' && action.kind !== 'conclude'
}

/** Conservative defaults: only pointer movement is intrinsically repeatable.
 * Clicks and scrolling require a fresh observation first. Payloads, keyboard
 * commands, drags, window changes, and consequential actions are never
 * replayed merely because their effect is unclear. */
export function liveComputerInteractionRetryPolicy(
  action: Pick<LiveComputerAction, 'kind' | 'risk' | 'elementAction'>,
): LiveComputerInteractionRetryPolicy {
  if (action.risk === 'sensitive' || action.risk === 'irreversible') return 'never_auto_retry'
  if (action.kind === 'move') return 'safe_once'
  if (action.kind === 'scroll') return 'observe_then_once'
  if (action.kind === 'click') return 'observe_then_once'
  if (action.kind === 'element_action' && action.elementAction === 'focus') return 'safe_once'
  return 'never_auto_retry'
}

export function beginLiveComputerInteraction(
  current: LiveComputerInteractionTransaction | null,
  action: LiveComputerAction,
  target: Pick<LiveComputerTarget, 'windowId'>,
  beforeFrameSha256: string | null,
  at: string,
): { transaction: LiveComputerInteractionTransaction; resumed: boolean } {
  if (current && !liveComputerInteractionIsTerminal(current)) {
    if (current.actionId !== action.id) {
      throw new Error(`Interaction ${current.actionId} is still ${current.phase}; a different action cannot enter the foreground control lane`)
    }
    return { transaction: current, resumed: true }
  }
  return {
    resumed: false,
    transaction: {
      id: action.id,
      actionId: action.id,
      objectiveId: action.objectiveId,
      actionKind: action.kind,
      targetWindowId: target.windowId,
      targetElementId: action.targetElementId ?? null,
      beforeFrameSha256,
      phase: 'prepared',
      retryPolicy: liveComputerInteractionRetryPolicy(action),
      deliveryProgress: 'none',
      delivery: null,
      effectObservations: 0,
      startedAt: at,
      updatedAt: at,
    },
  }
}

export function markLiveComputerInteractionDelivering(
  transaction: LiveComputerInteractionTransaction,
  at: string,
): LiveComputerInteractionTransaction {
  if (!['prepared', 'delivering'].includes(transaction.phase)) return transaction
  return { ...transaction, phase: 'delivering', updatedAt: at }
}

export function recordLiveComputerInteractionDelivery(
  transaction: LiveComputerInteractionTransaction,
  receipt: LiveComputerPhysicalActionReceipt,
  at: string,
): LiveComputerInteractionTransaction {
  if (transaction.actionId !== receipt.actionId) throw new Error('Physical delivery receipt belongs to a different interaction')
  const progress = receipt.deliveryProgress
    ?? (receipt.delivery === 'accepted' ? 'complete' : receipt.delivery === 'rejected' ? 'none' : 'partial')
  return {
    ...transaction,
    phase: progress === 'none' && receipt.delivery === 'rejected' ? 'failed' : 'observing',
    deliveryProgress: progress,
    delivery: receipt.delivery,
    updatedAt: at,
  }
}

export function observeLiveComputerInteraction(
  transaction: LiveComputerInteractionTransaction,
  at: string,
): LiveComputerInteractionTransaction {
  if (liveComputerInteractionIsTerminal(transaction)) return transaction
  return { ...transaction, phase: 'observing', effectObservations: transaction.effectObservations + 1, updatedAt: at }
}

export function resolveLiveComputerInteraction(
  transaction: LiveComputerInteractionTransaction,
  resolution: Extract<LiveComputerInteractionPhase, 'verified' | 'failed' | 'uncertain' | 'cancelled'>,
  at: string,
): LiveComputerInteractionTransaction {
  if (liveComputerInteractionIsTerminal(transaction)) return transaction
  return { ...transaction, phase: resolution, updatedAt: at }
}
