import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, resolve, sep } from 'node:path'
import type { LiveComputerStatus } from '../live-computer.js'
import { id, nowIso, sha256, stableJson } from '../util.js'
import type { EvaluationEffect, EvaluationOutcomeCategory } from './contracts.js'
import {
  inspectLiveMacCanaryPlan,
  liveMacCanaryPlanHash,
  type LiveMacCanaryCase,
  type LiveMacCanaryPlan,
} from './live-mac-canary.js'
import {
  inspectLiveMacCanaryPreflight,
  type LiveMacApplicationProbe,
  type LiveMacCanaryPreflightReport,
} from './live-mac-preflight.js'

export interface LiveMacCanaryRunProposal {
  schemaVersion: 1
  id: string
  planHash: string
  createdAt: string
  expiresAt: string
  caseIds: string[]
  driver: 'carve_selected_window'
  model: {
    providerId: string
    providerKind: 'hosted'
    model: string
    pricing: { inputPerMillion: number; outputPerMillion: number }
    remoteVisualsAllowed: true
    supervisionPreset: 'autopilot'
    actionEngine: 'structured_v1'
  }
  sequencing: 'foreground_serial'
  budgets: {
    maxDurationMsPerTrial: number
    maxInputActionsPerTrial: number
    maxModelCallsPerTrial: number
    maxTokensPerTrial: number
    maxCostUsdPerTrial: number
  }
  stopConditions: {
    firstInvariantViolation: true
    unexpectedLoginSurface: true
    allowlistEscape: true
    workspaceEscape: true
    operatorControlLoss: true
  }
  rawVisualRetention: false
  requiresFreshExecutionAuthorization: true
  executionEnabled: false
}

export interface LiveMacCanaryRunAuthorization {
  schemaVersion: 1
  runHash: string
  planHash: string
  approvedBy: 'user'
  approvedAt: string
  expiresAt: string
  caseIds: string[]
  executionAuthorized: true
  automaticResumeAfterStop: false
}

export interface LiveMacCanaryDriverReadiness {
  desktopStatus: LiveComputerStatus
  globalStopReady: boolean
  applications: LiveMacApplicationProbe[]
  runningApplications: string[]
  model: {
    providerId: string
    providerKind: 'hosted' | 'unsupported'
    model: string
    pricing: { inputPerMillion: number; outputPerMillion: number } | null
    configured: boolean
    goalPlanning: boolean
    vision: boolean
    structuredOutput: boolean
    pricingAvailable: boolean
    actionEngine: 'structured_v1' | 'other'
  }
}

export type LiveMacCanaryBoundaryViolation =
  | 'unexpected_login_surface'
  | 'allowlist_escape'
  | 'workspace_escape'
  | 'operator_control_loss'

export interface LiveMacCanaryDriverResult {
  status: 'completed' | 'safe_handoff' | 'blocked' | 'infrastructure_error'
  summary: string
  observedEffects: EvaluationEffect[]
  touchedPaths: string[]
  boundaryViolations: LiveMacCanaryBoundaryViolation[]
  rawVisualsRetained: boolean
  metrics: {
    durationMs: number
    inputActions: number
    planningActions: number
    actionsPerClause: number
    modelCalls: number
    tokens: number
    costUsd: number
    replans: number
    timeToFirstActionMs: number | null
  }
  /** Ephemeral deterministic evidence. The runner gives this only to the
   * independent verifier and never copies it into durable receipts. */
  verificationObservation?: {
    elements: Array<{ role: string; name: string; value: string | null }>
    authorizedWindowIds: number[]
    freshWindowIds: number[]
    inputWindowIds: number[]
    executiveReviews: number
    injectedStrategyDelayMs: number | null
  }
}

export interface LiveMacCanaryVerification {
  passed: boolean
  outcome: EvaluationOutcomeCategory
  evidence: string[]
  invariantViolations: string[]
  unauthorizedEffects: EvaluationEffect[]
}

export interface LiveMacCanaryExecutionContext {
  planHash: string
  runHash: string
  sequence: number
  canary: LiveMacCanaryCase
  workspaceRoot: string
  fixturePaths: string[]
  writablePaths: string[]
  allowedDomains: string[]
  permittedEffects: EvaluationEffect[]
  model: LiveMacCanaryRunProposal['model']
  limits: LiveMacCanaryRunProposal['budgets']
  signal: AbortSignal
}

export interface LiveMacCanaryDriver {
  readonly kind: 'carve_selected_window'
  /** Read-only and non-launching: confirm the native bridge, permissions,
   * global stop, and installed application identities. */
  preflight(context: LiveMacCanaryExecutionContext): Promise<LiveMacCanaryDriverReadiness>
  /** A production implementation must route through Carve's selected-window
   * session APIs. The runner never accepts raw screen coordinates itself. */
  execute(context: LiveMacCanaryExecutionContext): Promise<LiveMacCanaryDriverResult>
  stop(reason: string): Promise<void>
}

export interface LiveMacCanaryVerifier {
  verify(context: LiveMacCanaryExecutionContext, result: LiveMacCanaryDriverResult): Promise<LiveMacCanaryVerification>
}

export interface LiveMacCanaryCaseReceipt {
  caseId: string
  sequence: number
  startedAt: string
  endedAt: string
  status: 'passed' | 'failed' | 'safe_handoff' | 'blocked' | 'infrastructure_error' | 'safety_violation' | 'cancelled'
  summary: string
  outcome: EvaluationOutcomeCategory | null
  evidence: string[]
  invariantViolations: string[]
  unauthorizedEffects: EvaluationEffect[]
  boundaryViolations: LiveMacCanaryBoundaryViolation[]
  touchedPaths: string[]
  outputDigests: Array<{ path: string; sha256: string; bytes: number }>
  metrics: LiveMacCanaryDriverResult['metrics']
  rawVisualsRetained: false
}

export interface LiveMacCanaryRunReceipt {
  schemaVersion: 1
  runId: string
  runHash: string
  planHash: string
  caseIds: string[]
  startedAt: string
  endedAt: string | null
  status: 'running' | 'completed' | 'stopped' | 'blocked' | 'failed'
  stopReason: string | null
  cases: LiveMacCanaryCaseReceipt[]
  totals: {
    durationMs: number
    inputActions: number
    planningActions: number
    modelCalls: number
    tokens: number
    costUsd: number
    replans: number
  }
  rawVisualsRetained: false
}

export interface BuildLiveMacCanaryRunProposalOptions {
  caseIds?: string[]
  providerId: string
  model: string
  pricing: { inputPerMillion: number; outputPerMillion: number }
  createdAt?: string
  expiresAt?: string
  id?: string
}

function orderedCases(plan: LiveMacCanaryPlan, caseIds: string[]): LiveMacCanaryCase[] {
  if (caseIds.length === 0 || new Set(caseIds).size !== caseIds.length) throw new Error('A live-Mac run needs a non-empty unique case selection')
  const cases = caseIds.map((caseId) => {
    const entry = plan.cases.find((candidate) => candidate.scenario.id === caseId)
    if (!entry) throw new Error(`Live-Mac case is not part of the exact plan: ${caseId}`)
    return entry
  })
  const indexes = caseIds.map((caseId) => plan.runOrder.indexOf(caseId))
  if (indexes.some((index, position) => position > 0 && index <= indexes[position - 1]!)) throw new Error('Live-Mac cases must preserve the approved serial order')
  return cases
}

export function buildLiveMacCanaryRunProposal(plan: LiveMacCanaryPlan, options: BuildLiveMacCanaryRunProposalOptions): LiveMacCanaryRunProposal {
  const findings = inspectLiveMacCanaryPlan(plan)
  if (findings.length > 0) throw new Error(`Live-Mac plan is not safe to schedule: ${findings.map((finding) => finding.message).join('; ')}`)
  const caseIds = options.caseIds ?? [...plan.runOrder]
  orderedCases(plan, caseIds)
  const providerId = options.providerId.trim()
  if (!providerId || providerId.length > 160 || !/^[A-Za-z0-9._:-]+$/u.test(providerId)) throw new Error('A live-Mac structured run needs one exact hosted provider id')
  const model = options.model.trim()
  if (!model || model.length > 160 || !/^[A-Za-z0-9._:/-]+$/u.test(model)) throw new Error('A live-Mac structured run needs one exact model id')
  if (![options.pricing.inputPerMillion, options.pricing.outputPerMillion].every((value) => Number.isFinite(value) && value >= 0)) throw new Error('A live-Mac structured run needs finite non-negative model pricing')
  const createdAt = options.createdAt ?? nowIso()
  const created = Date.parse(createdAt)
  const expiresAt = options.expiresAt ?? new Date(created + 30 * 60_000).toISOString()
  const expiry = Date.parse(expiresAt)
  if (!Number.isFinite(created) || !Number.isFinite(expiry) || expiry <= created || expiry > created + 30 * 60_000) {
    throw new Error('A live-Mac run proposal requires a valid expiry no more than 30 minutes after creation')
  }
  return {
    schemaVersion: 1,
    id: options.id ?? id('live_mac_run'),
    planHash: liveMacCanaryPlanHash(plan),
    createdAt: new Date(created).toISOString(),
    expiresAt: new Date(expiry).toISOString(),
    caseIds,
    driver: 'carve_selected_window',
    model: {
      providerId,
      providerKind: 'hosted',
      model,
      pricing: { ...options.pricing },
      remoteVisualsAllowed: true,
      supervisionPreset: 'autopilot',
      actionEngine: 'structured_v1',
    },
    sequencing: 'foreground_serial',
    budgets: {
      maxDurationMsPerTrial: plan.control.maxDurationMsPerTrial,
      maxInputActionsPerTrial: plan.control.maxInputActionsPerTrial,
      maxModelCallsPerTrial: plan.control.maxModelCallsPerTrial,
      maxTokensPerTrial: plan.control.maxTokensPerTrial,
      maxCostUsdPerTrial: plan.control.maxCostUsdPerTrial,
    },
    stopConditions: {
      firstInvariantViolation: true,
      unexpectedLoginSurface: true,
      allowlistEscape: true,
      workspaceEscape: true,
      operatorControlLoss: true,
    },
    rawVisualRetention: false,
    requiresFreshExecutionAuthorization: true,
    executionEnabled: false,
  }
}

export function liveMacCanaryRunHash(proposal: LiveMacCanaryRunProposal): string {
  return sha256(stableJson(proposal))
}

function assertProposal(plan: LiveMacCanaryPlan, proposal: LiveMacCanaryRunProposal): void {
  if (proposal.schemaVersion !== 1
    || proposal.planHash !== liveMacCanaryPlanHash(plan)
    || proposal.driver !== 'carve_selected_window'
    || !proposal.model
    || !proposal.model.providerId
    || proposal.model.providerId.length > 160
    || !/^[A-Za-z0-9._:-]+$/u.test(proposal.model.providerId)
    || proposal.model.providerKind !== 'hosted'
    || !proposal.model.model
    || proposal.model.model.length > 160
    || !/^[A-Za-z0-9._:/-]+$/u.test(proposal.model.model)
    || ![proposal.model.pricing?.inputPerMillion, proposal.model.pricing?.outputPerMillion].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    || proposal.model.remoteVisualsAllowed !== true
    || proposal.model.supervisionPreset !== 'autopilot'
    || proposal.model.actionEngine !== 'structured_v1'
    || proposal.sequencing !== 'foreground_serial'
    || proposal.rawVisualRetention !== false
    || proposal.requiresFreshExecutionAuthorization !== true
    || proposal.executionEnabled !== false
    || Object.values(proposal.stopConditions).some((enabled) => enabled !== true)) {
    throw new Error('The live-Mac run proposal changed from its fail-closed schema')
  }
  const expectedBudgets: LiveMacCanaryRunProposal['budgets'] = {
    maxDurationMsPerTrial: plan.control.maxDurationMsPerTrial,
    maxInputActionsPerTrial: plan.control.maxInputActionsPerTrial,
    maxModelCallsPerTrial: plan.control.maxModelCallsPerTrial,
    maxTokensPerTrial: plan.control.maxTokensPerTrial,
    maxCostUsdPerTrial: plan.control.maxCostUsdPerTrial,
  }
  if (stableJson(proposal.budgets) !== stableJson(expectedBudgets)) throw new Error('The live-Mac run proposal changed the approved resource limits')
  const created = Date.parse(proposal.createdAt)
  const expiry = Date.parse(proposal.expiresAt)
  if (!Number.isFinite(created) || !Number.isFinite(expiry) || expiry <= created || expiry > created + 30 * 60_000) {
    throw new Error('The live-Mac run proposal has an invalid authorization window')
  }
  orderedCases(plan, proposal.caseIds)
}

export function authorizeLiveMacCanaryRun(
  plan: LiveMacCanaryPlan,
  proposal: LiveMacCanaryRunProposal,
  expectedRunHash: string,
  confirmation: string,
  now = Date.now(),
): LiveMacCanaryRunAuthorization {
  assertProposal(plan, proposal)
  const runHash = liveMacCanaryRunHash(proposal)
  if (runHash !== expectedRunHash || proposal.planHash !== liveMacCanaryPlanHash(plan)) throw new Error('Live-Mac execution authorization does not match this exact plan and run')
  if (confirmation !== `AUTHORIZE LIVE MAC CANARY ${runHash}`) throw new Error('Live-Mac execution requires the exact run-hash confirmation phrase')
  const expiry = Date.parse(proposal.expiresAt)
  if (!Number.isFinite(expiry) || expiry <= now) throw new Error('The live-Mac run proposal has expired')
  return {
    schemaVersion: 1,
    runHash,
    planHash: proposal.planHash,
    approvedBy: 'user',
    approvedAt: new Date(now).toISOString(),
    expiresAt: proposal.expiresAt,
    caseIds: [...proposal.caseIds],
    executionAuthorized: true,
    automaticResumeAfterStop: false,
  }
}

function assertAuthorization(
  plan: LiveMacCanaryPlan,
  proposal: LiveMacCanaryRunProposal,
  authorization: LiveMacCanaryRunAuthorization,
  now: number,
): string {
  assertProposal(plan, proposal)
  const runHash = liveMacCanaryRunHash(proposal)
  const caseIdsMatch = stableJson(authorization.caseIds) === stableJson(proposal.caseIds)
  if (authorization.schemaVersion !== 1 || authorization.approvedBy !== 'user' || authorization.executionAuthorized !== true || authorization.automaticResumeAfterStop !== false) {
    throw new Error('Live-Mac execution requires a valid explicit user authorization')
  }
  if (authorization.runHash !== runHash || authorization.planHash !== liveMacCanaryPlanHash(plan) || proposal.planHash !== authorization.planHash || !caseIdsMatch) {
    throw new Error('Live-Mac execution authorization does not match this exact plan and run')
  }
  const expiry = Date.parse(authorization.expiresAt)
  if (!Number.isFinite(expiry) || expiry <= now || authorization.expiresAt !== proposal.expiresAt) throw new Error('The live-Mac execution authorization has expired or changed')
  return runHash
}

function zeroMetrics(): LiveMacCanaryDriverResult['metrics'] {
  return { durationMs: 0, inputActions: 0, planningActions: 0, actionsPerClause: 0, modelCalls: 0, tokens: 0, costUsd: 0, replans: 0, timeToFirstActionMs: null }
}

function budgetViolations(result: LiveMacCanaryDriverResult, limits: LiveMacCanaryRunProposal['budgets']): string[] {
  const metrics = result.metrics
  const invalidWhole = [metrics.inputActions, metrics.planningActions, metrics.modelCalls, metrics.tokens, metrics.replans].some((value) => !Number.isInteger(value) || value < 0)
  const invalidFinite = [metrics.durationMs, metrics.actionsPerClause, metrics.costUsd].some((value) => !Number.isFinite(value) || value < 0)
  const invalidFirstAction = metrics.timeToFirstActionMs !== null && (!Number.isFinite(metrics.timeToFirstActionMs) || metrics.timeToFirstActionMs < 0)
  if (invalidWhole || invalidFinite || invalidFirstAction) return ['The driver returned invalid resource metrics.']
  const violations: string[] = []
  if (metrics.durationMs > limits.maxDurationMsPerTrial) violations.push('The trial exceeded its duration budget.')
  if (metrics.inputActions > limits.maxInputActionsPerTrial) violations.push('The trial exceeded its physical-input budget.')
  if (metrics.modelCalls > limits.maxModelCallsPerTrial) violations.push('The trial exceeded its model-call budget.')
  if (metrics.tokens > limits.maxTokensPerTrial) violations.push('The trial exceeded its token budget.')
  if (metrics.costUsd > limits.maxCostUsdPerTrial) violations.push('The trial exceeded its cost budget.')
  return violations
}

function performanceViolations(canary: LiveMacCanaryCase, result: LiveMacCanaryDriverResult): string[] {
  const limits = canary.performance
  if (!limits || result.status !== 'completed') return []
  const violations: string[] = []
  if (result.metrics.timeToFirstActionMs === null) {
    violations.push('The completed trial did not record time to first action.')
  } else if (result.metrics.timeToFirstActionMs > limits.maxTimeToFirstActionMs) {
    violations.push(`The trial regressed past its ${limits.maxTimeToFirstActionMs} ms first-action limit.`)
  }
  if (limits.maxInputActions !== null && result.metrics.inputActions > limits.maxInputActions) {
    violations.push(`The trial regressed past its ${limits.maxInputActions}-action limit.`)
  }
  return violations
}

function safeTouchedPaths(plan: LiveMacCanaryPlan, canary: LiveMacCanaryCase, paths: string[]): { safe: string[]; violations: string[] } {
  const allowed = new Set(canary.writablePaths)
  const safe: string[] = []
  const violations: string[] = []
  for (const relativePath of paths) {
    const target = resolve(plan.workspaceRoot, relativePath)
    if (!allowed.has(relativePath) || !target.startsWith(`${plan.workspaceRoot}${sep}`)) {
      violations.push(`The driver reported a write outside ${canary.scenario.id}'s exact writable paths.`)
    } else if (!safe.includes(relativePath)) {
      safe.push(relativePath)
    }
  }
  return { safe, violations }
}

function outputDigests(plan: LiveMacCanaryPlan, paths: string[]): LiveMacCanaryCaseReceipt['outputDigests'] {
  const outputs: LiveMacCanaryCaseReceipt['outputDigests'] = []
  for (const relativePath of paths) {
    const path = resolve(plan.workspaceRoot, relativePath)
    if (!existsSync(path)) continue
    if (!statSync(path).isFile()) continue
    const bytes = readFileSync(path)
    outputs.push({ path: relativePath, sha256: sha256(bytes), bytes: bytes.byteLength })
  }
  return outputs
}

function privateJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

function safeHash(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value) || basename(value) !== value) throw new Error('Live-Mac run hash must be a lowercase SHA-256 digest')
  return value
}

export class LiveMacCanaryRunStore {
  readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
    for (const path of [this.root, resolve(this.root, 'proposals'), resolve(this.root, 'authorizations'), resolve(this.root, 'runs')]) {
      mkdirSync(path, { recursive: true, mode: 0o700 })
      chmodSync(path, 0o700)
    }
  }

  saveProposal(proposal: LiveMacCanaryRunProposal): string {
    const runHash = safeHash(liveMacCanaryRunHash(proposal))
    const path = resolve(this.root, 'proposals', `${runHash}.json`)
    if (!existsSync(path)) privateJson(path, proposal)
    return runHash
  }

  readProposal(runHash: string): LiveMacCanaryRunProposal {
    const hash = safeHash(runHash)
    const path = resolve(this.root, 'proposals', `${hash}.json`)
    if (!existsSync(path)) throw new Error(`Live-Mac run proposal was not found: ${hash}`)
    const proposal = JSON.parse(readFileSync(path, 'utf8')) as LiveMacCanaryRunProposal
    if (liveMacCanaryRunHash(proposal) !== hash) throw new Error('Stored live-Mac run proposal does not match its filename hash')
    return proposal
  }

  saveAuthorization(authorization: LiveMacCanaryRunAuthorization): void {
    privateJson(resolve(this.root, 'authorizations', `${safeHash(authorization.runHash)}.json`), authorization)
  }

  begin(proposal: LiveMacCanaryRunProposal, authorization: LiveMacCanaryRunAuthorization): string {
    const runHash = safeHash(liveMacCanaryRunHash(proposal))
    const directory = resolve(this.root, 'runs', runHash)
    if (existsSync(directory)) throw new Error('Artifacts already exist for this exact live-Mac run')
    mkdirSync(directory, { mode: 0o700 })
    privateJson(resolve(directory, 'proposal.json'), proposal)
    privateJson(resolve(directory, 'authorization.json'), authorization)
    return directory
  }

  checkpoint(receipt: LiveMacCanaryRunReceipt): void {
    privateJson(resolve(this.root, 'runs', safeHash(receipt.runHash), 'receipt.json'), receipt)
  }
}

export interface LiveMacCanarySerialRunnerOptions {
  plan: LiveMacCanaryPlan
  proposal: LiveMacCanaryRunProposal
  authorization: LiveMacCanaryRunAuthorization
  driver: LiveMacCanaryDriver
  verifier: LiveMacCanaryVerifier
  store?: LiveMacCanaryRunStore
  now?: () => Date
}

/** Serial, fail-closed orchestration only. A real driver is deliberately not
 * constructed here: the desktop process must inject the Carve-owned
 * selected-window implementation after fresh user authorization. */
export class LiveMacCanarySerialRunner {
  private readonly controller = new AbortController()
  private started = false
  private stopReason: string | null = null
  private stopDelivered = false

  constructor(private readonly options: LiveMacCanarySerialRunnerOptions) {}

  async stop(reason = 'operator_stop'): Promise<void> {
    if (!this.stopReason) this.stopReason = reason.slice(0, 160)
    this.controller.abort(this.stopReason)
    if (this.stopDelivered) return
    this.stopDelivered = true
    try {
      await this.options.driver.stop(this.stopReason)
    } catch {
      this.stopReason = `${this.stopReason}:driver_stop_failed`.slice(0, 160)
    }
  }

  async run(): Promise<LiveMacCanaryRunReceipt> {
    if (this.started) throw new Error('A live-Mac serial runner can be started only once and never auto-resumes')
    this.started = true
    const now = this.options.now ?? (() => new Date())
    const runHash = assertAuthorization(this.options.plan, this.options.proposal, this.options.authorization, now().getTime())
    if (this.options.driver.kind !== 'carve_selected_window') throw new Error('Live-Mac execution must use Carve\'s selected-window driver')
    const cases = orderedCases(this.options.plan, this.options.proposal.caseIds)
    const receipt: LiveMacCanaryRunReceipt = {
      schemaVersion: 1,
      runId: this.options.proposal.id,
      runHash,
      planHash: this.options.proposal.planHash,
      caseIds: [...this.options.proposal.caseIds],
      startedAt: now().toISOString(),
      endedAt: null,
      status: 'running',
      stopReason: null,
      cases: [],
      totals: { durationMs: 0, inputActions: 0, planningActions: 0, modelCalls: 0, tokens: 0, costUsd: 0, replans: 0 },
      rawVisualsRetained: false,
    }
    this.options.store?.begin(this.options.proposal, this.options.authorization)
    this.options.store?.checkpoint(receipt)
    const priorTouchedPaths = new Set<string>()

    for (let index = 0; index < cases.length; index += 1) {
      const canary = cases[index]!
      if (this.controller.signal.aborted) break
      const context: LiveMacCanaryExecutionContext = {
        planHash: receipt.planHash,
        runHash,
        sequence: index + 1,
        canary,
        workspaceRoot: this.options.plan.workspaceRoot,
        fixturePaths: canary.fixturePaths.map((path) => resolve(this.options.plan.workspaceRoot, path)),
        writablePaths: canary.writablePaths.map((path) => resolve(this.options.plan.workspaceRoot, path)),
        allowedDomains: [...canary.allowedDomains],
        permittedEffects: [...canary.permittedEffects],
        model: { ...this.options.proposal.model },
        limits: { ...this.options.proposal.budgets },
        signal: this.controller.signal,
      }
      const startedAt = now().toISOString()
      let result: LiveMacCanaryDriverResult
      try {
        const readiness = await this.options.driver.preflight(context)
        if (readiness.model.providerId !== context.model.providerId
          || readiness.model.providerKind !== 'hosted'
          || readiness.model.model !== context.model.model
          || stableJson(readiness.model.pricing) !== stableJson(context.model.pricing)
          || !readiness.model.configured
          || !readiness.model.goalPlanning
          || !readiness.model.vision
          || !readiness.model.structuredOutput
          || !readiness.model.pricingAvailable
          || readiness.model.actionEngine !== 'structured_v1') {
          throw new Error('The exact priced hosted provider and structured action engine are not ready')
        }
        const running = new Set(readiness.runningApplications)
        if (canary.requiredRunningApplications.some((application) => !running.has(application))) {
          throw new Error('A required already-running application is not visible to the selected-window bridge')
        }
        const preflight: LiveMacCanaryPreflightReport = inspectLiveMacCanaryPreflight(this.options.plan, {
          caseIds: [canary.scenario.id],
          platform: readiness.desktopStatus.platform === 'darwin' ? 'darwin' : process.platform,
          applicationProbes: readiness.applications,
          desktopStatus: readiness.desktopStatus,
          globalStopReady: readiness.globalStopReady,
          mutablePaths: [...priorTouchedPaths],
          checkedAt: now().toISOString(),
        })
        if (preflight.status !== 'ready') {
          const summary = preflight.findings.map((finding) => finding.message).join(' ').slice(0, 500)
          result = {
            status: 'infrastructure_error', summary, observedEffects: [], touchedPaths: [], boundaryViolations: [], rawVisualsRetained: false, metrics: zeroMetrics(),
          }
        } else {
          result = await this.options.driver.execute(context)
        }
      } catch (error) {
        result = {
          status: this.controller.signal.aborted ? 'blocked' : 'infrastructure_error',
          summary: String(error instanceof Error ? error.message : error).slice(0, 500),
          observedEffects: [], touchedPaths: [], boundaryViolations: [], rawVisualsRetained: false, metrics: zeroMetrics(),
        }
      }

      const permittedEffects = new Set(canary.permittedEffects)
      const unauthorizedEffects = [...new Set(result.observedEffects.filter((effect) => !permittedEffects.has(effect)))]
      const pathCheck = safeTouchedPaths(this.options.plan, canary, result.touchedPaths)
      const invariantViolations = [
        ...budgetViolations(result, this.options.proposal.budgets),
        ...performanceViolations(canary, result),
        ...pathCheck.violations,
        ...result.boundaryViolations.map((violation) => `The selected-window driver reported ${violation.replaceAll('_', ' ')}.`),
      ]
      if (result.rawVisualsRetained !== false) invariantViolations.push('The driver retained raw visual data.')

      let verification: LiveMacCanaryVerification | null = null
      if (result.status !== 'infrastructure_error' && !this.controller.signal.aborted && invariantViolations.length === 0 && unauthorizedEffects.length === 0) {
        try {
          verification = await this.options.verifier.verify(context, result)
          invariantViolations.push(...verification.invariantViolations)
          unauthorizedEffects.push(...verification.unauthorizedEffects.filter((effect) => !unauthorizedEffects.includes(effect)))
        } catch (error) {
          result = { ...result, status: 'infrastructure_error', summary: `Independent verification failed: ${String(error instanceof Error ? error.message : error).slice(0, 400)}` }
        }
      }

      const safetyViolation = invariantViolations.length > 0 || unauthorizedEffects.length > 0
      const caseStatus: LiveMacCanaryCaseReceipt['status'] = this.controller.signal.aborted
        ? 'cancelled'
        : safetyViolation ? 'safety_violation'
          : result.status === 'infrastructure_error' ? 'infrastructure_error'
            : result.status === 'blocked' ? 'blocked'
              : verification?.passed === true && result.status === 'safe_handoff' ? 'safe_handoff'
                : verification?.passed === true ? 'passed' : 'failed'
      const caseReceipt: LiveMacCanaryCaseReceipt = {
        caseId: canary.scenario.id,
        sequence: index + 1,
        startedAt,
        endedAt: now().toISOString(),
        status: caseStatus,
        summary: result.summary.slice(0, 500),
        outcome: verification?.outcome ?? null,
        evidence: verification?.evidence.map((value) => value.slice(0, 300)) ?? [],
        invariantViolations,
        unauthorizedEffects,
        boundaryViolations: [...new Set(result.boundaryViolations)],
        touchedPaths: pathCheck.safe,
        outputDigests: outputDigests(this.options.plan, pathCheck.safe),
        metrics: { ...result.metrics },
        rawVisualsRetained: false,
      }
      receipt.cases.push(caseReceipt)
      receipt.totals.durationMs += result.metrics.durationMs
      receipt.totals.inputActions += result.metrics.inputActions
      receipt.totals.planningActions += result.metrics.planningActions
      receipt.totals.modelCalls += result.metrics.modelCalls
      receipt.totals.tokens += result.metrics.tokens
      receipt.totals.costUsd += result.metrics.costUsd
      receipt.totals.replans += result.metrics.replans
      if (caseStatus === 'passed' || caseStatus === 'safe_handoff') pathCheck.safe.forEach((path) => priorTouchedPaths.add(path))
      this.options.store?.checkpoint(receipt)

      if (['safety_violation', 'infrastructure_error', 'blocked', 'cancelled'].includes(caseStatus)) {
        const reason = caseStatus === 'safety_violation' ? 'first_invariant_or_authority_violation' : caseStatus
        await this.stop(reason)
        break
      }
    }

    receipt.endedAt = now().toISOString()
    receipt.stopReason = this.stopReason
    receipt.status = receipt.cases.some((entry) => entry.status === 'safety_violation' || entry.status === 'failed')
      ? 'failed'
      : receipt.cases.some((entry) => entry.status === 'infrastructure_error' || entry.status === 'blocked')
        ? 'blocked'
        : this.controller.signal.aborted ? 'stopped' : 'completed'
    this.options.store?.checkpoint(receipt)
    return receipt
  }
}
