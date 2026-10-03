import type { AuditEvent, ModelCall } from '../types.js'
import type { EvaluationObservation } from './contracts.js'

export type ComputerAgentTelemetryMetrics = Pick<EvaluationObservation['metrics'],
  | 'timeToPlanReadyMs'
  | 'timeToFirstActionMs'
  | 'timeToFirstMeaningfulProgressMs'
  | 'longestIdleMs'
  | 'planningLatencyMs'
  | 'executionLatencyMs'
  | 'verificationLatencyMs'
  | 'recoveryLatencyMs'
  | 'replans'
  | 'proposalRepairs'
  | 'providerRetries'
  | 'criticCalls'
  | 'executiveCalls'
  | 'verificationCalls'
  | 'userInterruptions'
  | 'exactRepeatedActions'
>

const planningPhases = new Set(['goal_plan', 'strategy_candidate', 'strategy_repair', 'strategy_arbiter', 'plan_revision'])
const executionPhases = new Set(['action_proposal', 'universal_provider_turn'])
const verificationPhases = new Set(['input_reconciliation', 'verification'])
const recoveryPhases = new Set(['objective_replan', 'executive_review'])

function occurredAtMs(event: AuditEvent): number | null {
  const parsed = new Date(event.occurredAt).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function detailNumber(event: AuditEvent, key: string): number | undefined {
  const value = event.details[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function summedDuration(calls: ModelCall[], phases: Set<string>): number {
  return calls.reduce((sum, call) => {
    if (!call.phase || !phases.has(call.phase) || call.durationMs === null || call.durationMs === undefined || !Number.isFinite(call.durationMs)) return sum
    return sum + Math.max(0, call.durationMs)
  }, 0)
}

function eventCount(events: AuditEvent[], category: string): number {
  return events.filter((event) => event.category === category).length
}

/**
 * Reduces one already-scoped computer run into privacy-safe responsiveness and
 * orchestration metrics. Callers must pass only that run/session's events and
 * model calls; screen text, prompts, and action payloads are never returned.
 */
export function summarizeComputerAgentTelemetry(events: AuditEvent[], modelCalls: ModelCall[]): ComputerAgentTelemetryMetrics {
  const ordered = [...events]
    .map((event) => ({ event, time: occurredAtMs(event) }))
    .filter((entry): entry is { event: AuditEvent; time: number } => entry.time !== null)
    .sort((left, right) => left.time - right.time || left.event.sequence - right.event.sequence)

  const planReady = ordered.find((entry) => entry.event.category === 'computer.plan_ready')
  const universalStart = ordered.find((entry) => entry.event.category === 'computer.universal_session_started')
  const assuredStart = planReady && detailNumber(planReady.event, 'durationMs') !== undefined
    ? planReady.time - detailNumber(planReady.event, 'durationMs')!
    : ordered.find((entry) => entry.event.category === 'computer.session_initializing')?.time
  const startAt = universalStart?.time ?? assuredStart
  const firstAction = ordered.find((entry) => entry.event.category === 'computer.action_execution_started'
    || entry.event.category === 'computer.universal_action_started')
  const firstProgress = ordered.find((entry) => entry.event.category === 'computer.action_criterion_verified'
    || entry.event.category === 'computer.universal_batch_progress' && entry.event.details.noProgress === false)
  const timeToPlanReadyMs = planReady ? detailNumber(planReady.event, 'durationMs') : undefined

  const milestoneCategories = new Set([
    'computer.plan_ready',
    'computer.mission_plan_approved',
    'computer.action_execution_started',
    'computer.action_criterion_verified',
    'computer.action_criterion_failed',
    'computer.session_terminal',
    'computer.universal_provider_turn',
    'computer.universal_action_started',
    'computer.universal_batch_progress',
    'computer.universal_session_terminal',
  ])
  const milestoneTimes = ordered
    .filter((entry) => milestoneCategories.has(entry.event.category))
    .map((entry) => entry.time)
  if (startAt !== undefined) milestoneTimes.unshift(startAt)
  let longestIdleMs: number | undefined
  for (let index = 1; index < milestoneTimes.length; index += 1) {
    const gap = Math.max(0, milestoneTimes[index]! - milestoneTimes[index - 1]!)
    longestIdleMs = Math.max(longestIdleMs ?? 0, gap)
  }

  const replans = events.filter((event) => event.category === 'computer.strategy_revised'
    || event.category === 'computer.objective_graph_revised'
    || event.category === 'computer.universal_provider_chain_restarted' && event.details.reason !== 'budget_grant').length
  const exactRepeatedActions = eventCount(events, 'computer.universal_batch_repeat_detected')
    + events.filter((event) => event.category === 'computer.executive_review_requested' && event.details.exactRepeat === true).length

  return {
    ...(timeToPlanReadyMs === undefined ? {} : { timeToPlanReadyMs }),
    ...(startAt !== undefined && firstAction ? { timeToFirstActionMs: Math.max(0, firstAction.time - startAt) } : {}),
    ...(startAt !== undefined && firstProgress ? { timeToFirstMeaningfulProgressMs: Math.max(0, firstProgress.time - startAt) } : {}),
    ...(longestIdleMs === undefined ? {} : { longestIdleMs }),
    planningLatencyMs: summedDuration(modelCalls, planningPhases),
    executionLatencyMs: summedDuration(modelCalls, executionPhases),
    verificationLatencyMs: summedDuration(modelCalls, verificationPhases),
    recoveryLatencyMs: summedDuration(modelCalls, recoveryPhases),
    replans,
    proposalRepairs: eventCount(events, 'computer.action_proposal_repair_requested'),
    providerRetries: eventCount(events, 'computer.universal_provider_retry')
      + eventCount(events, 'computer.action_proposal_transport_retry'),
    criticCalls: modelCalls.filter((call) => call.phase === 'decision_critic').length,
    executiveCalls: modelCalls.filter((call) => call.phase === 'executive_review').length,
    verificationCalls: modelCalls.filter((call) => call.phase === 'verification' || call.phase === 'input_reconciliation').length,
    userInterruptions: eventCount(events, 'computer.universal_steering_applied'),
    exactRepeatedActions,
  }
}
