import type { AuditEvent } from '../types.js'
import type { EvaluationFailure, EvaluationFailureCause } from './contracts.js'
import { evaluationFailureSignature } from './failure-miner.js'

export interface EvaluationAuditFailureSummary {
  signature: string
  cause: EvaluationFailureCause
  count: number
  categories: string[]
  firstOccurredAt: string
  lastOccurredAt: string
  representative: EvaluationFailure
}

const failureCategories = new Set([
  'computer.guide_failed',
  'computer.guide_capsule_failed',
  'computer.hotkey_ask_failed',
  'computer.interaction_failed',
  'computer.action_recovery_checkpoint',
  'computer.action_criterion_failed',
  'computer.action_execution_failed',
  'computer.action_proposal_failed',
  'computer.action_verification_invalid',
  'computer.action_verification_unavailable',
  'computer.action_recovery_scheduled',
  'computer.action_recovery_terminal',
  'computer.grounding_channel_degraded',
  'computer.goal_plan_fallback',
  'computer.goal_plan_model_fallback',
  'computer.input_reconciliation_failed',
  'computer.planning_recovery_requested',
  'computer.planning_checkpoint',
  'computer.resource_budget_exhausted',
  'computer.sequential_planning_failed',
  'computer.sequential_planning_safety_blocked',
  'computer.sequential_execution_failed',
  'computer.session_initialization_failed',
  'computer.session_terminal',
  'computer.strategy_arbiter_failed',
  'computer.strategy_candidate_failed',
  'computer.strategy_retry_failed',
  'computer.target_recommendation_failed',
  'agent.run_failed',
  'agent.run_blocked',
  'agent.budget_exhausted',
])

function stringDetail(event: AuditEvent, key: string): string | null {
  const value = event.details[key]
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : null
}

function normalizedCause(raw: string, category: string): EvaluationFailureCause {
  const value = `${raw} ${category}`.toLowerCase()
  if (/surface_mismatch|interaction surface mismatch/u.test(value)) return 'route_selection'
  if (/resource_identity_mismatch|field text is not grounded/u.test(value)) return 'grounding'
  if (/field_acceptance_unknown|field state is still ambiguous|delivery remains unknown/u.test(value)) return 'input_transaction'
  if (/verification_presentation_mismatch|presentation.?mismatch/u.test(value)) return 'verification_presentation_mismatch'
  if (/no_input_livelock|wait.?repeat|repeated.?wait/u.test(value)) return 'no_input_livelock'
  if (/objective_over_decomposition|over.?decompos/u.test(value)) return 'objective_over_decomposition'
  if (/budget_truncation|budget.?truncat/u.test(value)) return 'budget_truncation'
  if (/prompt.?injection/u.test(value)) return 'prompt_injection'
  if (/policy|authority|authentication|credential|safety.?block/u.test(value)) return 'authority_or_policy'
  if (/budget|limit|exhaust/u.test(value)) return 'budget'
  if (/ground|ambiguous|target.?moved|element|pointer/u.test(value)) return 'grounding'
  if (/focus|window|capture.?lost/u.test(value)) return 'focus_or_window'
  if (/input|keypress|type|duplicate/u.test(value)) return 'input_transaction'
  if (/stale|loading|transient|timeout/u.test(value)) return 'loading_or_stale_state'
  if (/route|navigation/u.test(value)) return 'route_selection'
  if (/recovery|repeated|stall/u.test(value)) return 'recovery_loop'
  if (/plan|objective|clause|coverage/u.test(value)) return 'goal_decomposition'
  if (/verif|criterion|outcome/u.test(value)) return 'outcome_verification'
  if (/handoff|guidance|needs.?user/u.test(value)) return 'handoff'
  if (/provider|model|transport/u.test(value)) return 'provider'
  if (/environment|initializ|unavailable|crash/u.test(value)) return 'environment'
  return 'unknown'
}

function routeClass(route: string | null): string {
  if (!route) return 'unspecified'
  const normalized = route.toLowerCase()
  if (/address|location|omnibox/u.test(normalized)) return 'browser_location'
  if (/site.?search|search.?field/u.test(normalized)) return 'site_search'
  if (/tab/u.test(normalized)) return 'tab_navigation'
  if (/menu|popover|dialog|modal/u.test(normalized)) return 'transient_ui'
  if (/selected.?window|current.?window/u.test(normalized)) return 'selected_window'
  return 'other'
}

function actionClass(action: string | null, category: string): string {
  const value = `${action ?? ''} ${category}`.toLowerCase()
  if (/click|pointer/u.test(value)) return 'pointer'
  if (/type|input|fill|text.?entry/u.test(value)) return 'text_entry'
  if (/key|press/u.test(value)) return 'keypress'
  if (/scroll|wheel/u.test(value)) return 'scroll'
  if (/navigate|route/u.test(value)) return 'navigate'
  if (/verify|criterion/u.test(value)) return 'verify'
  if (/plan|proposal|strategy/u.test(value)) return 'plan'
  if (/recover|retry/u.test(value)) return 'recover'
  if (/wait/u.test(value)) return 'wait'
  return 'unknown'
}

function objectiveClass(objective: string | null, bound: boolean): string {
  const value = objective?.toLowerCase() ?? ''
  if (/research|extract|read|information/u.test(value)) return 'information'
  if (/navigate|route|search|open/u.test(value)) return 'navigation'
  if (/write|record|update|apply/u.test(value)) return 'write'
  if (/verify|outcome|complete/u.test(value)) return 'verification'
  return bound ? 'bound_objective' : 'session'
}

function transitionClass(status: string | null): string {
  const value = status?.toLowerCase() ?? ''
  if (/partial|progress/u.test(value)) return 'partial_progress'
  if (/success|verified|passed|complete/u.test(value)) return 'success'
  if (/ambiguous|multiple/u.test(value)) return 'ambiguous'
  if (/stale|loading|timeout|transient/u.test(value)) return 'transient'
  if (/unavailable|lost|missing/u.test(value)) return 'unavailable'
  if (/blocked|denied|unsafe/u.test(value)) return 'blocked'
  if (/failed|error|rejected|no.?change|stalled/u.test(value)) return 'failed'
  return 'unspecified'
}

function recoveryClass(disposition: string | null, category: string): string {
  if (category === 'computer.action_recovery_checkpoint') return 'handoff'
  const value = `${disposition ?? ''} ${category}`.toLowerCase()
  if (/handoff|needs.?user|guidance/u.test(value)) return 'handoff'
  if (/replan|strategy/u.test(value)) return 'replan'
  if (/retry|scheduled|recover/u.test(value)) return 'retry'
  if (/terminal|stop|blocked/u.test(value)) return 'terminal'
  return 'investigate'
}

/** Converts only failure metadata into a controlled vocabulary. Expected and
 * observed screen text, typed values, evidence, and result summaries are never
 * copied, making the result suitable for aggregate Foundry reports. */
export function normalizeAuditFailure(event: AuditEvent): EvaluationFailure | null {
  if (!failureCategories.has(event.category)) return null
  // Terminal is an outcome event, not inherently a failure. Keep user stops
  // separate from capability failures; their preceding failure events remain.
  if (event.category === 'computer.session_terminal') {
    const status = stringDetail(event, 'status')
    if (!status || ['completed', 'cancelled', 'stopped'].includes(status)) return null
  }
  const rawCause = stringDetail(event, 'failureCause')
    ?? stringDetail(event, 'failureCode')
    ?? stringDetail(event, 'cause')
    ?? stringDetail(event, 'terminalCategory')
    // Legacy audit events predate structured causes. Their bounded error or
    // reason is inspected only to choose a controlled label; it is never
    // copied into the aggregate failure or persisted report.
    ?? stringDetail(event, 'error')
    ?? stringDetail(event, 'reason')
    ?? event.category
  const cause = normalizedCause(rawCause, event.category)
  const status = stringDetail(event, 'progress')
    ?? stringDetail(event, 'status')
    ?? rawCause
  return {
    cause,
    objectiveKind: objectiveClass(stringDetail(event, 'objectiveKind'), Boolean(event.details.objectiveId)),
    actionKind: actionClass(stringDetail(event, 'action') ?? stringDetail(event, 'actionKind'), event.category),
    applicationClass: 'computer',
    routeIdentity: routeClass(stringDetail(event, 'route')),
    observationDelta: transitionClass(status),
    recoveryDisposition: recoveryClass(stringDetail(event, 'disposition'), event.category),
    summary: `${event.category}: ${cause.replaceAll('_', ' ')}`,
  }
}

export function summarizeAuditFailures(events: AuditEvent[]): EvaluationAuditFailureSummary[] {
  const grouped = new Map<string, Array<{ event: AuditEvent; failure: EvaluationFailure }>>()
  for (const event of events) {
    const failure = normalizeAuditFailure(event)
    if (!failure) continue
    const signature = evaluationFailureSignature(failure)
    const entries = grouped.get(signature) ?? []
    entries.push({ event, failure })
    grouped.set(signature, entries)
  }
  return [...grouped.entries()].map(([signature, entries]) => {
    const ordered = entries.toSorted((left, right) => left.event.occurredAt.localeCompare(right.event.occurredAt))
    return {
      signature,
      cause: ordered[0]!.failure.cause,
      count: ordered.length,
      categories: [...new Set(ordered.map(({ event }) => event.category))].sort(),
      firstOccurredAt: ordered[0]!.event.occurredAt,
      lastOccurredAt: ordered.at(-1)!.event.occurredAt,
      representative: ordered[0]!.failure,
    }
  }).sort((left, right) => right.count - left.count || left.signature.localeCompare(right.signature))
}
