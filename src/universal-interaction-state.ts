import type { LiveComputerActivityPhase, UniversalComputerSession } from './types.js'

/** Current controller state wins over the historical message that described a hold. */
export function universalComputerActivityPhase(session: Pick<UniversalComputerSession, 'status' | 'activityEvents'>): LiveComputerActivityPhase {
  if (['completed', 'safety_check', 'stopped', 'blocked'].includes(session.status)) return 'ended'
  if (['pausing', 'paused', 'awaiting_checkpoint', 'awaiting_steering_review', 'awaiting_budget'].includes(session.status)) return 'paused'
  if (session.status === 'replanning') return 'recovering'
  const recorded = session.activityEvents.at(-1)?.phase
  if (recorded && recorded !== 'paused' && recorded !== 'ended') return recorded
  return session.status === 'starting' ? 'preparing' : 'deciding'
}
