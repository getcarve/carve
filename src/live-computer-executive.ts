import { requirementArtifactCoverage, requirementsContentReady, unmetProductRequirements, sourceRequirementProducer } from './task-requirements.js'
import { decisionContext } from './live-computer-context.js'
import { artifactPlacementText } from './live-computer-artifact-placement.js'
import { createHash } from 'node:crypto'
import { liveBudgetPolicy } from './policy.js'
import type {
  LiveComputerAction,
  LiveComputerAttempt,
  LiveComputerBudgetForecast,
  LiveComputerCoverageSnapshot,
  LiveComputerExecutiveDecision,
  LiveComputerExecutiveState,
  LiveComputerExecutiveTriggerReason,
  LiveComputerObjectiveKind,
  LiveComputerStrategyFamily,
  LiveComputerTaskLedger,
  LiveComputerTransition,
} from './types.js'

export interface LiveComputerExecutiveTrigger {
  key: string
  reason: LiveComputerExecutiveTriggerReason
  summary: string
  analogousAttemptIds: string[]
  exactRepeat: boolean
}

const emptyCoverage = (): LiveComputerCoverageSnapshot => ({
  complete: false,
  presentFields: [],
  itemCount: 0,
  filledCells: 0,
  requiredCells: 0,
  score: 0,
})

const emptyBudget = (): LiveComputerBudgetForecast => ({
  remainingSessionActions: 0,
  estimatedFinishActions: 0,
  protectedActions: 0,
  discretionaryActions: 0,
  atRisk: false,
  reason: null,
})

export function emptyLiveComputerExecutiveState(): LiveComputerExecutiveState {
  return {
    attempts: [],
    coverage: emptyCoverage(),
    coverageStallCount: 0,
    interventions: 0,
    lastTriggerKey: null,
    lastDecision: null,
    budget: emptyBudget(),
  }
}

const normalized = (value: string): string => value
  .toLocaleLowerCase()
  .replace(/https?:\/\/[^\s]+/gu, ' url ')
  .replace(/\b\d+(?:\.\d+)?\b/gu, ' # ')
  .replace(/[^a-z0-9#]+/gu, ' ')
  .trim()
  .slice(0, 240)

const tokens = (value: string | null): Set<string> => new Set(normalized(value ?? '').split(/\s+/gu).filter((token) => token.length > 1))

const jaccard = (left: string | null, right: string | null): number => {
  const a = tokens(left)
  const b = tokens(right)
  if (a.size === 0 && b.size === 0) return 1
  const union = new Set([...a, ...b])
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  return union.size === 0 ? 0 : intersection / union.size
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex')

// Keep proposal-time routes comparable to controller-recorded route keys
// without importing the planner (the planner owns executive defaults).
const routeKeyFor = (route: string): string => {
  const value = normalized(route)
  if (/\b(?:address|location|omnibox|url)\b/iu.test(value)) return 'browser location'
  if (/\b(?:site|application|app|page|top)\b[\s\S]*\bsearch\b|\bsearch\b[\s\S]*\b(?:field|box|control)\b/iu.test(value)) return 'site search'
  if (/\b(?:contents?|heading|section|outline)\b/iu.test(value)) return 'document navigation'
  if (/\b(?:scroll|wheel|document|page)\b/iu.test(value)) return 'document scroll'
  return value
}

export function classifyLiveComputerStrategyFamily(input: Pick<LiveComputerAction | LiveComputerTransition, 'kind' | 'route'>): LiveComputerStrategyFamily {
  if (input.kind === 'conclude') return 'content_extraction'
  if (input.kind === 'apply_artifact') return 'artifact_commit'
  if (input.kind === 'wait') return 'wait_observe'
  if (input.kind === 'new_tab' || input.kind === 'cycle_tab' || input.kind === 'switch_window') return 'workspace_navigation'
  const route = normalized(input.route)
  if (/\b(?:search|query|results?|discovery)\b/iu.test(route)) return 'search_discovery'
  if (/\b(?:address|location|url|direct|navigate|destination)\b/iu.test(route)) return 'direct_navigation'
  if (input.kind === 'click' || input.kind === 'scroll' || input.kind === 'keypress' || input.kind === 'move') return 'in_page_navigation'
  if (input.kind === 'type' || input.kind === 'type_into' || input.kind === 'enter_sequence') return 'in_page_navigation'
  return 'other'
}

export function liveComputerCoverageSnapshot(ledger: Pick<LiveComputerTaskLedger, 'outcomeContract' | 'artifacts' | 'requirementResolutions'> & Partial<Pick<LiveComputerTaskLedger, 'objectives'>>): LiveComputerCoverageSnapshot {
  if (ledger.outcomeContract?.requirements) {
    const products = ledger.outcomeContract.requirements.products
    const accepted = ledger.artifacts.map(a => ({ a, coverage: requirementArtifactCoverage(a, ledger)! }))
    const complete = requirementsContentReady({ ...ledger, objectives: ledger.objectives ?? [] })
    const unmet = new Set(unmetProductRequirements({ ...ledger, objectives: ledger.objectives ?? [] }).map(p => p.requirementId))
    const ready = new Set(products.filter(p => !unmet.has(p.id)).map(p => p.id))
    const acquired = new Set(accepted.filter(x => {
      const product = products.find(p => p.id === x.coverage.requirementId)
      return product && (!product.sourceEntityId || sourceRequirementProducer({ objectives: ledger.objectives ?? [] }, product) === x.a.sourceObjectiveId)
    }).map(x => x.coverage.requirementId))
    return { complete, score: complete ? 1 : products.length ? (ready.size * .8 + acquired.size * .2) / products.length : 1,
      presentFields: accepted.flatMap(x => x.coverage.presentFields), itemCount: accepted.reduce((n, x) => n + x.coverage.itemCount, 0),
      filledCells: accepted.reduce((n, x) => n + x.a.rows.flat().filter(v => v.trim()).length, 0), requiredCells: 0 }
  }
  const contract = ledger.outcomeContract?.deliverable
  if (!contract || contract.kind === 'none') return { ...emptyCoverage(), complete: true, score: 1 }
  const matching = ledger.artifacts.filter((artifact) => artifact.kind === contract.kind)
  if (matching.length === 0) return emptyCoverage()
  const requiredFields = contract.fields.map((field) => field.toLocaleLowerCase())
  const minimumItems = Math.max(1, contract.minimumRecords)
  const snapshots = matching.map((artifact): LiveComputerCoverageSnapshot => {
    if (artifact.kind !== 'record_set') {
      const itemCount = artifact.content?.trim() ? 1 : 0
      return {
        complete: artifact.coverage.complete,
        presentFields: [],
        itemCount,
        filledCells: itemCount,
        requiredCells: 1,
        score: artifact.coverage.complete ? 1 : itemCount,
      }
    }
    const columnIndexes = new Map(artifact.columns.map((column, index) => [column.toLocaleLowerCase(), index]))
    const presentFields = contract.fields.filter((field) => columnIndexes.has(field.toLocaleLowerCase()))
    const rows = artifact.rows.slice(0, minimumItems)
    const requiredCells = Math.max(1, requiredFields.length * minimumItems)
    let filledCells = 0
    for (const row of rows) {
      for (const field of requiredFields) {
        const index = columnIndexes.get(field)
        if (index !== undefined && row[index]?.trim()) filledCells += 1
      }
    }
    const fieldRatio = requiredFields.length === 0 ? 1 : presentFields.length / requiredFields.length
    const itemRatio = Math.min(1, artifact.rows.length / minimumItems)
    const cellRatio = Math.min(1, filledCells / requiredCells)
    return {
      complete: artifact.coverage.complete,
      presentFields,
      itemCount: artifact.rows.length,
      filledCells,
      requiredCells,
      score: artifact.coverage.complete ? 1 : Number((fieldRatio * 0.25 + itemRatio * 0.25 + cellRatio * 0.5).toFixed(4)),
    }
  })
  return snapshots.sort((left, right) => right.score - left.score)[0] ?? emptyCoverage()
}

const objectiveFinishCost = (kind: LiveComputerObjectiveKind): number => {
  if (kind === 'perform_commit') return 2
  if (kind === 'verify_outcome') return 1
  if (kind === 'extract_information') return 2
  return 1
}

export function forecastLiveComputerBudget(ledger: LiveComputerTaskLedger, maxActions: number, actionCount: number): LiveComputerBudgetForecast {
  const pending = ledger.objectives.filter((objective) => objective.status !== 'verified')
  const remainingSessionActions = Math.max(0, maxActions - actionCount)
  const latestPlacement = ledger.transitions.findLast(t => t.kind === 'apply_artifact' && t.artifactUnit != null)
  const activeArtifact = latestPlacement && ledger.artifacts.find(a => a.id === latestPlacement.artifactId)
  let placementCost = 2
  if (activeArtifact && latestPlacement) {
    const count = artifactPlacementText(activeArtifact, latestPlacement).total
    const latestEffects = [...new Map(ledger.transitions.filter(t => t.effect).map(t => [t.effect!.operationId, t])).values()]
    const confirmed = new Set(latestEffects.filter(t => t.artifactId === activeArtifact.id
      && t.artifactLayout === latestPlacement.artifactLayout && t.artifactUnit != null
      && t.effect?.state === 'applied' && t.actionReceipt?.targetWindowId === latestPlacement.actionReceipt?.targetWindowId).map(t => t.artifactUnit))
    // Each missing portion needs an edit and may need navigation. Transport
    // completion and a budget grant never count as observed placement.
    placementCost = Math.max(1, (count - confirmed.size) * 2)
  }
  const estimatedFinishActions = pending.reduce((total, objective) => total + (objective.kind === 'perform_commit' ? placementCost : objectiveFinishCost(objective.kind)), 0)
  const needsArtifact = ledger.outcomeContract?.deliverable.kind !== 'none'
    && !requirementsContentReady({ ...ledger, objectives: ledger.objectives ?? [] })
  const commitAndVerify = pending.filter((objective) => objective.kind === 'perform_commit' || objective.kind === 'verify_outcome').length
  const protectedActions = Math.max(
    liveBudgetPolicy.minimumFinishReserveActions,
    commitAndVerify + (needsArtifact ? 1 : 0),
  )
  const discretionaryActions = Math.max(0, remainingSessionActions - Math.max(protectedActions, estimatedFinishActions))
  const atRisk = pending.length > 0 && remainingSessionActions <= Math.max(protectedActions, estimatedFinishActions)
  return {
    remainingSessionActions,
    estimatedFinishActions,
    protectedActions,
    discretionaryActions,
    atRisk,
    reason: atRisk
      ? `Only ${remainingSessionActions} actions remain; completing the ${pending.length} unfinished objectives is estimated to require ${estimatedFinishActions}, including a protected ${protectedActions}-action finalization reserve.`
      : null,
  }
}

const evidenceEpoch = (ledger: LiveComputerTaskLedger): string => hash(JSON.stringify({
  decisionDigest: decisionContext(ledger).digest,
  facts: ledger.facts,
  artifacts: ledger.artifacts.map((artifact) => ({
    id: artifact.id,
    sequence: artifact.verifiedAtSequence,
    score: artifact.coverage.complete ? 1 : artifact.coverage.itemCount,
    fields: artifact.coverage.presentFields,
  })),
  graph: ledger.executionGraphVersion,
}))

export function liveComputerAttemptSimilarity(left: LiveComputerAttempt, right: LiveComputerAttempt): number {
  const family = left.family === right.family ? 0.42 : 0
  const objective = left.objectiveKind === right.objectiveKind ? 0.16 : 0
  const route = left.routeKey === right.routeKey ? 0.16 : 0.16 * jaccard(left.routeKey, right.routeKey)
  const target = 0.16 * jaccard(left.target, right.target)
  const failure = left.failureCause && left.failureCause === right.failureCause ? 0.1 : 0
  return Number((family + objective + route + target + failure).toFixed(4))
}

function attemptLike(
  ledger: LiveComputerTaskLedger,
  input: Pick<LiveComputerAction | LiveComputerTransition, 'kind' | 'route' | 'objectiveId' | 'targetLabel' | 'expectedState' | 'targetingMode' | 'artifactUnit'> & { routeKey?: string },
): LiveComputerAttempt {
  const objective = ledger.objectives.find((candidate) => candidate.id === input.objectiveId)
  const routeKey = routeKeyFor(input.routeKey ?? input.route)
  const family = objective?.kind === 'verify_outcome' ? 'verification' : classifyLiveComputerStrategyFamily(input)
  const target = input.targetLabel?.trim().slice(0, 240) ?? null
  const key = hash(JSON.stringify({ family, routeKey, target: normalized(target ?? ''), action: input.kind, targetingMode: input.targetingMode ?? 'semantic', artifactUnit: input.artifactUnit ?? null, objectiveKind: objective?.kind ?? 'verify_outcome' }))
  return {
    id: 'prospective', sequence: 0, objectiveId: input.objectiveId,
    objectiveKind: objective?.kind ?? 'verify_outcome', actionKind: input.kind,
    routeKey, family, target, expectedState: input.expectedState,
    observedState: '', status: 'failed', semanticProgress: false,
    failureCause: null, evidence: [], beforeCoverage: ledger.executive?.coverage ?? emptyCoverage(),
    afterCoverage: ledger.executive?.coverage ?? emptyCoverage(), coverageDelta: 0,
    actionCost: 1,
    frameSha256: 'frameSha256' in input && (typeof input.frameSha256 === 'string' || input.frameSha256 === null)
      ? input.frameSha256
      : null,
    decisionDigest: decisionContext(ledger).digest,
    similarityKey: key, evidenceEpoch: evidenceEpoch(ledger),
  }
}

export function recordLiveComputerAttempt(ledger: LiveComputerTaskLedger, transition: LiveComputerTransition): LiveComputerAttempt {
  const before = transition.coverageBefore ?? ledger.executive.coverage ?? emptyCoverage()
  const after = liveComputerCoverageSnapshot(ledger)
  const seed = attemptLike(ledger, transition)
  const attempt: LiveComputerAttempt = {
    ...seed,
    id: `attempt_${transition.sequence}`,
    sequence: transition.sequence,
    observedState: transition.observedState ?? 'No verifier observation was recorded.',
    status: transition.status === 'verified' ? 'succeeded' : transition.status === 'progressed' ? 'progressed' : ['unresolved', 'awaiting_verification'].includes(transition.status) ? 'pending' : 'failed',
    semanticProgress: transition.semanticProgress === true,
    failureCause: transition.failureCause,
    evidence: [...transition.evidence],
    beforeCoverage: before,
    afterCoverage: after,
    coverageDelta: Number((after.score - before.score).toFixed(4)),
  }
  const prior = ledger.executive.attempts.filter((candidate) => candidate.sequence !== transition.sequence)
  ledger.executive.attempts = [...prior, attempt].sort((left, right) => left.sequence - right.sequence).slice(-liveBudgetPolicy.maxRememberedAttempts)
  ledger.executive.coverage = after
  // Derive stalls from unique settled attempts. Updating a pending operation
  // after another observation must not count the same attempt twice.
  let stalls = 0
  for (const recorded of ledger.executive.attempts) {
    if (recorded.status === 'pending') continue
    if (recorded.coverageDelta > 0 || recorded.status === 'succeeded' && recorded.semanticProgress) stalls = 0
    else if (recorded.status === 'failed' || !recorded.semanticProgress) stalls += 1
  }
  ledger.executive.coverageStallCount = stalls
  return attempt
}

export function refreshLiveComputerExecutive(ledger: LiveComputerTaskLedger, maxActions: number, actionCount: number): void {
  ledger.executive ??= emptyLiveComputerExecutiveState()
  ledger.executive.coverage = liveComputerCoverageSnapshot(ledger)
  ledger.executive.budget = forecastLiveComputerBudget(ledger, maxActions, actionCount)
}

export function liveComputerExecutiveTrigger(
  ledger: LiveComputerTaskLedger,
  maxActions: number,
  actionCount: number,
  proposedAction?: LiveComputerAction | null,
  currentFrameSha256?: string | null,
): LiveComputerExecutiveTrigger | null {
  refreshLiveComputerExecutive(ledger, maxActions, actionCount)
  const attempts = ledger.executive.attempts
  const latest = attempts.at(-1)
  if (proposedAction) {
    const prospective = attemptLike(ledger, proposedAction)
    if (proposedAction.kind === 'wait') {
      const repeatedWait = [...attempts].reverse().find((attempt) => attempt.actionKind === 'wait'
        && attempt.objectiveId === proposedAction.objectiveId
        && attempt.decisionDigest === decisionContext(ledger).digest
        && (!currentFrameSha256 || !attempt.frameSha256 || attempt.frameSha256 === currentFrameSha256))
      if (repeatedWait?.status === 'pending') return null
      if (repeatedWait) {
        return {
          key: `no-input-repeat:${proposedAction.objectiveId}:${currentFrameSha256 ?? 'no-frame'}:${repeatedWait.evidenceEpoch}`,
          reason: 'exact_failed_repeat',
          summary: 'A no-input criterion check already inspected this unchanged objective and frame. Waiting again cannot create evidence.',
          analogousAttemptIds: [repeatedWait.id],
          exactRepeat: true,
        }
      }
    }
    const similar = attempts
      .filter((attempt) => attempt.status === 'failed')
      .map((attempt) => ({ attempt, similarity: liveComputerAttemptSimilarity(prospective, attempt) }))
      .filter((entry) => entry.similarity >= liveBudgetPolicy.analogousAttemptThreshold)
      .sort((left, right) => right.similarity - left.similarity)
    const exact = similar.find((entry) => entry.attempt.similarityKey === prospective.similarityKey
      && entry.attempt.evidenceEpoch === prospective.evidenceEpoch
      && entry.attempt.decisionDigest === prospective.decisionDigest
      && (!currentFrameSha256 || !entry.attempt.frameSha256 || entry.attempt.frameSha256 === currentFrameSha256))
    if (exact) {
      return {
        key: `exact:${prospective.similarityKey}:${prospective.evidenceEpoch}`,
        reason: 'exact_failed_repeat',
        summary: 'The proposed tactic exactly repeats a failed attempt without any new verified evidence.',
        analogousAttemptIds: [exact.attempt.id],
        exactRepeat: true,
      }
    }
    if (similar.length > 0) {
      return {
        key: `analogy:${prospective.similarityKey}:${similar.slice(0, 3).map((entry) => entry.attempt.id).join(',')}:${currentFrameSha256 ?? 'no-frame'}`,
        reason: 'analogous_failed_attempt',
        summary: 'The proposed tactic is materially similar to one or more failed attempts; similarity may be useful or may repeat the same mistake.',
        analogousAttemptIds: similar.slice(0, 3).map((entry) => entry.attempt.id),
        exactRepeat: false,
      }
    }
    const objective = ledger.objectives.find((candidate) => candidate.id === proposedAction.objectiveId)
    const structuredWorkProduct = ledger.outcomeContract?.deliverable.kind === 'record_set'
      || ledger.artifacts.some((artifact) => artifact.kind === 'record_set')
    if (proposedAction.kind === 'apply_artifact' || objective?.kind === 'perform_commit' && structuredWorkProduct) {
      return {
        key: `write:${proposedAction.objectiveId}:${proposedAction.kind}:${ledger.executive.coverage.score}`,
        reason: 'write_boundary',
        summary: 'The next decision crosses the final work-product write boundary and deserves an outcome-level preflight.',
        analogousAttemptIds: [],
        exactRepeat: false,
      }
    }
  }
  const structuredWorkProduct = ledger.outcomeContract?.deliverable.kind === 'record_set'
  if (ledger.executive.budget.atRisk
    && (actionCount >= liveBudgetPolicy.minimumFinishReserveActions || structuredWorkProduct)) {
    return {
      key: `budget:${actionCount}:${ledger.currentObjectiveId}:${ledger.executive.budget.estimatedFinishActions}`,
      reason: 'finish_budget_at_risk',
      summary: ledger.executive.budget.reason ?? 'The finish reserve is at risk.',
      analogousAttemptIds: [],
      exactRepeat: false,
    }
  }
  if (ledger.executive.coverageStallCount >= liveBudgetPolicy.coverageStallActions) {
    return {
      key: `coverage:${latest?.sequence ?? 0}:${ledger.executive.coverage.score}`,
      reason: 'work_product_stall',
      summary: `${ledger.executive.coverageStallCount} consecutive attempts produced no measurable work-product coverage.`,
      analogousAttemptIds: latest ? [latest.id] : [],
      exactRepeat: false,
    }
  }
  if (latest?.status === 'failed'
    && (attempts.filter((attempt) => attempt.status === 'failed').length >= 2
      || ledger.strategy?.generatedBy === 'strategy_arbiter')) {
    return {
      key: `failure:${latest.id}:${latest.failureCause ?? 'unknown'}`,
      reason: 'verification_failure',
      summary: `The latest tactic failed verification: ${latest.observedState}`,
      analogousAttemptIds: [latest.id],
      exactRepeat: false,
    }
  }
  return null
}

export function applyLiveComputerExecutiveDecision(
  ledger: LiveComputerTaskLedger,
  trigger: LiveComputerExecutiveTrigger,
  decision: LiveComputerExecutiveDecision,
  reviewedAction?: LiveComputerAction | null,
): void {
  ledger.executive.interventions += 1
  ledger.executive.lastTriggerKey = trigger.key
  ledger.executive.lastDecision = {
    ...decision,
    trigger: trigger.reason,
    atSequence: ledger.transitions.at(-1)?.sequence ?? 0,
    // A review before proposal generation refers to the failed attempt, not
    // to every future action in the same evidence epoch. Bind only a known
    // failed tactic; absence is not a wildcard rejection.
    rejectedTactic: reviewedAction ? liveComputerTacticSignature(ledger, reviewedAction)
      : [...ledger.executive.attempts].reverse().find(attempt => attempt.status === 'failed'
        && trigger.analogousAttemptIds.includes(attempt.id))?.similarityKey ?? null,
  }
}

/** The tactic identity the executive reasons about: family, route, target,
 * action kind, and objective kind — never coordinates or typed text. */
export function liveComputerTacticSignature(ledger: LiveComputerTaskLedger, action: LiveComputerAction): string {
  return attemptLike(ledger, action).similarityKey
}

export function liveComputerExecutivePromptSummary(ledger: LiveComputerTaskLedger): object {
  return {
    coverage: ledger.executive.coverage,
    budget: ledger.executive.budget,
    coverageStallCount: ledger.executive.coverageStallCount,
    lastDecision: ledger.executive.lastDecision,
    attempts: ledger.executive.attempts.slice(-12).map((attempt) => ({
      id: attempt.id,
      objectiveKind: attempt.objectiveKind,
      actionKind: attempt.actionKind,
      family: attempt.family,
      routeKey: attempt.routeKey,
      target: attempt.target,
      status: attempt.status,
      observedState: attempt.observedState,
      failureCause: attempt.failureCause,
      semanticProgress: attempt.semanticProgress,
      coverageDelta: attempt.coverageDelta,
      evidence: attempt.evidence,
    })),
  }
}
