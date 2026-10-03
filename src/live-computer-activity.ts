import type { LiveComputerActivityPhase, LiveComputerSession } from './types.js'

export type LiveComputerProgressHealth = 'starting' | 'making_progress' | 'exploring' | 'retrying' | 'needs_attention' | 'waiting' | 'paused' | 'complete' | 'stopped'

const terminalStatuses = new Set<LiveComputerSession['status']>(['handoff', 'completed', 'blocked', 'stopped'])

/** Compatibility projection for sessions that predate typed briefing events. */
export function liveComputerActivityPhase(session: LiveComputerSession): LiveComputerActivityPhase {
  const recorded = session.activityEvents?.at(-1)?.phase
  if (recorded && !(recorded === 'paused' && session.status !== 'paused'
    && !['awaiting_plan_approval', 'awaiting_context_transfer', 'awaiting_guidance', 'awaiting_approval'].includes(session.status))) return recorded
  switch (session.status) {
    case 'initializing': return 'preparing'
    case 'ready': return session.ledger.recovery.cause ? 'recovering' : 'deciding'
    case 'acting':
    case 'reconciling_input': return 'acting'
    case 'verifying': return 'verifying'
    case 'paused': return 'paused'
    case 'completed':
    case 'handoff':
    case 'blocked':
    case 'stopped': return 'ended'
    case 'awaiting_plan_approval':
    case 'awaiting_context_transfer':
    case 'awaiting_guidance': return 'waiting'
    case 'awaiting_approval': return session.pendingApproval?.kind === 'immediate' || session.pendingApproval?.kind === 'group' ? 'waiting' : 'deciding'
  }
}

export function liveComputerProgressHealth(session: LiveComputerSession): LiveComputerProgressHealth {
  if (session.status === 'completed') return 'complete'
  if (session.status === 'blocked' || session.status === 'handoff' || session.status === 'stopped') return 'stopped'
  if (session.status === 'paused') return 'paused'
  if (session.status === 'awaiting_plan_approval' || session.status === 'awaiting_context_transfer' || session.status === 'awaiting_guidance') return 'waiting'
  if (session.status === 'awaiting_approval' && (session.pendingApproval?.kind === 'immediate' || session.pendingApproval?.kind === 'group')) return 'waiting'
  const recovery = session.ledger.recovery
  if (recovery.stalledAttempts >= 3 || session.ledger.executive.budget.atRisk) return 'needs_attention'
  if (recovery.cause || ['reground', 'reconcile_input', 'replan', 'retry_same_objective'].includes(recovery.disposition)) return 'retrying'
  if (session.actionCount === 0) return session.status === 'initializing' ? 'starting' : 'exploring'
  if (session.ledger.objectives.some((objective) => objective.status === 'verified')) return 'making_progress'
  return 'exploring'
}

export function liveComputerProgressHealthLabel(health: LiveComputerProgressHealth): string {
  switch (health) {
    case 'starting': return 'Starting'
    case 'making_progress': return 'Making progress'
    case 'exploring': return 'Exploring'
    case 'retrying': return 'Trying again'
    case 'needs_attention': return 'Needs attention'
    case 'waiting': return 'Waiting for you'
    case 'paused': return 'Paused'
    case 'complete': return 'Complete'
    case 'stopped': return 'Stopped'
  }
}

export function liveComputerProgressHealthDetail(session: LiveComputerSession, health = liveComputerProgressHealth(session)): string {
  const remaining = Math.max(0, session.maxActions - session.actionCount)
  switch (health) {
    case 'needs_attention': return `This part has not moved forward after ${session.ledger.recovery.stalledAttempts} tries · ${remaining} steps left`
    case 'retrying': return 'The last approach did not work. Carve is trying another way.'
    case 'making_progress': return 'Carve has confirmed part of the task is done and is continuing with your plan.'
    case 'exploring': return 'Carve is finding the best place to start.'
    case 'waiting': return 'No active work time is being used while Carve waits for your decision'
    case 'paused': return 'Carve won’t click or type until you resume.'
    case 'starting': return 'Carve is preparing the plan before it clicks or types.'
    case 'complete': return 'Carve checked that the task is complete.'
    case 'stopped': return session.blockedReason ?? 'No further computer input will be sent'
  }
}

export function liveComputerElapsedMs(session: LiveComputerSession, now = Date.now()): number {
  const started = new Date(session.startedAt).getTime()
  const ended = session.endedAt ? new Date(session.endedAt).getTime() : terminalStatuses.has(session.status) ? new Date(session.updatedAt).getTime() : now
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return 0
  return Math.max(0, ended - started)
}

export function liveComputerPhaseElapsedMs(session: LiveComputerSession, now = Date.now()): number {
  const started = new Date(session.phaseStartedAt ?? session.activityEvents?.at(-1)?.startedAt ?? session.updatedAt).getTime()
  const current = session.activityEvents?.at(-1)
  const ended = current?.endedAt ? new Date(current.endedAt).getTime() : terminalStatuses.has(session.status) ? new Date(session.endedAt ?? session.updatedAt).getTime() : now
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return 0
  return Math.max(0, ended - started)
}

/** Closed-vocabulary copy for the desktop overlay. Event prose deliberately
 * does not cross this boundary. */
export function liveComputerOverlayPhaseCopy(phase: LiveComputerActivityPhase): { label: string; detail: string } {
  switch (phase) {
    case 'preparing': return { label: 'Carve · Preparing', detail: 'Planning your task. Nothing has been clicked or typed yet.' }
    case 'observing': return { label: 'Carve · Reading this window', detail: 'Reading this window to understand what’s on screen.' }
    case 'deciding': return { label: 'Carve · Planning the next step', detail: 'Working out the next step for your task.' }
    case 'acting': return { label: 'Carve · Working', detail: 'Carrying out the approved step in this window.' }
    case 'verifying': return { label: 'Carve · Checking the result', detail: 'Checking whether the last step worked.' }
    case 'recovering': return { label: 'Carve · Trying another approach', detail: 'The last approach didn’t work. Trying another way.' }
    case 'settling': return { label: 'Carve · Waiting for the window', detail: 'Waiting for the window to finish updating. Carve will continue automatically.' }
    case 'waiting': return { label: 'Carve · Waiting for you', detail: 'Carve won’t click or type while it waits for your answer.' }
    case 'paused': return { label: 'Carve · Paused', detail: 'Carve won’t click or type until you resume.' }
    case 'ended': return { label: 'Carve · Work ended', detail: 'Carve has stopped working. Check the result to see what finished.' }
    case 'complete': return { label: 'Carve · Complete', detail: 'Carve has finished working.' }
  }
}
