import { resolve } from 'node:path'
import type { CarveApp } from '../app.js'
import { liveMacRegressionGateCaseIds, LiveMacCanaryPlanStore } from './live-mac-canary.js'
import { inspectLiveMacCanaryPreflight, probeLiveMacApplications, type LiveMacApplicationProbe, type LiveMacCanaryPreflightReport } from './live-mac-preflight.js'
import {
  authorizeLiveMacCanaryRun,
  buildLiveMacCanaryRunProposal,
  liveMacCanaryRunHash,
  LiveMacCanaryRunStore,
  LiveMacCanarySerialRunner,
  type LiveMacCanaryDriver,
  type LiveMacCanaryRunProposal,
  type LiveMacCanaryRunReceipt,
  type LiveMacCanaryVerifier,
} from './live-mac-runner.js'
import { CarveStructuredCanaryDriver } from './live-mac-structured-driver.js'
import { DeterministicLiveMacCanaryVerifier } from './live-mac-verifier.js'

export interface LiveMacCanaryDesktopReadiness {
  planHash: string
  caseIds: string[]
  preflight: LiveMacCanaryPreflightReport
  model: {
    providerId: string
    providerKind: 'hosted' | 'unsupported'
    model: string
    pricing: { inputPerMillion: number; outputPerMillion: number } | null
    configured: boolean
    goalPlanning: boolean
    vision: boolean
    structuredOutput: boolean
    actionEngine: 'structured_v1' | 'other'
  }
  blockers: string[]
  canPropose: boolean
  applicationsOpened: false
  executionEnabled: false
}

export interface LiveMacCanaryDesktopProposal {
  proposal: LiveMacCanaryRunProposal
  runHash: string
  confirmation: string
  applicationsOpened: false
  executionEnabled: false
}

export interface LiveMacCanaryDesktopCoordinatorOptions {
  app: CarveApp
  artifactRoot: string
  globalStopReady: () => boolean
  executionAuthorizationReady?: () => boolean
  now?: () => Date
  createDriver?: () => LiveMacCanaryDriver
  createVerifier?: () => LiveMacCanaryVerifier
  /** Test seam only; production probes known macOS bundle paths read-only. */
  probeApplications?: (applications: string[]) => LiveMacApplicationProbe[]
}

function exactRegressionSelection(caseIds: string[]): void {
  const indexes = caseIds.map((caseId) => liveMacRegressionGateCaseIds.indexOf(caseId as typeof liveMacRegressionGateCaseIds[number]))
  if (caseIds.length === 0
    || new Set(caseIds).size !== caseIds.length
    || indexes.some((index) => index < 0)
    || indexes.some((index, position) => position > 0 && index <= indexes[position - 1]!)) {
    throw new Error(`The desktop live-Mac execution boundary supports only ordered selections from ${liveMacRegressionGateCaseIds.join(', ')}`)
  }
}

/**
 * Desktop-owned authority boundary for the five-case regression gate. Readiness and
 * proposal calls are non-launching. The only path to execute is an unexpired,
 * hash-bound confirmation that starts immediately and can be stopped through
 * the same runner used by the global desktop emergency stop.
 */
export class LiveMacCanaryDesktopCoordinator {
  private readonly app: CarveApp
  private readonly globalStopReady: () => boolean
  private readonly executionAuthorizationReady: () => boolean
  private readonly now: () => Date
  private readonly planStore: LiveMacCanaryPlanStore
  private readonly runStore: LiveMacCanaryRunStore
  private readonly createDriver: () => LiveMacCanaryDriver
  private readonly createVerifier: () => LiveMacCanaryVerifier
  private readonly probeApplications: (applications: string[]) => LiveMacApplicationProbe[]
  private active: { runHash: string; runner: LiveMacCanarySerialRunner } | null = null

  constructor(options: LiveMacCanaryDesktopCoordinatorOptions) {
    this.app = options.app
    this.globalStopReady = options.globalStopReady
    this.executionAuthorizationReady = options.executionAuthorizationReady ?? (() => true)
    this.now = options.now ?? (() => new Date())
    const artifactRoot = resolve(options.artifactRoot)
    this.planStore = new LiveMacCanaryPlanStore(artifactRoot)
    this.runStore = new LiveMacCanaryRunStore(resolve(artifactRoot, 'execution'))
    this.createDriver = options.createDriver ?? (() => new CarveStructuredCanaryDriver({
      app: this.app,
      globalStopReady: this.globalStopReady,
    }))
    this.createVerifier = options.createVerifier ?? (() => new DeterministicLiveMacCanaryVerifier())
    this.probeApplications = options.probeApplications ?? probeLiveMacApplications
  }

  activeRun(): { runHash: string } | null {
    return this.active ? { runHash: this.active.runHash } : null
  }

  async preflight(planHash: string, caseIds: string[], providerId: string): Promise<LiveMacCanaryDesktopReadiness> {
    exactRegressionSelection(caseIds)
    const plan = this.planStore.readPlan(planHash)
    const canaries = caseIds.map((caseId) => plan.cases.find((entry) => entry.scenario.id === caseId))
    if (canaries.some((entry) => !entry)) throw new Error('The exact live-Mac plan does not contain every requested regression case')
    const provider = this.app.providers.get(providerId)
    const status = await this.app.refreshLiveComputerStatus()
    const pricing = this.app.modelRate(provider.summary.id, provider.summary.model)
    const globalStopReady = this.globalStopReady()
    const visibleTargets = await this.app.listLiveComputerTargets(true).catch(() => [])
    const runningApplications = new Set(visibleTargets.map((target) => target.application))
    const preflight = inspectLiveMacCanaryPreflight(plan, {
      caseIds,
      platform: status.platform === 'darwin' ? 'darwin' : process.platform,
      applicationProbes: this.probeApplications([...new Set(canaries.flatMap((entry) => entry!.applications))]),
      desktopStatus: status,
      globalStopReady,
      checkedAt: this.now().toISOString(),
    })
    const providerKind = provider.summary.kind === 'hosted' ? 'hosted' : 'unsupported'
    const actionEngine = this.app.liveComputerActionEngine() === 'structured_v1' ? 'structured_v1' : 'other'
    const blockers = preflight.findings.filter((finding) => finding.kind === 'block').map((finding) => finding.message)
    if (providerKind !== 'hosted') blockers.push('The live-Mac regression gate requires a hosted visual provider.')
    if (!provider.summary.configured) blockers.push('The selected hosted provider is not configured.')
    if (!provider.supportsGoalPlanning) blockers.push('The selected provider does not support structured goal planning.')
    if (!provider.summary.capabilities.vision || !provider.summary.capabilities.structuredOutput) blockers.push('The selected provider needs vision and structured-output capabilities.')
    if (!pricing) blockers.push('The selected model has no exact stored input/output price.')
    if (actionEngine !== 'structured_v1') blockers.push('Assured · Carve structured controller is not selected for new live-computer sessions.')
    for (const canary of canaries) {
      for (const application of canary!.requiredRunningApplications) {
        if (!runningApplications.has(application)) blockers.push(`${canary!.scenario.id} requires ${application} to already be running before the fresh document opens.`)
      }
    }
    if (!this.executionAuthorizationReady()) blockers.push('OS user-presence verification is unavailable for live-Mac execution.')
    return {
      planHash,
      caseIds: [...caseIds],
      preflight,
      model: {
        providerId: provider.summary.id,
        providerKind,
        model: provider.summary.model,
        pricing,
        configured: provider.summary.configured,
        goalPlanning: Boolean(provider.supportsGoalPlanning),
        vision: provider.summary.capabilities.vision,
        structuredOutput: provider.summary.capabilities.structuredOutput,
        actionEngine,
      },
      blockers,
      canPropose: blockers.length === 0,
      applicationsOpened: false,
      executionEnabled: false,
    }
  }

  async propose(planHash: string, caseIds: string[], providerId: string): Promise<LiveMacCanaryDesktopProposal> {
    if (this.active) throw new Error('A live-Mac canary is already active')
    const readiness = await this.preflight(planHash, caseIds, providerId)
    if (!readiness.canPropose || !readiness.model.pricing) {
      throw new Error(`The live-Mac regression gate is not ready to propose: ${readiness.blockers.join(' ')}`)
    }
    const plan = this.planStore.readPlan(planHash)
    const createdAt = this.now()
    const proposal = buildLiveMacCanaryRunProposal(plan, {
      caseIds,
      providerId: readiness.model.providerId,
      model: readiness.model.model,
      pricing: readiness.model.pricing,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 30 * 60_000).toISOString(),
    })
    const runHash = this.runStore.saveProposal(proposal)
    return {
      proposal,
      runHash,
      confirmation: `AUTHORIZE LIVE MAC CANARY ${runHash}`,
      applicationsOpened: false,
      executionEnabled: false,
    }
  }

  async authorizeAndRun(runHash: string, confirmation: string): Promise<LiveMacCanaryRunReceipt> {
    if (this.active) throw new Error('A live-Mac canary is already active')
    const proposal = this.runStore.readProposal(runHash)
    exactRegressionSelection(proposal.caseIds)
    const plan = this.planStore.readPlan(proposal.planHash)
    const authorization = authorizeLiveMacCanaryRun(plan, proposal, runHash, confirmation, this.now().getTime())
    this.runStore.saveAuthorization(authorization)
    const runner = new LiveMacCanarySerialRunner({
      plan,
      proposal,
      authorization,
      driver: this.createDriver(),
      verifier: this.createVerifier(),
      store: this.runStore,
      now: this.now,
    })
    this.active = { runHash: liveMacCanaryRunHash(proposal), runner }
    try {
      return await runner.run()
    } finally {
      this.active = null
    }
  }

  /** Validate the hash, exact phrase, supported case, and expiry before the
   * desktop shell asks macOS for fresh user presence. Execution revalidates
   * the same values afterward to close the prompt-time race. */
  validateAuthorizationRequest(runHash: string, confirmation: string): void {
    if (this.active) throw new Error('A live-Mac canary is already active')
    const proposal = this.runStore.readProposal(runHash)
    exactRegressionSelection(proposal.caseIds)
    const plan = this.planStore.readPlan(proposal.planHash)
    authorizeLiveMacCanaryRun(plan, proposal, runHash, confirmation, this.now().getTime())
  }

  async stop(reason = 'desktop_global_stop'): Promise<{ stopped: boolean; runHash: string | null }> {
    const active = this.active
    if (!active) return { stopped: false, runHash: null }
    await active.runner.stop(reason)
    return { stopped: true, runHash: active.runHash }
  }
}
