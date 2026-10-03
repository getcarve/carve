import { existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import type { CarveApp } from '../app.js'
import type { LiveComputerRouteStartEntry } from '../desktop-contract.js'
import type { AuditEvent, LiveComputerSession, ModelCall } from '../types.js'
import { supervisionPreset } from '../supervision-policy.js'
import { summarizeComputerAgentTelemetry } from './computer-telemetry.js'
import { liveMacRegressionGateCaseIds } from './live-mac-canary.js'
import { probeLiveMacApplications, type LiveMacApplicationProbe } from './live-mac-preflight.js'
import type {
  LiveMacCanaryDriver,
  LiveMacCanaryDriverReadiness,
  LiveMacCanaryDriverResult,
  LiveMacCanaryExecutionContext,
} from './live-mac-runner.js'

export interface CarveStructuredCanaryDriverOptions {
  app: CarveApp
  globalStopReady: () => boolean
  /** Test seam only; production uses the read-only installed-app probe. */
  probeApplications?: (applications: string[]) => LiveMacApplicationProbe[]
  pollMs?: number
}

const supportedCases = new Set<string>(liveMacRegressionGateCaseIds)
const terminalStatuses = new Set<LiveComputerSession['status']>(['completed', 'stopped', 'blocked', 'handoff'])
const inputKinds = new Set(['click', 'drag', 'element_action', 'scroll', 'type', 'type_into', 'enter_sequence', 'apply_artifact', 'keypress', 'new_tab', 'cycle_tab'])

function supportedRegressionCase(context: LiveMacCanaryExecutionContext): void {
  if (!supportedCases.has(context.canary.scenario.id)) {
    throw new Error(`The live-Mac regression driver supports only ${liveMacRegressionGateCaseIds.join(', ')}`)
  }
}

function fresh(application: string, bundleIdentifier: string, role: 'workspace' | 'research' | 'destination', purpose: string, url?: string): LiveComputerRouteStartEntry {
  return {
    source: 'fresh', application, bundleIdentifier, authority: 'input', role, purpose,
    ...(url ? { url } : {}),
  }
}

function routeFor(context: LiveMacCanaryExecutionContext): LiveComputerRouteStartEntry[] {
  const wikipedia = 'https://en.wikipedia.org/wiki/Global_warming'
  switch (context.canary.scenario.id) {
    case 'C01': return [fresh('TextEdit', 'com.apple.TextEdit', 'destination', 'Create the exact three-line evaluation document')]
    case 'C02': return [fresh('Calculator', 'com.apple.calculator', 'workspace', 'Compute the exact approved expression')]
    case 'C06':
    case 'C15': return [
      fresh('Google Chrome', 'com.google.Chrome', 'research', 'Read the approved Wikipedia article', wikipedia),
      fresh('TextEdit', 'com.apple.TextEdit', 'destination', 'Write the approved two-line evaluation note'),
    ]
    case 'C13': return [fresh('Google Chrome', 'com.google.Chrome', 'research', 'Read the same-site Wikipedia redirect target', wikipedia)]
    default: throw new Error('The requested case has no reviewed fresh-window route')
  }
}

function pricedCost(app: CarveApp, calls: ModelCall[]): number | null {
  let total = 0
  for (const call of calls) {
    const rate = app.modelRate(call.providerId, call.model)
    if (!rate) return null
    total += ((call.inputTokens ?? 0) / 1_000_000) * rate.inputPerMillion
      + ((call.outputTokens ?? 0) / 1_000_000) * rate.outputPerMillion
  }
  return total
}

function scopedEvents(app: CarveApp, runId: string, sessionId: string): AuditEvent[] {
  const seen = new Set<string>()
  return [...app.database.listAuditForRun(runId), ...app.database.listAuditForRun(sessionId)]
    .filter((event) => seen.has(event.id) ? false : (seen.add(event.id), true))
}

/** Production adapter for the five-case regression gate. It only composes
 * Carve's existing Work, fresh-window route, governed action, verification,
 * and stop APIs; it never accepts or executes raw coordinates itself. */
export class CarveStructuredCanaryDriver implements LiveMacCanaryDriver {
  readonly kind = 'carve_selected_window' as const
  private activeRunId: string | null = null
  private readonly consumedApprovalActionIds = new Set<string>()

  constructor(private readonly options: CarveStructuredCanaryDriverOptions) {}

  async preflight(context: LiveMacCanaryExecutionContext): Promise<LiveMacCanaryDriverReadiness> {
    supportedRegressionCase(context)
    const provider = this.options.app.providers.get(context.model.providerId)
    const status = await this.options.app.refreshLiveComputerStatus()
    const rate = this.options.app.modelRate(provider.summary.id, provider.summary.model)
    const targets = await this.options.app.listLiveComputerTargets(true).catch(() => [])
    return {
      desktopStatus: status,
      globalStopReady: this.options.globalStopReady(),
      applications: (this.options.probeApplications ?? probeLiveMacApplications)(context.canary.applications),
      runningApplications: [...new Set(targets.map((target) => target.application))],
      model: {
        providerId: provider.summary.id,
        providerKind: provider.summary.kind === 'hosted' ? 'hosted' : 'unsupported',
        model: provider.summary.model,
        pricing: rate,
        configured: provider.summary.configured,
        goalPlanning: Boolean(provider.supportsGoalPlanning),
        vision: provider.summary.capabilities.vision,
        structuredOutput: provider.summary.capabilities.structuredOutput,
        pricingAvailable: rate !== null,
        actionEngine: this.options.app.liveComputerActionEngine() === 'structured_v1' ? 'structured_v1' : 'other',
      },
    }
  }

  async execute(context: LiveMacCanaryExecutionContext): Promise<LiveMacCanaryDriverResult> {
    supportedRegressionCase(context)
    if (context.signal.aborted) throw new Error('The live-Mac regression case was stopped before preparation')
    if (this.options.app.liveComputerActionEngine() !== context.model.actionEngine) throw new Error('The approved structured action engine changed after preflight')
    const provider = this.options.app.providers.get(context.model.providerId)
    const rate = this.options.app.modelRate(provider.summary.id, provider.summary.model)
    if (provider.summary.kind !== 'hosted'
      || !provider.summary.configured
      || !provider.supportsGoalPlanning
      || !provider.summary.capabilities.vision
      || !provider.summary.capabilities.structuredOutput
      || provider.summary.model !== context.model.model
      || !rate
      || rate.inputPerMillion !== context.model.pricing.inputPerMillion
      || rate.outputPerMillion !== context.model.pricing.outputPerMillion) {
      throw new Error('The approved hosted provider, model, capabilities, or pricing changed after preflight')
    }

    const startedAt = Date.now()
    const prepared = await this.options.app.prepareWork(
      context.canary.task,
      'constrained_autonomous',
      context.model.providerId,
      {},
      undefined,
      { mode: 'none', sessionIds: [] },
      undefined,
      'quick',
      false,
      'execute',
      supervisionPreset(context.model.supervisionPreset),
    )
    if (!prepared.run) throw new Error(prepared.blocker ?? 'Carve could not prepare the exact live-Mac regression Work contract')
    if (!prepared.run.plan.contract?.allowedTools.includes('computer.live')) throw new Error('The regression request did not produce a selected-window Work contract')
    this.activeRunId = prepared.run.id

    const abort = () => { this.options.app.stopLiveComputerSession() }
    context.signal.addEventListener('abort', abort, { once: true })
    let session: LiveComputerSession
    try {
      const started = await this.options.app.startLiveComputerRoute({
        runId: prepared.run.id,
        providerId: context.model.providerId,
        route: routeFor(context),
        remoteVisualsAllowed: context.model.remoteVisualsAllowed,
        idempotencyKey: `${context.runHash}:${context.canary.scenario.id}`,
        evaluationFaultInjection: context.canary.faultInjection,
      })
      if (!('ledger' in started) || (started.actionEngine ?? 'structured_v1') !== 'structured_v1') {
        throw new Error('The approved case did not start in Carve structured mode')
      }
      session = await this.waitForTerminal(started.id, context)
    } finally {
      context.signal.removeEventListener('abort', abort)
    }

    const calls = this.options.app.database.listModelCalls().filter((call) => call.runId === prepared.run!.id)
    const costUsd = pricedCost(this.options.app, calls)
    if (costUsd === null) throw new Error('The live-Mac regression provider usage could not be priced exactly')
    const events = scopedEvents(this.options.app, prepared.run.id, session.id)
    const telemetry = summarizeComputerAgentTelemetry(events, calls)
    const actionEvents = events.filter((event) => event.category === 'computer.action_execution_started')
    const inputActions = actionEvents.filter((event) => inputKinds.has(String(event.details.action))).length
    const inputWindowIds = [...new Set(actionEvents.flatMap((event) => typeof event.details.targetWindowId === 'number' ? [event.details.targetWindowId] : []))]
    const freshWindowIds = session.targets.filter((entry) => entry.source === 'fresh').map((entry) => entry.target.windowId)
    const frame = this.options.app.readLiveComputerFrame()
    const elements = 'elements' in frame ? frame.elements : []
    const wrotePaths = context.canary.writablePaths.filter((relativePath, index) => existsSync(context.writablePaths[index]!))
    const injectedStrategyDelayMs = events
      .filter((event) => event.category === 'computer.strategy_candidate_delay_injected')
      .reduce<number | null>((maximum, event) => {
        const value = typeof event.details.delayMs === 'number' ? event.details.delayMs : null
        return value === null ? maximum : Math.max(maximum ?? 0, value)
      }, null)
    const result: LiveMacCanaryDriverResult = {
      status: session.status === 'completed'
        ? 'completed'
        : session.terminalCategory === 'environment_error' || session.terminalCategory === 'provider_error'
          ? 'infrastructure_error'
          : session.status === 'handoff' || ['awaiting_plan_approval', 'awaiting_approval', 'awaiting_context_transfer', 'awaiting_guidance'].includes(session.status)
            ? 'safe_handoff' : 'blocked',
      summary: session.status === 'completed'
        ? `Structured ${context.canary.scenario.id} reached its verified terminal state.`
        : `Structured ${context.canary.scenario.id} stopped before verified completion.`,
      observedEffects: [
        ...(inputActions > 0 ? ['local_input' as const] : []),
        ...(wrotePaths.length > 0 ? ['reversible_write' as const] : []),
      ],
      touchedPaths: wrotePaths,
      boundaryViolations: [],
      rawVisualsRetained: false,
      metrics: {
        durationMs: Math.max(0, Date.now() - startedAt),
        inputActions,
        planningActions: session.actionCount,
        actionsPerClause: session.actionCount / Math.max(1, session.ledger.clauses.length),
        modelCalls: calls.length,
        tokens: calls.reduce((sum, call) => sum + (call.inputTokens ?? 0) + (call.outputTokens ?? 0), 0),
        costUsd,
        replans: telemetry.replans ?? 0,
        timeToFirstActionMs: telemetry.timeToFirstActionMs ?? null,
      },
      verificationObservation: {
        elements: elements.map((element) => ({ role: element.role, name: element.name, value: element.value })),
        authorizedWindowIds: session.targets.map((entry) => entry.target.windowId),
        freshWindowIds,
        inputWindowIds,
        executiveReviews: events.filter((event) => event.category === 'computer.executive_review_requested').length,
        injectedStrategyDelayMs,
      },
    }
    if (session.status === 'completed') {
      await this.options.app.closeFreshLiveComputerWindows(prepared.run.id).catch(() => 0)
      this.activeRunId = null
    }
    return result
  }

  async stop(_reason: string): Promise<void> {
    this.options.app.stopLiveComputerSession()
    if (this.activeRunId) await this.options.app.closeFreshLiveComputerWindows(this.activeRunId).catch(() => 0)
    this.activeRunId = null
  }

  private async waitForTerminal(sessionId: string, context: LiveMacCanaryExecutionContext): Promise<LiveComputerSession> {
    const deadline = Date.now() + context.limits.maxDurationMsPerTrial
    const pollMs = Math.max(20, Math.min(1_000, this.options.pollMs ?? 100))
    while (Date.now() < deadline) {
      if (context.signal.aborted) throw new Error('The live-Mac regression case was stopped')
      const session = this.options.app.liveComputer.session()
      if (!session || session.id !== sessionId) throw new Error('The authorized structured session was replaced or disappeared')
      if (terminalStatuses.has(session.status)) return session
      if (session.status === 'awaiting_approval' && session.pendingAction && session.pendingApproval?.kind === 'immediate') {
        const action = session.pendingAction
        const authorizedNoInput = ['done', 'conclude', 'wait'].includes(action.kind)
        const authorizedWorkspaceWrite = action.risk === 'reversible_write'
          && context.canary.permittedEffects.includes('reversible_write')
          && session.targets.some((entry) => entry.source === 'fresh'
            && entry.authority === 'input'
            && entry.target.windowId === (action.targetWindowId ?? session.target.windowId))
        if ((authorizedNoInput || authorizedWorkspaceWrite) && !this.consumedApprovalActionIds.has(action.id)) {
          this.consumedApprovalActionIds.add(action.id)
          await this.options.app.executeLiveComputerAction('user')
          continue
        }
        return session
      }
      if (['awaiting_plan_approval', 'awaiting_context_transfer', 'awaiting_guidance'].includes(session.status)) return session
      await delay(pollMs, undefined, { signal: context.signal })
    }
    throw new Error('The live-Mac regression case reached its exact duration limit')
  }
}
