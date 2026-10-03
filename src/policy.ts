import type { ActionRisk, ActionSpec, ApprovalKind, AutonomyLevel } from './types.js'
import { safeOperationalText } from './parameters.js'
import { workBudgetPolicy } from './work-budget.js'
import { evaluateAuthorization as evaluateSupervisionAuthorization, type AuthorizationContext, type AuthorizationDecision } from './supervision-policy.js'

export interface ConstrainedPolicy {
  id: string
  allowedTools: string[]
  maxRisk: ActionRisk
  allowedArtifactNames: string[]
  allowedBrowserTargets: string[]
  allowedBrowserReadTargets: string[]
  allowedBrowserFillTargets: string[]
  sensitiveClasses: []
}

export interface PolicyDecision {
  outcome: 'deny' | 'preview' | 'execute' | 'approval'
  approvalKind: ApprovalKind | null
  reason: string
}

const riskOrder: Record<ActionRisk, number> = {
  read_only: 0,
  safe: 1,
  reversible_write: 2,
  sensitive: 3,
  irreversible: 4,
}

const autonomyLevels = new Set<AutonomyLevel>([
  'observe_only',
  'preview',
  'approve_each',
  'approve_plan',
  'approve_group',
  'timed_approval',
  'constrained_autonomous',
])

const sensitiveClasses = new Set([
  'communication',
  'financial',
  'authentication',
  'destructive',
  'installation',
  'privilege_escalation',
  'confidential_disclosure',
  'legal',
  'high_impact_decision',
])

/**
 * Evidence thresholds for supervised live computer use. These live in policy
 * rather than in the executor so the confidence required to accept model
 * judgment is one reviewable number, not a literal repeated at call sites.
 */
export const liveVerificationPolicy = {
  /** Minimum verifier confidence before a criterion claim is accepted. */
  criterionConfidence: 0.7,
  /** Minimum verifier confidence before partial progress is accepted. */
  progressConfidence: 0.7,
  /** Minimum grounding confidence for a pointer action. */
  pointerGroundingConfidence: 0.7,
  /** Confidence attributed to a deterministic, locally observed judgment. */
  deterministicConfidence: 0.8,
  /**
   * Share of accessibility element identities that must change before a local
   * observation counts as decisive evidence that an action was applied.
   */
  elementChangeRatio: 0.3,
  /**
   * Browser and application navigation is eventually consistent: a click can
   * first reveal a spinner, transition, or partially mounted modal. Once a
   * reversible navigation action visibly changes the window, keep observing
   * for a bounded period and require this many visually stable follow-up
   * frames before asking the semantic verifier to judge the result.
   */
  navigationSettleStableFrames: 2,
  /** Polling stays local and input-free; it consumes time but no action. */
  navigationSettlePollMs: 200,
  /** A slow page must not turn settling into an unbounded hidden wait. */
  navigationSettleMaxMs: 3_000,
} as const

/**
 * Action budgets for supervised live computer use. The session ceiling is the
 * hard limit no operating contract may exceed; the per-objective budget stops
 * one stubborn step from consuming the whole session before the later parts of
 * an approved outcome are ever attempted.
 */
export const liveBudgetPolicy = {
  /** Upper bound on a live session regardless of what a contract requests. */
  maxSessionActions: workBudgetPolicy.maxActions,
  /** Fallback budget when a contract states no action limit. */
  defaultSessionActions: 30,
  /** Actions one ordinary objective may consume before handing off. */
  objectiveActions: 12,
  /** A commit is one deliberate transaction, not an exploration. */
  commitObjectiveActions: 3,
  /**
   * Exhaustion during verified progress is a pacing artifact, not a runaway:
   * the objective budget silently grows by this much, up to the automatic
   * ceiling, as long as the ledger shows recent criterion-level progress.
   * Exhaustion during a stall instead raises a decision point for the person.
   */
  objectiveExtensionActions: 6,
  /** The ceiling automatic extension may reach; a person can grant beyond it. */
  maxAutoObjectiveActions: 24,
  /** How recent (in ledger transitions) verified progress must be for an
   * exhausted objective to earn an automatic extension. */
  progressWindowActions: 3,
  /** Actions offered per person-approved session extension. The session
   * ceiling was part of the approved plan, so it never grows silently. */
  sessionExtensionActions: 10,
  /** Active work time can be extended only by a person, up to this ceiling. */
  maxActiveDurationMinutes: workBudgetPolicy.maxDurationMinutes,
  durationExtensionMinutes: workBudgetPolicy.durationExtensionMinutes,
  /** Actions held back for final artifact construction, commit and proof. */
  minimumFinishReserveActions: 3,
  /** A captain review begins after this many work-product-neutral attempts. */
  coverageStallActions: 2,
  /** Typed tactic similarity high enough to deserve analogical review. */
  analogousAttemptThreshold: 0.72,
  /** Task-level memory is bounded, but much longer-lived than recovery state. */
  maxRememberedAttempts: 80,
} as const

/**
 * Hard deadlines for the model calls that run before or between actions. A
 * strategic call that has not answered by its deadline is abandoned and the
 * deterministic fallback proceeds: on 2026-09-03 a single 45 s goal-plan
 * timeout, then a 45 s strategy timeout, each cost a full minute of a live
 * session and blocked a sibling candidate that had already returned. These
 * are ceilings on waiting, not on the model; the typical call is far faster.
 */
export const liveComputerPlanningTimeouts = {
  // Required route inference has no safe guessed fallback. Let a cold hosted
  // response finish within the normal request window instead of cancelling
  // it at 15 seconds and immediately paying for a second attempt.
  'computer.route_intent': 60_000,
  'computer.target_recommendation': 15_000,
  'computer.live.goal_plan': 12_000,
  // Strategy candidates on the strategic model ran 20–24 s on 12–15k-token
  // prompts all day on 2026-09-03; 18 s abandoned every one of them.
  'computer.live.strategy': 25_000,
  'computer.live.strategy_arbiter': 12_000,
  'computer.live.objective_replan': 12_000,
  'computer.live.decision_critic': 12_000,
  'computer.live.action_scope': 20_000,
  'computer.live.executive': 10_000,
  'computer.live.plan_revision': 15_000,
  'computer.live.plan': 30_000,
  'computer.live.input_acceptance': 15_000,
  'computer.live.verify': 20_000,
  'computer.live.requirements': 60_000,
  'computer.live.completion_review': 60_000,
} as const

export const defaultConstrainedPolicy: ConstrainedPolicy = {
  id: 'mvp-sandbox-only',
  allowedTools: ['mock.set_state', 'artifact.write', 'browser.click', 'browser.read', 'browser.fill'],
  maxRisk: 'reversible_write',
  allowedArtifactNames: ['intake-result.txt', 'invoice-result.txt', 'receipt-result.txt', 'urgent-review-result.txt', 'standard-review-result.txt'],
  allowedBrowserTargets: ['open-request', 'urgent-review', 'standard-review', 'save-handoff'],
  allowedBrowserReadTargets: ['account-tier'],
  allowedBrowserFillTargets: ['follow-up-note'],
  sensitiveClasses: [],
}

export class PolicyEngine {
  constructor(private readonly constrainedPolicy: ConstrainedPolicy = defaultConstrainedPolicy) {}

  evaluate(action: ActionSpec, autonomy: AutonomyLevel, toolAvailable: boolean): PolicyDecision {
    const validation = validateActionSpec(action)
    if (!validation.ok) return { outcome: 'deny', approvalKind: null, reason: `Fail closed: ${validation.reason}` }
    if (!autonomyLevels.has(autonomy)) return { outcome: 'deny', approvalKind: null, reason: 'Fail closed: autonomy level is missing or unknown' }
    if (!toolAvailable) return { outcome: 'deny', approvalKind: null, reason: `Tool ${action.tool} is not available` }
    if (autonomy === 'observe_only') return { outcome: 'deny', approvalKind: null, reason: 'Observe-only mode cannot execute actions' }
    if (autonomy === 'preview') return { outcome: 'preview', approvalKind: null, reason: 'Preview mode simulates actions only' }

    if (action.sensitiveClass !== null || action.risk === 'sensitive' || action.risk === 'irreversible') {
      return {
        outcome: 'approval',
        approvalKind: 'immediate',
        reason: `Sensitive class ${action.sensitiveClass ?? action.risk} requires explicit, immediate approval; countdown consent is prohibited`,
      }
    }

    if (autonomy === 'approve_each') {
      return action.stateChanging
        ? { outcome: 'approval', approvalKind: 'immediate', reason: 'This autonomy level requires approval for every state-changing action' }
        : { outcome: 'execute', approvalKind: null, reason: 'Read-only inspection does not change state' }
    }
    if (autonomy === 'approve_plan') {
      return { outcome: 'execute', approvalKind: null, reason: 'The exact hash-bound plan was approved before execution' }
    }
    if (autonomy === 'approve_group') {
      return action.stateChanging
        ? { outcome: 'approval', approvalKind: 'group', reason: `Approve bounded action group ${action.group}` }
        : { outcome: 'execute', approvalKind: null, reason: 'Read-only inspection does not change state' }
    }
    if (autonomy === 'timed_approval') {
      return action.stateChanging
        ? { outcome: 'approval', approvalKind: 'countdown', reason: 'Reversible sandbox action is eligible for a cancellable countdown' }
        : { outcome: 'execute', approvalKind: null, reason: 'Read-only/safe inspection may run immediately' }
    }

    const allowed = this.constrainedPolicy.allowedTools.includes(action.tool)
      && riskOrder[action.risk] <= riskOrder[this.constrainedPolicy.maxRisk]
      && action.sensitiveClass === null
      && (action.tool !== 'artifact.write'
        || typeof action.input.path === 'string' && this.constrainedPolicy.allowedArtifactNames.includes(action.input.path))
      && (action.tool !== 'browser.click'
        || typeof action.input.target === 'string' && this.constrainedPolicy.allowedBrowserTargets.includes(action.input.target))
      && (action.tool !== 'browser.read'
        || !action.stateChanging && action.risk === 'read_only' && typeof action.input.target === 'string' && this.constrainedPolicy.allowedBrowserReadTargets.includes(action.input.target))
      && (action.tool !== 'browser.fill'
        || typeof action.input.target === 'string'
        && this.constrainedPolicy.allowedBrowserFillTargets.includes(action.input.target)
        && typeof action.input.value === 'string'
        && safeOperationalText(action.input.value))
    return allowed
      ? { outcome: 'execute', approvalKind: null, reason: `Allowed by validated policy ${this.constrainedPolicy.id}` }
      : { outcome: 'deny', approvalKind: null, reason: `Action is outside validated policy ${this.constrainedPolicy.id}` }
  }

  evaluateV2(context: AuthorizationContext): AuthorizationDecision {
    const validation = validateActionSpec(context.action)
    if (!validation.ok) return { outcome: 'deny', reasonCode: `invalid_action:${validation.reason}` }
    if (context.plan.contract && !context.plan.contract.allowedTools.includes(context.action.tool)) {
      return { outcome: 'deny', reasonCode: 'tool_outside_plan_contract' }
    }
    return evaluateSupervisionAuthorization(context)
  }
}

export function validateActionSpec(action: ActionSpec): { ok: true } | { ok: false; reason: string } {
  if (!action || typeof action !== 'object') return { ok: false, reason: 'action is not an object' }
  if (!action.id || !action.tool || !action.preview || !action.expectedStateChange || !action.group) return { ok: false, reason: 'action metadata is incomplete' }
  if (!action.input || typeof action.input !== 'object' || Array.isArray(action.input)) return { ok: false, reason: 'action input must be an object' }
  if (typeof action.stateChanging !== 'boolean') return { ok: false, reason: 'state-changing metadata is missing or ambiguous' }
  if (!Object.hasOwn(riskOrder, action.risk)) return { ok: false, reason: 'risk category is missing or unknown' }
  if (action.sensitiveClass !== null && !sensitiveClasses.has(action.sensitiveClass)) return { ok: false, reason: 'sensitive action class is unknown' }
  if (!action.verification || !['state_equals', 'artifact_exists', 'none'].includes(action.verification.method)) {
    return { ok: false, reason: 'verification method is missing or unknown' }
  }
  if (action.verification.method !== 'none' && !action.verification.target) return { ok: false, reason: 'verification target is missing' }
  if (action.stateChanging && action.verification.method === 'none') return { ok: false, reason: 'state-changing actions require post-action verification' }
  return { ok: true }
}
