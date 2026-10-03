import { sha256 } from './util.js'
import type { LiveComputerAction, LiveComputerCriterionResult, LiveComputerTaskLedger, LiveComputerTransition } from './types.js'

/** The absence of proof is not proof of failure. Normalize older provider
 * outputs here rather than reinterpreting their booleans in each consumer. */
export function outcomeAssessment(result: LiveComputerCriterionResult, supported: boolean, progressed = false): 'supported' | 'contradicted' | 'unresolved' {
  if (result.riskSignal === 'authority_violation' || ['policy_violation', 'prompt_injection'].includes(result.failureCause ?? '')) return 'contradicted'
  if (result.blockingMismatch === 'stale_observation' || result.blockingMismatch === 'ambiguous_entity') return 'unresolved'
  if (supported || progressed) return 'supported'
  // A claimed contradiction needs actual, sufficiently clear evidence. A
  // hidden/transient state must remain inspectable even at high confidence.
  if (result.confidence >= 0.8 && (result.evidence?.length ?? 0) > 0
    && (result.blockingMismatch === 'wrong_resource' || result.effectState === 'not_applied'
      || result.progress === 'regressed')) return 'contradicted'
  if (result.progress === 'uncertain' || result.persistence === 'pending'
    || ['missing_evidence', 'stale_observation', 'ambiguous_entity'].includes(result.blockingMismatch ?? '')
    || ['transient_loading', 'field_acceptance_unknown', 'provider_unavailable', 'control_ambiguous'].includes(result.failureCause ?? '')) return 'unresolved'
  // Preserve affirmative legacy judgments of unchanged effects. New
  // providers express uncertainty explicitly rather than inventing a cause.
  return result.progress === 'unchanged' && result.confidence >= 0.8 ? 'contradicted' : 'unresolved'
}

export function pendingOperationContext(ledger: LiveComputerTaskLedger) {
  return ledger.transitions.filter(t => t.status === 'unresolved').map(t => ({
    operationId: t.effect?.operationId ?? t.actionId, objectiveId: t.objectiveId,
    windowId: t.actionReceipt?.targetWindowId, action: t.kind, target: t.targetLabel,
    expected: t.expectedState, observed: t.observedState, assessment: t.assessment,
    effect: t.effect, delivery: t.actionReceipt?.delivery, evidence: t.evidence,
    inputTransaction: t.inputTransaction ?? null,
  }))
}

export function assessmentAuditCategory(transition: LiveComputerTransition | undefined): string {
  return transition?.status === 'verified' ? 'computer.action_criterion_verified'
    : transition?.status === 'progressed' ? 'computer.action_progress_observed'
    : transition?.status === 'unresolved' ? 'computer.action_verification_pending'
    : 'computer.action_criterion_failed'
}

/** Text entry changes a field even when the goal is read-only research.
 * Preserve its replay barrier until the effect is resolved. */
export function operationReplayKey(action: LiveComputerAction, windowId: number): string | null {
  if ((['read_only', 'safe'].includes(action.risk) && action.kind !== 'type_into') || ['wait', 'conclude', 'ask_user', 'handoff'].includes(action.kind)) return null
  const visibleTarget = (action.targetIdentity?.name || action.targetLabel || '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
  const operationKind = action.kind === 'click'
    || action.kind === 'element_action' && action.elementAction === 'activate'
    || action.kind === 'keypress' && ['RETURN', 'ENTER', 'SPACE'].includes(action.key ?? '')
    ? 'activate_control'
    : action.kind
  return sha256(JSON.stringify({ windowId, kind: operationKind,
    // Delivery mechanisms can change during recovery. Bind replay protection
    // to the visible receiver name first so AX activate, a grounded click, and
    // keyboard activation of the same control remain one logical mutation.
    target: visibleTarget || (action.targetIdentity ? { identifier: action.targetIdentity.identifier, role: action.targetIdentity.role } : null),
    text: action.text, key: operationKind === 'activate_control' ? null : action.key, replaceExisting: action.replaceExisting,
    command: action.command, elementAction: operationKind === 'activate_control' ? null : action.elementAction,
    artifactId: action.artifactId, artifactUnit: action.artifactUnit, sequence: action.sequence }))
}
