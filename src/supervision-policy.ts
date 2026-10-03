import type {
  ActionEffect,
  ActionEffectClass,
  AutonomyLevel,
  CheckpointDecision,
  CheckpointSubject,
  ExecutionPlan,
  PlanAuthorization,
  PlannedAction,
  SupervisionPolicyV2,
  WorkIntent,
  WorkPhase,
  WorkRun,
} from './types.js'
import { compileActionEffects, hasHardFloorEffect, hasProtectedEffect, hasUnknownEffect, highestEffectBoundary } from './action-effects.js'
import { sha256, stableJson } from './util.js'

export interface SupervisionSelection {
  intent: WorkIntent
  supervision: SupervisionPolicyV2
}

export interface AuthorizationContext {
  intent: WorkIntent
  plan: ExecutionPlan
  planAuthorization: PlanAuthorization | null
  supervision: SupervisionPolicyV2
  action: PlannedAction
  phase: WorkPhase
  matchingGrants: CheckpointDecision[]
  toolAvailable: boolean
  targetStillValid: boolean
  dataBoundaryStillValid: boolean
}

export type AuthorizationDecision =
  | { outcome: 'execute'; reasonCode: string; grantId: string | null }
  | { outcome: 'checkpoint'; subject: CheckpointSubject; boundary: 'immediate' | 'phase' | 'plan' | 'countdown'; reasonCode: string }
  | { outcome: 'replan'; reasonCode: string }
  | { outcome: 'handoff'; reasonCode: string }
  | { outcome: 'deny'; reasonCode: string }
  | { outcome: 'preview'; reasonCode: string }

export function supervisionPreset(preset: SupervisionPolicyV2['preset']): SupervisionPolicyV2 {
  const common = {
    version: 2 as const,
    physicalInputBoundary: 'policy_decides' as const,
    eligibleCountdownMs: null,
    deviationBoundary: 'fresh_plan' as const,
    unknownEffectBoundary: 'resolve_or_handoff' as const,
    protectedEffectBoundary: 'immediate_or_handoff' as const,
  }
  if (preset === 'fast' || preset === 'autopilot') return {
    ...common, preset, planReview: 'when_effects_require_it', phaseBoundary: 'protected_only', stateChangeBoundary: 'covered_by_plan',
  }
  if (preset === 'step_by_step') return {
    ...common, preset, planReview: 'always', phaseBoundary: 'consequential_phases', stateChangeBoundary: 'each_state_change',
  }
  return {
    ...common, preset, planReview: 'always', phaseBoundary: preset === 'custom' ? 'consequential_phases' : 'protected_only', stateChangeBoundary: 'covered_by_plan',
  }
}

export function supervisionPolicyFromLegacy(autonomy: AutonomyLevel): SupervisionSelection {
  if (autonomy === 'observe_only') return { intent: 'context_only', supervision: supervisionPreset('smart_checkpoints') }
  if (autonomy === 'preview') return { intent: 'plan_only', supervision: supervisionPreset('smart_checkpoints') }
  if (autonomy === 'approve_each') return { intent: 'execute', supervision: supervisionPreset('step_by_step') }
  if (autonomy === 'constrained_autonomous') return { intent: 'execute', supervision: supervisionPreset('fast') }
  if (autonomy === 'timed_approval') return {
    intent: 'execute',
    supervision: { ...supervisionPreset('custom'), planReview: 'always', stateChangeBoundary: 'each_state_change', eligibleCountdownMs: 5_000 },
  }
  return { intent: 'execute', supervision: supervisionPreset('smart_checkpoints') }
}

export function legacyAutonomyFor(intent: WorkIntent, policy: SupervisionPolicyV2): AutonomyLevel {
  if (intent === 'context_only') return 'observe_only'
  if (intent === 'plan_only') return 'preview'
  if (policy.preset === 'fast' || policy.preset === 'autopilot') return 'constrained_autonomous'
  if (policy.preset === 'step_by_step') return 'approve_each'
  if (policy.preset === 'custom' && policy.eligibleCountdownMs !== null) return 'timed_approval'
  return 'approve_plan'
}

export function validateSupervisionPolicy(policy: SupervisionPolicyV2): void {
  if (policy.version !== 2) throw new Error('Supervision policy version must be 2')
  if (!['fast', 'smart_checkpoints', 'step_by_step', 'autopilot', 'custom'].includes(policy.preset)) throw new Error('Supervision preset is unknown')
  if (policy.deviationBoundary !== 'fresh_plan'
    || policy.unknownEffectBoundary !== 'resolve_or_handoff'
    || policy.protectedEffectBoundary !== 'immediate_or_handoff') {
    throw new Error('Supervision policy cannot weaken Carve safety boundaries')
  }
  if (policy.eligibleCountdownMs !== null) {
    if (policy.preset !== 'custom' || !Number.isInteger(policy.eligibleCountdownMs) || policy.eligibleCountdownMs < 1_000 || policy.eligibleCountdownMs > 30_000) {
      throw new Error('Countdown supervision must be a custom delay between 1 and 30 seconds')
    }
  }
}

export function supervisionPolicyHash(policy: SupervisionPolicyV2): string {
  validateSupervisionPolicy(policy)
  return sha256(stableJson(policy))
}

/** Shared floor for plan actions and visual batches. Faster pacing never
 * turns an unresolved effect into a known safe one. */
export function supervisionEffectBoundary(effects: readonly ActionEffect[], preset: SupervisionPolicyV2['preset']): 'resolve' | 'checkpoint' | 'eligible' {
  if (hasUnknownEffect(effects)) return 'resolve'
  if (preset === 'autopilot' ? hasHardFloorEffect(effects) : hasProtectedEffect(effects)) return 'checkpoint'
  return 'eligible'
}

/** The deterministic floor for one Universal (default-engine) batch, before any approval: `resolve` sends nothing
 * and asks for a fresh observation, `checkpoint` waits for the person, `eligible` may run under the mode's pacing.
 * The model's review cannot reach this decision; it only sees the compiled effects. */
export function universalBatchEffectBoundary(
  batch: { effects: readonly ActionEffect[]; semanticBindings: readonly { resolved: boolean }[] },
  preset: SupervisionPolicyV2['preset'],
  actorAuthority: boolean,
): { consentDecision: boolean; boundaryEffects: readonly ActionEffect[]; effectBoundary: 'resolve' | 'checkpoint' | 'eligible' } {
  // A consent or terms click on an identified control is the person's decision, not
  // a grounding problem: recovery would only ask the model to find another control
  // while the dialog keeps covering the page. It goes to the checkpoint ladder even
  // when the reviewer calls it outside the task or its acceptance carries no payload.
  const consentDecision = batch.effects.length > 0 && batch.effects.some(effect => effect.class === 'legal_acceptance')
    && batch.effects.every(effect => effect.class !== 'unknown' && effect.targetResolved === true)
    && batch.semanticBindings.every(binding => binding.resolved)
  // With action reviews off, a resolved control the vocabulary could not name runs on the
  // actor's authority (as autopilot already allows); every named protected effect still checkpoints.
  const boundaryEffects = actorAuthority ? batch.effects.filter(effect => effect.class !== 'unclassified_control') : batch.effects
  const effectBoundary = consentDecision ? 'checkpoint' : hasUnknownEffect(batch.effects) ? 'resolve' : supervisionEffectBoundary(boundaryEffects, preset)
  return { consentDecision, boundaryEffects, effectBoundary }
}

/** The middle mode approves the approach once. Legacy persisted middle-mode
 * policies used consequential_phases, which accidentally meant every batch.
 * Preserve explicit custom phase gates and all protected/unknown boundaries. */
export function requiresConsequentialPhaseReview(policy: SupervisionPolicyV2): boolean {
  return policy.phaseBoundary === 'consequential_phases' && policy.preset !== 'smart_checkpoints'
}

export function evaluateAuthorization(context: AuthorizationContext): AuthorizationDecision {
  try { validateSupervisionPolicy(context.supervision) } catch { return { outcome: 'deny', reasonCode: 'invalid_supervision_policy' } }
  if (!context.toolAvailable) return { outcome: 'deny', reasonCode: 'tool_unavailable' }
  if (context.intent === 'context_only') return { outcome: 'deny', reasonCode: 'context_only_no_execution' }
  if (context.intent === 'plan_only') return { outcome: 'preview', reasonCode: 'plan_only_no_execution' }
  if (!context.targetStillValid || !context.dataBoundaryStillValid) return { outcome: 'replan', reasonCode: 'authority_boundary_changed' }

  const effects = compileActionEffects(context.action)
  const effectBoundary = supervisionEffectBoundary(effects, context.supervision.preset)
  if (effectBoundary === 'resolve') return { outcome: 'handoff', reasonCode: 'effect_requires_resolution' }
  const grant = matchingGrant(context, effects)
  if (grant) return { outcome: 'execute', reasonCode: 'exact_checkpoint_grant', grantId: grant.id }
  const autopilot = context.supervision.preset === 'autopilot'
  if (effectBoundary === 'checkpoint') {
    return { outcome: 'checkpoint', subject: 'action', boundary: 'immediate', reasonCode: autopilot ? 'hard_floor_effect' : 'protected_effect' }
  }
  // Autopilot: everything above the floor is request-authorized, plan or no plan.
  if (autopilot) return { outcome: 'execute', reasonCode: 'autopilot_request_authorized', grantId: null }

  if (context.supervision.physicalInputBoundary === 'each_input') {
    return { outcome: 'checkpoint', subject: 'action', boundary: 'immediate', reasonCode: 'each_input_selected' }
  }
  if (context.supervision.stateChangeBoundary === 'each_state_change' && context.action.stateChanging) {
    const boundary = eligibleForCountdown(effects, context.supervision) ? 'countdown' : 'immediate'
    return { outcome: 'checkpoint', subject: 'action', boundary, reasonCode: 'each_state_change_selected' }
  }
  if (!context.planAuthorization) {
    const onlyLocalSafe = highestEffectBoundary(effects) === 'automatic'
    if (context.supervision.preset === 'fast' && onlyLocalSafe) return { outcome: 'execute', reasonCode: 'fast_request_authorized_safe_work', grantId: null }
    return { outcome: 'checkpoint', subject: 'plan', boundary: 'plan', reasonCode: 'plan_authorization_required' }
  }
  if (highestEffectBoundary(effects) === 'plan' && context.planAuthorization.scope !== 'exact_plan') {
    return { outcome: 'checkpoint', subject: 'phase', boundary: 'phase', reasonCode: 'external_effect_not_covered' }
  }
  if (requiresConsequentialPhaseReview(context.supervision)
    && context.action.stateChanging) {
    return { outcome: 'checkpoint', subject: 'phase', boundary: 'phase', reasonCode: 'consequential_phase' }
  }
  return { outcome: 'execute', reasonCode: 'authorized_plan_policy', grantId: null }
}

export function policyDirection(previous: SupervisionPolicyV2, next: SupervisionPolicyV2): 'tighten' | 'loosen' {
  validateSupervisionPolicy(previous)
  validateSupervisionPolicy(next)
  const score = (policy: SupervisionPolicyV2) =>
    (policy.preset === 'autopilot' ? -3 : 0)
    + (policy.planReview === 'always' ? 2 : 0)
    + (policy.phaseBoundary === 'consequential_phases' ? 2 : policy.phaseBoundary === 'protected_only' ? 1 : 0)
    + (policy.stateChangeBoundary === 'each_state_change' ? 3 : 0)
    + (policy.physicalInputBoundary === 'each_input' ? 4 : 0)
    + (policy.eligibleCountdownMs === null ? 1 : 0)
  return score(next) >= score(previous) ? 'tighten' : 'loosen'
}

export function effectiveSupervisionForRun(run: WorkRun): SupervisionPolicyV2 | null {
  return run.supervisionAmendments?.at(-1)?.nextPolicy ?? run.plan.supervision ?? null
}

function matchingGrant(context: AuthorizationContext, effects: ActionEffect[]): CheckpointDecision | null {
  const policyHash = supervisionPolicyHash(context.supervision)
  const targets = new Set(effects.flatMap((effect) => effect.target ? [effect.target] : []))
  return context.matchingGrants.find((grant) => {
    if (grant.status !== 'approved' || grant.planHash !== context.plan.planHash || grant.supervisionPolicyHash !== policyHash) return false
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) return false
    if (grant.subjectHash === actionSubjectHash(context.action, context.plan.planHash ?? '', policyHash)) return true
    if (grant.scope.kind === 'phase') return grant.scope.phaseHash === context.phase.hash
    if (grant.scope.kind === 'plan') {
      return effects.every((effect) => grant.scope.kind === 'plan' && grant.scope.effectClasses.includes(effect.class))
        && [...targets].every((target) => grant.scope.kind === 'plan' && grant.scope.targets.includes(target))
    }
    return false
  }) ?? null
}

export function actionSubjectHash(action: PlannedAction, planHash: string, policyHash: string): string {
  return sha256(stableJson({
    planHash,
    policyHash,
    action: {
      id: action.id,
      tool: action.tool,
      input: action.input,
      effects: compileActionEffects(action),
      verification: action.verification,
      phaseId: action.phaseId ?? null,
    },
  }))
}

export function effectClassList(effects: ActionEffect[]): ActionEffectClass[] {
  return [...new Set(effects.map((effect) => effect.class))]
}

function eligibleForCountdown(effects: ActionEffect[], policy: SupervisionPolicyV2): boolean {
  return policy.eligibleCountdownMs !== null
    && effects.every((effect) => ['safe_local', 'reversible_local_write'].includes(effect.class) && effect.location === 'local')
}
