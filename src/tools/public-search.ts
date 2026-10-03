import { estimateOpenAICost } from '../../gateway/src/provider-cost.js'
import type { AuditLog } from '../audit.js'
import type { CarveDatabase } from '../db.js'
import type { ProviderRegistry } from '../providers/registry.js'
import { publicLookupLimits, PublicSearchError, validatePublicSearchRequest, type PublicLookupEvidence } from '../public-web.js'
import type { ActionSpec, VerificationSpec } from '../types.js'
import { id, nowIso, stableJson } from '../util.js'
import { executionPlanHash } from '../work-contract.js'
import { budgetForContract, effectiveWorkBudget } from '../work-budget.js'
import type { ToolAdapter, ToolContext, ToolDefinition, ToolExecutionResult } from './contracts.js'
import { modelResponseMetadata } from '../model-telemetry.js'
import { defaultCompletionModel } from '../live-computer-model-routing.js'
import type { FetchedSource } from '../source-fetch.js'
import { checkSourceSupport, citedSources, sourceSupportEnabled } from '../source-support.js'
import type { ModelProvider } from '../providers/types.js'

/** Reads a cited public page as text; null turns the source-support check off (unit tests without network). */
export type SourceFetcher = ((url: string, signal: AbortSignal) => Promise<FetchedSource>) | null

export class PublicSearchTool implements ToolAdapter {
  readonly definition: ToolDefinition = {
    name: 'web.search', family: 'browser', location: 'remote', available: true,
    description: 'Answer an authorized public-web query using the selected search provider, with citations and no screen or history input.',
    defaultRisk: 'read_only',
  }
  // One receipt awaiting immediate inspection, removed on inspection. Not a cache.
  private readonly receipts = new Set<string>()

  constructor(private readonly providers: ProviderRegistry, private readonly database: CarveDatabase, private readonly audit: AuditLog, private readonly fetchSource: SourceFetcher = null) {}

  async execute(action: ActionSpec, context: ToolContext): Promise<ToolExecutionResult> {
    const { query, asOf, providerId, model, limits } = action.input
    if (typeof query !== 'string' || typeof asOf !== 'string' || typeof providerId !== 'string' || typeof model !== 'string'
      || stableJson(limits) !== stableJson(publicLookupLimits) || action.stateChanging || action.risk !== 'read_only') throw new Error('Invalid public lookup scope')
    validatePublicSearchRequest({ query, asOf, model })
    const run = this.database.getRun(context.runId)
    if (!run || action.tool !== 'web.search' || action.id !== context.actionId || !run.plan.planHash || executionPlanHash(run.plan) !== run.plan.planHash) throw new Error('Public lookup requires an intact approved contract')
    const standalone = run.plan.actions.length === 1 && stableJson(run.plan.actions[0]) === stableJson(action)
    const scope = run.plan.contract?.publicReadScope
    const checkpoint = run.liveComputerCheckpoint
    const attempts = checkpoint?.ledger?.publicLookups ?? []
    const attempt = attempts.find(candidate => candidate.id === action.id)
    const scopedLive = run.status === 'running' && checkpoint?.status === 'acting'
      && !checkpoint.pendingInput && !checkpoint.pendingOperation
      && run.plan.contract?.allowedTools.includes('computer.live') && run.plan.contract.allowedTools.includes('web.search')
      && scope?.version === 1 && scope.providerId === providerId && scope.model === model
      && scope.queries.includes(query) && attempts.length <= scope.maxLookups
      && attempt?.status === 'started' && attempt.query === query
      && attempts.filter(candidate => candidate.query === query).length === 1
    if (!standalone && !scopedLive) throw new Error('Public lookup requires an exact single-action contract or an active scoped live attempt')
    if (this.database.hasAuditEvent('web.query_transmitted', action.id)) throw new Error('This public lookup was already attempted; it cannot be replayed')
    const provider = this.providers.get(providerId)
    if (!provider.supportsPublicSearch || !provider.searchPublicWeb || !provider.summary.configured) throw new Error('Selected provider does not support public search; no alternate provider was used')
    if (provider.summary.model !== model) throw new Error('Selected model changed; prepare a fresh public lookup')
    const budget = effectiveWorkBudget(budgetForContract(run.plan.contract ?? { limits: { maxActions: 1, maxDurationMinutes: 1 } }), run.budgetAmendments)
    const remainingMs = budget.maxDurationMinutes * 60_000 - (run.budgetUsage?.activeDurationMs ?? 0)
    if (remainingMs <= 0) throw new Error('Public lookup active-time budget is exhausted')
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(Math.max(1, Math.ceil(remainingMs)))])
    const priorCalls = this.database.listModelCalls(run.createdAt).filter((call) => call.runId === run.id)
    const consumed = priorCalls.reduce((sum, call) => sum + (call.totalTokens ?? (call.inputTokens ?? 0) + (call.outputTokens ?? 0)), 0)
    if (priorCalls.some((call) => call.inputTokens === null || call.outputTokens === null)
      || priorCalls.length >= (budget.maxModelCalls ?? 1) || (budget.maxModelCallsPerAction ?? 1) < 1
      || consumed + publicLookupLimits.outputTokens >= (budget.maxTotalTokens ?? 0)) throw new Error('Public lookup model budget is exhausted or previous usage is unknown')
    signal.throwIfAborted()
    const started = Date.now()
    let receipt: PublicLookupEvidence | undefined
    let failure: unknown
    this.audit.append('web.query_transmitted', 'tool', action.id, {
      runId: run.id, providerId, model, query, asOf, limits,
      dataScope: 'explicit_query_only', screenshots: 0, historyIncluded: false,
    })
    try {
      receipt = await provider.searchPublicWeb({ query, asOf, model, signal })
      signal.throwIfAborted()
      const tokens = receipt.usage.totalTokens ?? (receipt.usage.inputTokens ?? 0) + (receipt.usage.outputTokens ?? 0)
      if (consumed + tokens > (budget.maxTotalTokens ?? 0)) throw new PublicSearchError('Public search exceeded the run token budget; no further request was made', receipt.usage, receipt.toolCalls, receipt.searchCalls)
      if (this.fetchSource && sourceSupportEnabled()) receipt = await this.checkSources(receipt, query, provider, run.id, action.id, signal, consumed + tokens, budget.maxTotalTokens ?? 0)
      if (this.receipts.size >= 128) this.receipts.delete(this.receipts.values().next().value!)
      this.receipts.add(`${context.runId}:${action.id}`)
      const summary = receipt.verification === 'source_supported' ? 'Returned an answer whose claims were each found in the cited page'
        : receipt.verification === 'source_revised' ? 'The cited page did not support the provider’s answer; returned what the page supports and what it does not show'
          : receipt.verification === 'source_unconfirmed' ? 'Returned an answer that could not be checked against its cited page, marked unconfirmed'
            : 'Returned an answer with provider citations; no independent factual check was performed'
      return { ok: true, summary, output: { method: 'public_web', citationCount: receipt.citations.length, verification: receipt.verification }, publicLookup: receipt }
    } catch (error) { failure = error; throw error }
    finally {
      const error = failure instanceof PublicSearchError ? failure : null
      const usage = receipt?.usage ?? error?.usage ?? { inputTokens: null, outputTokens: null }
      this.database.recordModelCall({
        id: id('call'), occurredAt: nowIso(), providerId, providerKind: provider.summary.kind,
        model: receipt?.model ?? model, job: 'web.search', ...usage,
        status: failure ? 'failed' : 'completed', runId: run.id, durationMs: Date.now() - started, visionFrames: 0,
        telemetry: { requestStartedAt: new Date(started).toISOString(), headersMs: 0, responseMs: Date.now() - started,
          systemHash: 'public-search-v1', schemaHash: null, promptCharacters: query.length, imageCount: 0,
          responseId: receipt?.responseId ?? error?.responseId ?? null, searchCalls: receipt?.searchCalls ?? error?.searchCalls ?? null,
          ...((receipt?.serviceTier ?? error?.serviceTier) ? { serviceTier: (receipt?.serviceTier ?? error?.serviceTier)! } : {}) },
      })
      const cost = estimateOpenAICost(receipt?.model ?? model, { ...usage, serviceTier: receipt?.serviceTier ?? error?.serviceTier ?? null, searchCalls: receipt?.searchCalls ?? error?.searchCalls ?? null })
      this.audit.append('web.search_usage', 'tool', action.id, {
        runId: run.id, providerRequests: 1, toolCalls: receipt?.toolCalls ?? error?.toolCalls ?? null,
        searchCalls: receipt?.searchCalls ?? error?.searchCalls ?? null, usage,
        toolCostUsd: cost.toolsUsd, providerCostUsd: cost.usd, costStatus: cost.status, costReason: cost.reason, pricingVersion: cost.version, durationMs: Date.now() - started,
      })
    }
  }

  /** Fetch the cited pages and check the answer's claims against them. The
   * check's own failure never discards the paid answer: it is marked unconfirmed. */
  private async checkSources(receipt: PublicLookupEvidence, question: string, provider: ModelProvider, runId: string, actionId: string, signal: AbortSignal, consumed: number, maxTokens: number): Promise<PublicLookupEvidence> {
    const started = Date.now()
    const cited = citedSources(receipt)
    const pages = await Promise.all(cited.map(async source => {
      try { return { ...source, page: await this.fetchSource!(source.url, signal) } }
      catch (error) { return { ...source, page: null, failure: error instanceof Error ? error.message : 'The source could not be opened' } }
    }))
    signal.throwIfAborted()
    const fetchedMs = Date.now() - started
    const openAI = ['openai-hosted', 'carve-cloud', 'azure-openai'].includes(provider.summary.id)
    const model = openAI ? process.env.STEWARD_SOURCE_SUPPORT_MODEL?.trim() || defaultCompletionModel : undefined
    const outcome = await checkSourceSupport({
      question, evidence: receipt, sources: pages, signal,
      ...(model ? { model } : {}), reasoningEffort: 'low',
      complete: async request => {
        if (consumed + 12_000 > maxTokens) throw new Error('Public lookup token budget leaves no room for the source check')
        const callStarted = Date.now()
        try {
          const response = await provider.complete(request)
          this.database.recordModelCall({ ...modelResponseMetadata(response), id: id('call'), occurredAt: nowIso(), providerId: provider.summary.id, providerKind: provider.summary.kind,
            model: response.model, job: 'web.source_support', inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens,
            status: 'completed', runId, durationMs: Date.now() - callStarted, visionFrames: 0 })
          return response
        } catch (error) {
          this.database.recordModelCall({ id: id('call'), occurredAt: nowIso(), providerId: provider.summary.id, providerKind: provider.summary.kind,
            model: String(request.model ?? provider.summary.model), job: 'web.source_support', inputTokens: null, outputTokens: null,
            status: 'failed', runId, durationMs: Date.now() - callStarted, visionFrames: 0 })
          throw error
        }
      },
    })
    signal.throwIfAborted()
    const support = outcome.receipt
    this.audit.append('web.source_support_checked', 'tool', actionId, {
      runId, status: support.status, sources: support.sources.length, sourcesFetched: support.sources.filter(source => source.fetched).length,
      claims: support.claims.length, claimsSupported: support.claims.filter(claim => claim.status === 'supported').length,
      claimsContradicted: support.claims.filter(claim => claim.status === 'contradicted').length,
      downgraded: support.claims.filter(claim => claim.downgraded).map(claim => claim.downgraded),
      fetchMs: fetchedMs, durationMs: Date.now() - started, model: support.model, failure: outcome.failure ?? null, textRetained: false,
    })
    return outcome.evidence
  }

  async inspect(verification: VerificationSpec, context: ToolContext): Promise<unknown> {
    const found = this.receipts.delete(`${context.runId}:${context.actionId}`)
    return !context.signal.aborted && verification.method === 'state_equals' && verification.target === 'provider_citations_checked' && found
  }
}
