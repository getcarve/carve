import type { ComputerActionRequest, ComputerActionResponse, ComputerUseTurn, EmbeddingResponse, ModelProvider, ModelRequest, ModelResponse } from '../providers/types.js'
import { ComputerUseReportRejectedError, supportsComputerActionProposals, supportsComputerUseSessions } from '../providers/types.js'
import { PublicSearchError, publicLookupLimits, validatePublicSearchRequest, type PublicSearchRequest, type PublicLookupEvidence } from '../public-web.js'
import { ProviderTransportError } from '../providers/transport-retry.js'
import { OpenAIComputerActionResponseError } from '../providers/openai-hosted.js'
import { ResponseStreamIdleError } from '../providers/response-stream.js'
import { setTimeout as delay } from 'node:timers/promises'

/** A request that lost its connection before any response (every provider
 * resend included) is metered at its own reserve for each attempt the provider
 * may have received, and at nothing for attempts that provably never left the
 * machine. Before this, qualification runs charged each `fetch failed`
 * the flat unknown-usage floor per call, far more ledger than the runs
 * that ended in 0.6–3.6 s cost — and a campaign without that floor closed on it.
 * The spend guarantee holds: the reserve is the same conservative bound the
 * call was admitted under. `STEWARD_TRANSPORT_FAILURE_METERING=off` restores
 * the unknown-usage treatment. */
export const transportFailureMeteringEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_TRANSPORT_FAILURE_METERING?.trim() !== 'off'

/** A public search that failed is reconciled instead of closing the campaign:
 * its reported usage when the failure carries it, else the configured
 * unknown-usage reserve (never less than the search's own admission reserve).
 * In one run a failed search left dispatch pending
 * and every later run in the loop crashed in 2 s on the closed ledger.
 * `STEWARD_SEARCH_FAILURE_RESERVE=off` restores the fail-closed behaviour. */
export const searchFailureReserveEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_SEARCH_FAILURE_RESERVE?.trim() !== 'off'

/** The campaign's effort is a ceiling: a request may ask for less (a screenshot-only first turn), never more. */
function cappedEffort(requested: ModelRequest['reasoningEffort'] | undefined, ceiling: NonNullable<ModelRequest['reasoningEffort']> | undefined): { reasoningEffort?: NonNullable<ModelRequest['reasoningEffort']> } {
  const rank = { none: 0, low: 1, medium: 2, high: 3 } as Record<string, number>
  if (!ceiling) return requested ? { reasoningEffort: requested } : {}
  if (requested && (rank[requested] ?? 99) < (rank[ceiling] ?? 0)) return { reasoningEffort: requested }
  return { reasoningEffort: ceiling }
}

export interface EvaluationModelPrice {
  inputPerMillion: number
  outputPerMillion: number
}

export interface EvaluationModelBudgetOptions {
  maxCalls: number
  maxTokens: number
  /** Bound one request's context independently of cumulative campaign usage. */
  maxInputTokensPerCall?: number
  maxCostUsd: number
  maxOutputTokensPerCall: number
  /** Conservative reserve for one approved synthetic screenshot. The reserve
   * is a preflight bound, not a claim about the provider's image tokenizer. */
  reservedInputTokensPerImage: number
  price: EvaluationModelPrice
  /** Exact prices for every model a routed evaluation may request. When
   * present, an unlisted request or response model fails closed instead of
   * silently inheriting another model's rate. */
  pricesByModel?: Record<string, EvaluationModelPrice>
  /** Search context is provider-controlled: an admission estimate, not a hard
   * tokenizer bound. Tool fees share the same campaign dollar allowance. */
  publicSearch?: { reservedInputTokens: number; costPerToolCallUsd: number }
  /** Omit to exercise the product's actual per-request routing policy. */
  reasoningEffort?: NonNullable<ModelRequest['reasoningEffort']>
  safetyIdentifier: string
  /** Called synchronously after provider usage is known and before the paid
   * response is returned to the campaign. Used by durable cross-run ledgers. */
  /** `failedCalls` counts requests whose usage the provider reported even though the turn itself was rejected (an incomplete response). */
  onUsage?: (delta: { inputTokens: number; outputTokens: number; costUsd: number; completedCalls: number; failedCalls?: number }) => void
  onUsageUnknown?: () => void
  /** A request that failed before any response existed has no usage to read
   * back, and closing the campaign for it costs every remaining case:
   * a single transport blip ("fetch failed" in 28 ms) destroyed twelve
   * of sixteen paired runs, each of which had provably spent nothing.
   *
   * When this is set, such a failure is charged this many dollars — a
   * deliberate over-estimate of what an unseen call could have cost — and the
   * campaign continues. The spend guarantee is unchanged: the ledger still
   * assumes the worst, it simply stops treating "I cannot see what this cost"
   * as "I must stop". Leave it unset to keep the halting behaviour. */
  unknownUsageReserveUsd?: number
  /** A stalled stream's stored usage was read back, so the call is metered as a failed call rather than unknown. */
  onStalledUsageReconciled?: (detail: { responseId: string; attempts: number; status: string | null }) => void
  /** Persist pending dispatch before the request can leave this process. */
  onDispatch?: (calls: number) => void
  /** Evaluation-only circuit breaker. Product providers retain their own
   * retry policy; a paid campaign can choose to stop after one transport or
   * account-level failure instead of multiplying rejected requests. */
  stopOnProviderError?: boolean
}

export interface EvaluationModelBudgetSnapshot {
  attemptedCalls: number
  completedCalls: number
  failedCalls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  usageUnknown: boolean
  exhaustedReason: string | null
}

/** Off: STEWARD_EVAL_CANCELLED_RESERVE=off (a cancelled request closes the evaluation gate, as before). */
export function cancelledReserveChargeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_EVAL_CANCELLED_RESERVE?.trim().toLowerCase() !== 'off'
}

export class EvaluationModelBudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvaluationModelBudgetExceededError'
  }
}

function finiteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`)
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
}

/**
 * A request-level governor for opt-in hosted-model evaluations.
 *
 * Foundry's campaign runner checks totals after each trial. This wrapper adds
 * the missing inner boundary: it checks a conservative reserve before every
 * request, forces a generation ceiling, meters the provider's returned usage,
 * and refuses all later calls if usage becomes unknowable.
 */
export class BudgetedEvaluationModelProvider implements ModelProvider {
  private attemptedCalls = 0
  private completedCalls = 0
  private failedCalls = 0
  private inputTokens = 0
  private outputTokens = 0
  private costUsdValue = 0
  private reservedTokens = 0
  private reservedCostUsd = 0
  private usageUnknown = false
  private exhaustedReason: string | null = null

  readonly startComputerUseSession?: NonNullable<ModelProvider['startComputerUseSession']>
  readonly continueComputerUseSession?: NonNullable<ModelProvider['continueComputerUseSession']>
  private readonly computerHistoryTokens = new Map<string, number>()

  /** Calls charged the worst-case reserve because their usage was unreadable. */
  private unknownReserveCalls = 0

  constructor(private readonly inner: ModelProvider, private readonly options: EvaluationModelBudgetOptions) {
    positiveInteger(options.maxCalls, 'maxCalls')
    positiveInteger(options.maxTokens, 'maxTokens')
    if (options.maxInputTokensPerCall !== undefined) positiveInteger(options.maxInputTokensPerCall, 'maxInputTokensPerCall')
    finiteNonNegative(options.maxCostUsd, 'maxCostUsd')
    positiveInteger(options.maxOutputTokensPerCall, 'maxOutputTokensPerCall')
    positiveInteger(options.reservedInputTokensPerImage, 'reservedInputTokensPerImage')
    finiteNonNegative(options.price.inputPerMillion, 'inputPerMillion')
    finiteNonNegative(options.price.outputPerMillion, 'outputPerMillion')
    if (options.publicSearch) {
      positiveInteger(options.publicSearch.reservedInputTokens, 'publicSearch.reservedInputTokens')
      finiteNonNegative(options.publicSearch.costPerToolCallUsd, 'publicSearch.costPerToolCallUsd')
    }
    for (const [model, price] of Object.entries(options.pricesByModel ?? {})) {
      if (!model.trim()) throw new Error('pricesByModel cannot contain an empty model id')
      finiteNonNegative(price.inputPerMillion, `${model}.inputPerMillion`)
      finiteNonNegative(price.outputPerMillion, `${model}.outputPerMillion`)
    }
    if (!options.safetyIdentifier.trim()) throw new Error('A non-empty privacy-preserving safety identifier is required')
    if (supportsComputerUseSessions(inner)) {
      this.startComputerUseSession = request => this.computerTurn(
        request.model ?? inner.summary.model,
        Buffer.byteLength(request.system + request.prompt, 'utf8') + 4096 + (request.screenshot ? options.reservedInputTokensPerImage : 0),
        request.maxOutputTokens, request.signal,
        maxOutputTokens => inner.startComputerUseSession({ ...request, maxOutputTokens, safetyIdentifier: options.safetyIdentifier,
          ...(cappedEffort(request.reasoningEffort, options.reasoningEffort)) }),
      )
      this.continueComputerUseSession = request => {
        const historyTokens = this.computerHistoryTokens.get(request.session.responseId)
        if (historyTokens === undefined) throw new EvaluationModelBudgetExceededError('Computer continuation must belong to this governor and cannot be replayed')
        // Prior input/output usage covers provider-owned history. Add complete
        // new instructions, one image reserve and protocol slack. Never accept
        // an opaque session whose earlier context was not metered here.
        return this.computerTurn(request.session.model,
          historyTokens + Buffer.byteLength(request.instructions, 'utf8') + options.reservedInputTokensPerImage + 4096,
          request.maxOutputTokens, request.signal,
          maxOutputTokens => {
            this.computerHistoryTokens.delete(request.session.responseId)
            return inner.continueComputerUseSession({ ...request, maxOutputTokens, safetyIdentifier: options.safetyIdentifier,
              ...(cappedEffort(request.reasoningEffort, options.reasoningEffort)) })
          },
        )
      }
    }
  }

  private async computerTurn(model: string, singleInputReserve: number, requestedOutput: number | undefined, signal: AbortSignal | undefined, dispatch: (maxOutputTokens: number) => Promise<ComputerUseTurn>): Promise<ComputerUseTurn> {
    signal?.throwIfAborted()
    const maxOutputTokens = Math.min(requestedOutput ?? this.options.maxOutputTokensPerCall, this.options.maxOutputTokensPerCall)
    positiveInteger(maxOutputTokens, 'computer.maxOutputTokens')
    // An adapter that may follow up within one turn replays its transcript
    // again; the reservation and the usage bound cover that many requests.
    const requestsPerTurn = Math.max(1, Math.min(4, Math.round(this.inner.maxRequestsPerComputerTurn ?? 1)))
    const inputReserve = singleInputReserve * requestsPerTurn
    const outputBound = maxOutputTokens * requestsPerTurn
    const release = this.reserve(inputReserve, outputBound, 1, this.priceForModel(model))
    this.attemptedCalls += 1
    const stopObservingCancellation = this.observeCancellation(signal)
    let reconciled = false
    try {
      this.options.onDispatch?.(1)
      const response = await dispatch(maxOutputTokens)
      const { inputTokens, outputTokens } = response.usage
      if (inputTokens === null || outputTokens === null) throw new Error('Computer-use provider omitted token usage')
      finiteNonNegative(inputTokens, 'computer input usage'); finiteNonNegative(outputTokens, 'computer output usage')
      const costUsd = this.cost(inputTokens, outputTokens, this.priceForModel(response.model))
      this.completedCalls += 1; this.inputTokens += inputTokens; this.outputTokens += outputTokens; this.costUsdValue += costUsd
      this.options.onUsage?.({ inputTokens, outputTokens, costUsd, completedCalls: 1 })
      reconciled = true
      if (inputTokens > inputReserve || outputTokens > outputBound) {
        this.exhaustedReason = 'Computer-use usage exceeded its reserved token bound; further campaign requests are blocked.'
        throw new EvaluationModelBudgetExceededError(this.exhaustedReason)
      }
      if (response.kind === 'actions') this.computerHistoryTokens.set(response.session.responseId, inputTokens + outputTokens)
      return response
    } catch (error) {
      if (!reconciled) {
        this.failedCalls += 1
        // An incomplete response (for example one cut off at max_output_tokens)
        // is rejected by the provider but still reports its usage. Meter it as
        // a failed call within its reservation so the loop's retry with more
        // output headroom is admitted; anything unmetered closes the campaign.
        let known = error instanceof OpenAIComputerActionResponseError ? boundedUsage(error.usage, inputReserve, outputBound) : null
        let knownModel = error instanceof OpenAIComputerActionResponseError && error.responseModel ? error.responseModel : model
        if (error instanceof ComputerUseReportRejectedError) { known = boundedUsage(error.response.usage, inputReserve, outputBound); knownModel = error.response.model }
        // A stream that went silent after `response.created` still finishes and bills on
        // the server. Read its stored usage back so the retry is admitted; only a response
        // that cannot be read stays unknown and closes the campaign.
        if (!known && error instanceof ResponseStreamIdleError && error.progress.responseId && this.inner.retrieveResponseUsage) {
          for (let attempt = 0; attempt < 3 && !known; attempt++) {
            if (attempt > 0) await delay(2_500)
            const retrieved = await this.inner.retrieveResponseUsage(error.progress.responseId).catch(() => null)
            if (retrieved?.status === 'not_found') {
              // The provider affirms the response was never stored: nothing to meter, and the retry is admitted.
              known = { inputTokens: 0, outputTokens: 0 }
              this.options.onStalledUsageReconciled?.({ responseId: error.progress.responseId, attempts: attempt + 1, status: 'not_found' })
            } else if (retrieved && 'usage' in retrieved && retrieved.status !== 'in_progress' && retrieved.status !== 'queued') {
              known = boundedUsage(retrieved.usage, inputReserve, outputBound)
              if (retrieved.model) knownModel = retrieved.model
              this.options.onStalledUsageReconciled?.({ responseId: error.progress.responseId, attempts: attempt + 1, status: retrieved.status })
            }
          }
        }
        if (known) {
          const costUsd = this.cost(known.inputTokens, known.outputTokens, this.priceForModel(knownModel))
          this.inputTokens += known.inputTokens; this.outputTokens += known.outputTokens; this.costUsdValue += costUsd
          this.options.onUsage?.({ inputTokens: known.inputTokens, outputTokens: known.outputTokens, costUsd, completedCalls: 0, failedCalls: 1 })
        } else if (this.meterTransportFailure(error, this.cost(inputReserve, outputBound, this.priceForModel(model)))) {
          // Metered at its own reserve per attempt that may have reached the provider.
        } else if (this.chargeUnknownReserve()) {
          // Charged the worst-case reserve; the campaign continues.
        } else {
          this.usageUnknown = true
          this.exhaustedReason = 'Computer-use request failed without reconciled usage; further campaign requests are blocked.'
          this.options.onUsageUnknown?.()
        }
      }
      throw error
    } finally { stopObservingCancellation(); release() }
  }

  /** See transportFailureMeteringEnabled. Returns false for any other failure. */
  private meterTransportFailure(error: unknown, perAttemptReserveUsd: number): boolean {
    if (!(error instanceof ProviderTransportError) || !transportFailureMeteringEnabled()) return false
    const costUsd = error.attemptsMayHaveReached * perAttemptReserveUsd
    this.costUsdValue += costUsd
    this.options.onUsage?.({ inputTokens: 0, outputTokens: 0, costUsd, completedCalls: 0, failedCalls: 1 })
    return true
  }

  /** Charges the configured worst-case reserve for a call whose usage could not
   * be read, and reports whether it did. Returns false when no reserve is
   * configured, so the caller keeps the original halting behaviour. */
  private chargeUnknownReserve(requestReserve = 0): boolean {
    const configured = this.options.unknownUsageReserveUsd
    if (!configured || configured <= 0) return false
    const reserve = Math.max(configured, requestReserve)
    this.costUsdValue += reserve
    this.unknownReserveCalls += 1
    this.options.onUsage?.({ inputTokens: 0, outputTokens: 0, costUsd: reserve, completedCalls: 0, failedCalls: 0 })
    return true
  }

  get summary() {
    const summary = this.inner.summary
    return {
      ...summary,
      capabilities: { ...summary.capabilities, embeddings: false },
      privacyNote: `${summary.privacyNote} Evaluation governor: embeddings disabled; calls, tokens, output, and cost are bounded.`,
    }
  }
  get supportsInitialComputerScreenshot(): boolean { return this.inner.supportsInitialComputerScreenshot === true }
  get supportsGoalPlanning(): boolean { return this.inner.supportsGoalPlanning === true }
  get supportsPublicSearch(): boolean { return this.inner.supportsPublicSearch === true && typeof this.inner.searchPublicWeb === 'function' }

  async searchPublicWeb(request: PublicSearchRequest): Promise<PublicLookupEvidence> {
    request.signal.throwIfAborted()
    validatePublicSearchRequest(request)
    const config = this.options.publicSearch
    if (!this.supportsPublicSearch || !config) throw new EvaluationModelBudgetExceededError('Public search requires an explicit evaluation reserve and tool price')
    if (this.options.maxOutputTokensPerCall < publicLookupLimits.outputTokens) throw new EvaluationModelBudgetExceededError('The fixed public search output limit exceeds the campaign per-call limit')
    const price = this.priceForModel(request.model)
    const release = this.reserve(config.reservedInputTokens, publicLookupLimits.outputTokens, 1, price,
      publicLookupLimits.toolCalls * config.costPerToolCallUsd)
    this.attemptedCalls += 1
    const stopObservingCancellation = this.observeCancellation(request.signal)
    let completed = false
    try {
      this.options.onDispatch?.(1)
      const response = await this.inner.searchPublicWeb!(request)
      const { inputTokens, outputTokens } = response.usage
      if (inputTokens === null || outputTokens === null || !Number.isSafeInteger(inputTokens) || inputTokens < 0
        || !Number.isSafeInteger(outputTokens) || outputTokens < 0
        || !Number.isSafeInteger(response.toolCalls) || response.toolCalls < 1 || response.toolCalls > publicLookupLimits.toolCalls) {
        throw new EvaluationModelBudgetExceededError('Public search returned incomplete or invalid usage')
      }
      const costUsd = this.cost(inputTokens, outputTokens, this.priceForModel(response.model))
        + response.toolCalls * config.costPerToolCallUsd
      this.inputTokens += inputTokens
      this.outputTokens += outputTokens
      this.costUsdValue += costUsd
      this.completedCalls += 1
      completed = true
      this.options.onUsage?.({ inputTokens, outputTokens, costUsd, completedCalls: 1 })
      if (this.inputTokens + this.outputTokens > this.options.maxTokens || this.costUsdValue > this.options.maxCostUsd) {
        this.exhaustedReason = 'Public search exceeded its campaign allowance; further paid calls are blocked.'
      }
      return response
    } catch (error) {
      if (!completed && !this.usageUnknown) {
        this.failedCalls += 1
        const reserveUsd = this.cost(config.reservedInputTokens, publicLookupLimits.outputTokens, price) + publicLookupLimits.toolCalls * config.costPerToolCallUsd
        const reported = error instanceof PublicSearchError && error.usage.inputTokens !== null && error.usage.outputTokens !== null
          && Number.isSafeInteger(error.usage.inputTokens) && Number.isSafeInteger(error.usage.outputTokens) && error.usage.inputTokens >= 0 && error.usage.outputTokens >= 0
          ? { inputTokens: error.usage.inputTokens, outputTokens: error.usage.outputTokens, toolCalls: error.toolCalls ?? publicLookupLimits.toolCalls } : null
        if (this.meterTransportFailure(error, reserveUsd)) {
          // Metered at its own reserve per attempt that may have reached the provider.
        } else if (searchFailureReserveEnabled() && reported) {
          // A completed-but-rejected search reports what it used; meter exactly that, tool fees at the stated count.
          const costUsd = this.cost(reported.inputTokens, reported.outputTokens, price) + Math.max(0, reported.toolCalls) * config.costPerToolCallUsd
          this.inputTokens += reported.inputTokens; this.outputTokens += reported.outputTokens; this.costUsdValue += costUsd
          this.options.onUsage?.({ inputTokens: reported.inputTokens, outputTokens: reported.outputTokens, costUsd, completedCalls: 0, failedCalls: 1 })
        } else if (searchFailureReserveEnabled() && this.chargeUnknownReserve(reserveUsd)) {
          // Charged the worst-case reserve; the campaign continues.
        } else {
          // A rejected search can contain unfinished tool operations. Preserve
          // its durable pending reservation rather than infer a final charge.
          this.usageUnknown = true
          this.exhaustedReason = 'Public search failed before usage was reconciled; further campaign calls are blocked.'
          this.options.onUsageUnknown?.()
        }
      } else if (!completed) this.failedCalls += 1
      throw error
    } finally { stopObservingCancellation(); release() }
  }
  get computerActionRequestCount(): number {
    return supportsComputerActionProposals(this.inner) ? this.inner.computerActionRequestCount : 0
  }

  setModel(model: string): void {
    if (!this.inner.setModel) throw new Error('The wrapped model provider has a fixed model')
    this.inner.setModel(model)
  }

  listModels(): Promise<string[]> {
    if (!this.inner.listModels) throw new Error('The wrapped model provider cannot list models')
    return this.inner.listModels()
  }

  /** Abort races the provider's rejected promise. Close the spending gate in
   * the abort event itself, before an eager fallback can reserve another call. */
  private observeCancellation(signal?: AbortSignal, cancelledBoundUsd?: number): (() => void) & { charged?: boolean } {
    const stop: (() => void) & { charged?: boolean } = () => signal?.removeEventListener('abort', aborted)
    const aborted = () => {
      if (this.usageUnknown) return
      // A request cancelled by Carve itself (the losing half of a hedge, a superseded speculation) is charged its full
      // reserved bound, synchronously, and the campaign continues; with no configured reserve the gate closes as before.
      // In one run a hedged method selection closed the gate and every later call in the attempt failed.
      if (cancelledBoundUsd !== undefined && cancelledReserveChargeEnabled() && this.chargeUnknownReserve(cancelledBoundUsd)) { stop.charged = true; return }
      this.usageUnknown = true
      this.exhaustedReason = 'A hosted request was cancelled before usage was reconciled; further campaign calls are blocked.'
      this.options.onUsageUnknown?.()
    }
    signal?.addEventListener('abort', aborted, { once: true })
    return stop
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    request.signal?.throwIfAborted()
    const requestedOutputTokens = request.maxOutputTokens ?? this.options.maxOutputTokensPerCall
    positiveInteger(requestedOutputTokens, 'request.maxOutputTokens')
    const maxOutputTokens = Math.min(requestedOutputTokens, this.options.maxOutputTokensPerCall)
    const estimatedTextTokens = Math.ceil((request.system.length + request.prompt.length + JSON.stringify(request.jsonSchema ?? {}).length) / 4)
    const reservedInputTokens = estimatedTextTokens + (request.images?.length ?? 0) * this.options.reservedInputTokensPerImage
    const requestPrice = this.priceForModel(request.model ?? this.inner.summary.model)
    const release = this.reserve(reservedInputTokens, maxOutputTokens, 1, requestPrice)
    this.attemptedCalls += 1
    let providerCompleted = false
    const stopObservingCancellation = this.observeCancellation(request.signal, this.cost(reservedInputTokens, maxOutputTokens, requestPrice))
    try {
      this.options.onDispatch?.(1)
      const response = await this.inner.complete({
        ...request,
        maxOutputTokens,
        ...cappedEffort(request.reasoningEffort, this.options.reasoningEffort),
        safetyIdentifier: this.options.safetyIdentifier,
      })
      providerCompleted = true
      this.completedCalls += 1
      if (response.usage.inputTokens === null || response.usage.outputTokens === null) {
        this.usageUnknown = true
        this.exhaustedReason = 'The hosted provider omitted token usage; further paid calls are blocked.'
        this.options.onUsageUnknown?.()
        return response
      }
      let responsePrice: EvaluationModelPrice
      try {
        responsePrice = this.priceForModel(response.model)
      } catch (error) {
        this.usageUnknown = true
        this.exhaustedReason = `The hosted provider returned unpriced model ${response.model}; further paid calls are blocked.`
        this.options.onUsageUnknown?.()
        throw error
      }
      const costUsd = this.cost(response.usage.inputTokens, response.usage.outputTokens, responsePrice)
      this.inputTokens += response.usage.inputTokens
      this.outputTokens += response.usage.outputTokens
      this.costUsdValue += costUsd
      this.options.onUsage?.({
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        costUsd,
        completedCalls: 1,
      })
      const snapshot = this.snapshot()
      if (snapshot.totalTokens > this.options.maxTokens) {
        this.exhaustedReason = `The campaign consumed ${snapshot.totalTokens} tokens, above its ${this.options.maxTokens}-token ceiling.`
      } else if (snapshot.costUsd > this.options.maxCostUsd) {
        this.exhaustedReason = `The campaign reached $${snapshot.costUsd.toFixed(4)}, above its $${this.options.maxCostUsd.toFixed(2)} ceiling.`
      }
      return response
    } catch (error) {
      if (!providerCompleted) {
        this.failedCalls += 1
        if (stopObservingCancellation.charged) {
          // Already charged its reserved bound when it was cancelled.
        } else if (!this.usageUnknown && this.meterTransportFailure(error, this.cost(reservedInputTokens, maxOutputTokens, requestPrice))) {
          // Metered at its own reserve per attempt that may have reached the provider.
        } else if (!this.usageUnknown && !this.chargeUnknownReserve(this.cost(reservedInputTokens, maxOutputTokens, requestPrice))) {
          this.usageUnknown = true
          this.exhaustedReason = 'The hosted provider failed without billable usage; further campaign calls are blocked.'
          this.options.onUsageUnknown?.()
        }
      }
      throw error
    } finally {
      stopObservingCancellation()
      release()
    }
  }

  async proposeComputerActions(request: ComputerActionRequest): Promise<ComputerActionResponse> {
    request.signal?.throwIfAborted()
    if (!supportsComputerActionProposals(this.inner)) {
      throw new EvaluationModelBudgetExceededError('The wrapped provider has no specialized computer-action proposal surface')
    }
    const providerRequestCount = this.inner.computerActionRequestCount
    positiveInteger(providerRequestCount, 'computerActionRequestCount')
    const requestedOutputTokens = request.maxOutputTokens ?? this.options.maxOutputTokensPerCall
    positiveInteger(requestedOutputTokens, 'request.maxOutputTokens')
    const maxOutputTokens = Math.min(requestedOutputTokens, this.options.maxOutputTokensPerCall)
    const estimatedTextTokens = Math.ceil((request.system.length + request.prompt.length) / 4)
    // Screenshot-first OpenAI proposals repeat the task, replay the first
    // output, and include one image. Reserve one full output as replay input.
    const reservedInputTokens = estimatedTextTokens * providerRequestCount
      + this.options.reservedInputTokensPerImage
      + maxOutputTokens * Math.max(0, providerRequestCount - 1)
    const reservedOutputTokens = maxOutputTokens * providerRequestCount
    const requestPrice = this.priceForModel(request.model ?? this.inner.summary.model)
    const release = this.reserve(reservedInputTokens, reservedOutputTokens, providerRequestCount, requestPrice)
    this.attemptedCalls += providerRequestCount
    let providerCompleted = false
    const stopObservingCancellation = this.observeCancellation(request.signal)
    try {
      this.options.onDispatch?.(providerRequestCount)
      const response = await this.inner.proposeComputerActions({
        ...request,
        maxOutputTokens,
        ...(this.options.reasoningEffort ? { reasoningEffort: this.options.reasoningEffort } : {}),
        safetyIdentifier: this.options.safetyIdentifier,
      })
      providerCompleted = true
      positiveInteger(response.providerRequestCount, 'response.providerRequestCount')
      if (response.providerRequestCount > providerRequestCount) {
        this.attemptedCalls += response.providerRequestCount - providerRequestCount
      }
      this.completedCalls += response.providerRequestCount
      if (response.usage.inputTokens === null || response.usage.outputTokens === null) {
        this.usageUnknown = true
        this.exhaustedReason = 'The hosted computer-action provider omitted aggregate token usage; further paid calls are blocked.'
        this.options.onUsageUnknown?.()
        return response
      }
      let responsePrice: EvaluationModelPrice
      try {
        responsePrice = this.priceForModel(response.model)
      } catch (error) {
        this.usageUnknown = true
        this.exhaustedReason = `The hosted computer-action provider returned unpriced model ${response.model}; further paid calls are blocked.`
        this.options.onUsageUnknown?.()
        throw error
      }
      const costUsd = this.cost(response.usage.inputTokens, response.usage.outputTokens, responsePrice)
      this.inputTokens += response.usage.inputTokens
      this.outputTokens += response.usage.outputTokens
      this.costUsdValue += costUsd
      this.options.onUsage?.({
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        costUsd,
        completedCalls: response.providerRequestCount,
      })
      if (response.providerRequestCount !== providerRequestCount) {
        this.usageUnknown = true
        this.exhaustedReason = `The computer-action provider used ${response.providerRequestCount} requests instead of its declared ${providerRequestCount}; further paid calls are blocked.`
        this.options.onUsageUnknown?.()
        throw new EvaluationModelBudgetExceededError(this.exhaustedReason)
      }
      const snapshot = this.snapshot()
      if (snapshot.totalTokens > this.options.maxTokens) {
        this.exhaustedReason = `The campaign consumed ${snapshot.totalTokens} tokens, above its ${this.options.maxTokens}-token ceiling.`
      } else if (snapshot.costUsd > this.options.maxCostUsd) {
        this.exhaustedReason = `The campaign reached $${snapshot.costUsd.toFixed(4)}, above its $${this.options.maxCostUsd.toFixed(2)} ceiling.`
      }
      return response
    } catch (error) {
      if (!providerCompleted) {
        // The adapter may have failed after its screenshot-request call. Count
        // the full declared protocol conservatively because exact usage is not
        // available on a thrown response.
        this.failedCalls += providerRequestCount
        if (!this.usageUnknown) {
          this.usageUnknown = true
          this.exhaustedReason = 'The hosted computer-action provider failed without aggregate billable usage; further campaign calls are blocked.'
          this.options.onUsageUnknown?.()
        }
      }
      throw error
    } finally {
      stopObservingCancellation()
      release()
    }
  }

  async embed(_texts: string[]): Promise<EmbeddingResponse> {
    throw new EvaluationModelBudgetExceededError('Embedding calls are outside this approved model-driven computer campaign')
  }

  health(): Promise<{ ok: boolean; message: string }> {
    return this.inner.health()
  }

  snapshot(): EvaluationModelBudgetSnapshot {
    const totalTokens = this.inputTokens + this.outputTokens
    return {
      attemptedCalls: this.attemptedCalls,
      completedCalls: this.completedCalls,
      failedCalls: this.failedCalls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens,
      costUsd: this.costUsdValue,
      usageUnknown: this.usageUnknown,
      exhaustedReason: this.exhaustedReason,
    }
  }

  private reserve(inputTokens: number, outputTokens: number, calls: number, price: EvaluationModelPrice, toolCostUsd = 0): () => void {
    if (this.options.maxInputTokensPerCall !== undefined && inputTokens > this.options.maxInputTokensPerCall) {
      throw new EvaluationModelBudgetExceededError(`The request's input reserve exceeds the ${this.options.maxInputTokensPerCall}-token per-call context limit.`)
    }
    this.assertAvailable(inputTokens, outputTokens, calls, price, toolCostUsd)
    const tokens = inputTokens + outputTokens
    const cost = this.cost(inputTokens, outputTokens, price) + toolCostUsd
    this.reservedTokens += tokens
    this.reservedCostUsd += cost
    return () => {
      this.reservedTokens -= tokens
      this.reservedCostUsd = Math.max(0, this.reservedCostUsd - cost)
    }
  }

  private assertAvailable(
    reservedInputTokens: number,
    reservedOutputTokens: number,
    reservedCalls: number,
    price: EvaluationModelPrice,
    toolCostUsd = 0,
  ): void {
    positiveInteger(reservedCalls, 'reservedCalls')
    const current = this.snapshot()
    const reason = this.exhaustedReason
      ?? (this.attemptedCalls + reservedCalls > this.options.maxCalls
        ? `The next request protocol would exceed the campaign's ${this.options.maxCalls}-call ceiling.`
        : current.totalTokens + this.reservedTokens + reservedInputTokens + reservedOutputTokens > this.options.maxTokens
          ? `The next request's conservative token reserve would exceed the ${this.options.maxTokens}-token ceiling.`
          : current.costUsd + this.reservedCostUsd + this.cost(reservedInputTokens, reservedOutputTokens, price) + toolCostUsd > this.options.maxCostUsd
            ? `The next request's conservative cost reserve would exceed the $${this.options.maxCostUsd.toFixed(2)} ceiling.`
            : null)
    if (reason) {
      this.exhaustedReason = reason
      throw new EvaluationModelBudgetExceededError(reason)
    }
  }

  private priceForModel(model: string): EvaluationModelPrice {
    if (!this.options.pricesByModel) return this.options.price
    const price = this.options.pricesByModel[model]
    if (!price) {
      this.exhaustedReason = `Model ${model} has no approved evaluation price; further paid calls are blocked.`
      throw new EvaluationModelBudgetExceededError(this.exhaustedReason)
    }
    return price
  }

  private cost(inputTokens: number, outputTokens: number, price: EvaluationModelPrice): number {
    return (inputTokens / 1_000_000) * price.inputPerMillion
      + (outputTokens / 1_000_000) * price.outputPerMillion
  }
}

/** Usage a failed turn reported, accepted only when it is a whole, non-negative count inside the reservation made for it. */
function boundedUsage(usage: { inputTokens: number | null; outputTokens: number | null }, inputReserve: number, maxOutputTokens: number): { inputTokens: number; outputTokens: number } | null {
  const { inputTokens, outputTokens } = usage
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return null
  if (!Number.isInteger(inputTokens) || !Number.isInteger(outputTokens) || inputTokens < 0 || outputTokens < 0) return null
  if (inputTokens > inputReserve || outputTokens > maxOutputTokens) return null
  return { inputTokens, outputTokens }
}
