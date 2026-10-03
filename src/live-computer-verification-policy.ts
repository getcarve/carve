import type { LiveComputerSession, LiveComputerTransition } from './types.js'

/** A read may already have exposed the entire requested answer. Prefer a
 * model verification now over paying an actor to ask for that verification.
 * This selects a check, never establishes progress, facts, or completion. */
export function shouldVerifyReadAnswerNow(session: Pick<LiveComputerSession, 'ledger' | 'target'>, transition: LiveComputerTransition): boolean {
  const ledger = session.ledger
  const active = ledger.objectives.find(objective => objective.id === ledger.currentObjectiveId)
  const contract = ledger.outcomeContract
  const receipt = transition.actionReceipt
  if (!active || active.id !== transition.objectiveId || active.kind !== 'open_matching_resource'
    || transition.status !== 'awaiting_verification' || transition.completesObjective
    || !['click', 'element_action'].includes(transition.kind) || transition.risk !== 'read_only'
    || receipt?.delivery !== 'accepted' || receipt.deliveryProgress !== 'complete'
    || receipt.pressedInputsReleased !== true || receipt.sideEffectScope !== 'selected_window'
    || receipt.targetWindowId !== session.target.windowId
    || ledger.recovery.stalledAttempts > 0 || ledger.recovery.proposalDenials > 0
    || contract?.deliverable.kind !== 'prose' || contract.deliverable.fields.length > 0 || contract.deliverable.minimumRecords > 1
    || contract.effects.some(effect => effect.kind !== 'open')
    || ledger.artifacts.some(artifact => artifact.coverage.complete)) return false
  if (ledger.transitions.some(prior => prior !== transition && prior.effect && ['partial', 'unknown'].includes(prior.effect.state)
    && ['type', 'type_into', 'apply_artifact', 'enter_sequence', 'invoke_safe_command'].includes(prior.kind))) return false
  // A multi-product contract or later navigation/write obligation needs the
  // existing planner. Do not infer a simple answer from the prose label alone.
  if (contract.requirements && (contract.requirements.products.length !== 1 || contract.requirements.products[0]?.kind !== 'prose')) return false
  const remaining = ledger.objectives.filter(objective => objective.id !== active.id && objective.status !== 'verified')
  return remaining.length > 0 && remaining.every(objective => ['extract_information', 'verify_outcome'].includes(objective.kind))
}
