import { normalizeOpenAIProviderUsage } from '../../gateway/src/provider-cost.js'
import { readResponseStream, type ResponseStreamProgress } from './response-stream.js'

/**
 * Silence budget per computer-use phase, below the 60 s hard deadline. A
 * session start answers with at most a screenshot request or a first batch;
 * a continuation may reason for a while before its first output event.
 * Override with STEWARD_OPENAI_STREAM_IDLE_MS for experiments.
 */
export function computerUseStreamIdleMs(phase: string, env: NodeJS.ProcessEnv = process.env): number {
  const override = Number(env.STEWARD_OPENAI_STREAM_IDLE_MS)
  if (Number.isFinite(override) && override > 0) return override
  return phase === 'session start' ? 20_000 : 45_000
}
import { randomUUID, createHash } from 'node:crypto'
import { searchOpenAIPublicWeb } from './openai-public-search.js'
import type { PublicSearchRequest, PublicLookupEvidence } from '../public-web.js'
import type {
  ComputerActionModifier,
  ComputerActionMouseButton,
  ComputerActionProposal,
  ComputerActionRequest,
  ComputerActionResponse,
  ComputerRequestTiming,
  ComputerUseSessionHandle,
  ComputerUseTurn,
  ContinueComputerUseSessionRequest,
  EmbeddingResponse,
  ModelMetering,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelResponseTelemetry,
  StartComputerUseSessionRequest,
} from './types.js'
import { attachRequestTiming, ComputerUseSessionStateLostError, ProviderTransientRequestError, requireCapabilities, requireRequestCapabilities } from './types.js'
import { withTransportRetry } from './transport-retry.js'

/** What a failed response says, whatever shape its body takes: OpenAI's JSON
 * error, a proxy's HTML page, or nothing at all. The status is read before
 * the body, so an unparseable body never hides it behind a parse error.
 *
 * `transient` marks OpenAI's intermittent service auth failure: a 404 with
 * no body and `x-openai-ide-error-code: service_auth_failure` (observed on
 * one day at roughly 3 of 20 requests). The request never reached the
 * model, so the caller may safely send it again. The request id is kept in
 * the message for OpenAI support. */
async function describeFailedResponse(response: Response): Promise<{ message: string; transient: boolean; requestId: string | null; code: string | null; body: unknown }> {
  const requestId = response.headers.get('x-request-id')
  const serviceCode = response.headers.get('x-openai-ide-error-code') ?? response.headers.get('x-openai-authorization-error')
  let text = ''
  try { text = (await response.text()).trim() } catch { text = '' }
  const transient = response.status === 404 && (text === '' || serviceCode !== null)
  if (transient) {
    return { transient, requestId, code: 'service_auth_failure', body: null, message: `transient service failure${serviceCode ? ` (${serviceCode.replace(/[^\w.-]/gu, '').slice(0, 60)})` : ''} before the model saw the request${requestId ? `; OpenAI request ${requestId.replace(/[^\w-]/gu, '').slice(0, 80)}` : ''}` }
  }
  if (!text) return { transient, requestId, code: null, body: null, message: 'empty response body' }
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown; code?: unknown; type?: unknown } }
    const code = typeof parsed?.error?.code === 'string' ? parsed.error.code : typeof parsed?.error?.type === 'string' ? parsed.error.type : null
    const message = typeof parsed?.error?.message === 'string' && parsed.error.message ? parsed.error.message.slice(0, 300) : 'unknown error'
    return { transient, requestId, code, body: parsed, message }
  } catch { /* Not JSON: fall through to a bounded excerpt. */ }
  return { transient, requestId, code: null, body: null, message: text.replace(/\s+/gu, ' ').slice(0, 120) }
}

/** Resends for OpenAI's transient service failure on single-shot requests
 * (text completions, embeddings). Nothing reached the model, the requests are
 * stateless, and the failure clears within seconds, so three quick resends
 * turn a ~15% failure rate into a rounding error without any caller changes. */
const transientResendLimit = 3
async function transientResendDelay(attempt: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 300 * (attempt + 1))
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason as Error) }, { once: true })
  })
}

interface HostedResponse {
  service_tier?: string
  id?: string
  model?: string
  status?: string
  output_text?: string
  output?: HostedResponseOutput[]
  usage?: {
    input_tokens?: number
    input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number }
    output_tokens?: number
    output_tokens_details?: { reasoning_tokens?: number }
    total_tokens?: number
  }
  incomplete_details?: { reason?: string }
  error?: { message?: string; code?: string; type?: string }
}

interface HostedResponseOutput {
  phase?: string
  type?: string
  call_id?: string
  status?: string
  actions?: unknown[]
  /** The single-action shape of a computer call; read as a one-element batch. */
  action?: unknown
  pending_safety_checks?: unknown[]
  content?: Array<{ type?: string; text?: string }>
}

/** Responses may contain commentary before the schema-constrained final message. */
function hostedFinalText(body: HostedResponse): string {
  const finals = body.output?.filter(item => item.phase === 'final_answer') ?? []
  const messages = finals.length ? finals : (body.output ?? []).filter(item => item.phase !== 'commentary')
  const finalText = messages.flatMap(item => item.content ?? []).filter(item => item.type === 'output_text').map(item => item.text ?? '').join('')
  return body.output?.some(item => item.phase === 'commentary' || item.phase === 'final_answer')
    ? finalText : body.output_text ?? finalText
}

/** Safe operational metadata for a failed or incomplete Responses API turn. It deliberately excludes request content and frames;
 * callers can still meter known usage and distinguish output exhaustion from
 * transport failure. */
export class OpenAIComputerActionResponseError extends Error {
  usage: ComputerActionResponse['usage']
  telemetry?: ModelResponseTelemetry

  constructor(
    readonly phase: string,
    readonly responseStatus: string,
    readonly incompleteReason: string | null,
    usage: ComputerActionResponse['usage'],
    readonly responseId: string | null,
    readonly responseModel: string | null,
  ) {
    super(`OpenAI computer-action ${phase} response was not complete (status: ${responseStatus}${incompleteReason ? `, reason: ${incompleteReason}` : ''})`)
    this.name = 'OpenAIComputerActionResponseError'
    this.usage = usage
  }

  includePriorUsage(prior: HostedResponse['usage']): this {
    this.usage = combineNormalizedUsage(
      normalizeHostedUsage(prior),
      this.usage,
    )
    return this
  }
}

/** Construction options shared by the direct OpenAI adapter and relays that
 * speak the same Responses API (Carve Cloud). */
export interface HostedOpenAIProviderOptions {
  apiKey?: string
  model?: string
  embeddingModel?: string
  /** Responses-compatible API root. Defaults to OpenAI's. */
  baseUrl?: string
  identity?: { id: string; name: string; privacyNote: string }
  /** Bearer supplier; defaults to the API key. Relays supply a device or session token. */
  credentials?: () => string | null
  /** Extra headers per request, e.g. billing purpose for a relay. */
  extraHeaders?: (metering: ModelMetering | undefined) => Record<string, string>
  /** Preserve a relay's structured failures instead of treating them as model output. */
  responseError?: (status: number, body: unknown) => Error | null
  /** Processing tier for direct OpenAI requests that do not choose one themselves; read per request. Never applied to a relay. */
  serviceTier?: () => 'default' | 'fast' | undefined
  /** The API root forwards OpenAI's explicit prompt-cache breakpoints unchanged. True for OpenAI itself; a relay opts in. */
  explicitPromptCache?: boolean
}

const OPENAI_BASE_URL = 'https://api.openai.com/v1'

/**
 * Fast processing costs twice the token price. Measured on the same recorded requests, five interleaved
 * pairs each: the small model's step decision took 2.6 s instead of 3.3 s (+$0.0005 per call), while the strong
 * model's final check took 2.1 s instead of 4.3 s for +$0.04 per call, which doubles the largest line of a run's cost
 * (Sol is 88% of spend). So "fast" is withheld from the strong models (Sol, Astra) unless `STEWARD_FAST_TIER_SCOPE=all`.
 */
export function fastTierApplies(model: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_FAST_TIER_SCOPE?.trim().toLowerCase() === 'all' || !/-(?:sol|astra)\b/iu.test(model)
}

export class HostedOpenAIProvider implements ModelProvider {
  readonly supportsInitialComputerScreenshot = true

  readonly supportsGoalPlanning = true
  readonly computerActionRequestCount = 2
  private model: string
  readonly embeddingModel: string
  protected readonly baseUrl: string
  private readonly identity: { id: string; name: string; privacyNote: string }
  private readonly credentials: () => string | null
  private readonly extraHeaders: (metering: ModelMetering | undefined) => Record<string, string>
  private readonly defaultServiceTier: () => 'default' | 'fast' | undefined
  private readonly responseError: NonNullable<HostedOpenAIProviderOptions['responseError']>
  private readonly explicitPromptCache: boolean

  constructor(
    apiKeyOrOptions: string | HostedOpenAIProviderOptions = process.env.OPENAI_API_KEY ?? '',
    model = process.env.STEWARD_OPENAI_MODEL ?? 'gpt-5.6-terra',
    // Embeddings come from a different, far cheaper model than chat, so the
    // two are configured separately rather than sharing one name.
    embeddingModel = process.env.STEWARD_OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
  ) {
    const options: HostedOpenAIProviderOptions = typeof apiKeyOrOptions === 'string' ? { apiKey: apiKeyOrOptions } : apiKeyOrOptions
    const apiKey = options.apiKey ?? ''
    this.model = options.model ?? model
    this.embeddingModel = options.embeddingModel ?? embeddingModel
    this.baseUrl = (options.baseUrl ?? OPENAI_BASE_URL).replace(/\/+$/u, '')
    this.identity = options.identity ?? {
      id: 'openai-hosted',
      name: 'OpenAI hosted',
      privacyNote: 'Selected inputs are sent to OpenAI. Carve never sends captures merely because this adapter is configured.',
    }
    this.credentials = options.credentials ?? (() => (apiKey ? apiKey : null))
    this.defaultServiceTier = options.serviceTier ?? (() => undefined)
    this.extraHeaders = options.extraHeaders ?? (() => ({}))
    this.responseError = options.responseError ?? (() => null)
    this.explicitPromptCache = options.explicitPromptCache ?? this.baseUrl === OPENAI_BASE_URL
  }

  /** Recomputed rather than frozen at construction, so changing the model in
   *  the interface takes effect on the next call instead of the next launch. */
  get summary() {
    return {
      id: this.identity.id,
      name: this.identity.name,
      kind: 'hosted' as const,
      model: this.model,
      originalImageDetail: /^gpt-(?:5\.[456](?:[.-]|$)|6(?:[.-]|$))/u.test(this.model),
      embeddingModel: this.embeddingModel,
      baseUrl: this.baseUrl,
      configured: this.bearer() !== null,
      capabilities: {
        text: true,
        vision: true,
        embeddings: true,
        structuredOutput: true,
        toolCalling: true,
      },
      privacyNote: this.identity.privacyNote,
    }
  }

  protected bearer(): string | null {
    const token = this.credentials()
    return token && token.length > 0 ? token : null
  }

  protected requestHeaders(metering: ModelMetering | undefined): Record<string, string> {
    return { authorization: `Bearer ${this.bearer() ?? ''}`, 'content-type': 'application/json', ...this.extraHeaders(metering) }
  }

  setModel(model: string): void {
    this.model = model
  }

  get supportsPublicSearch(): boolean {
    // Relays must opt in only after their tool policy and billing support it.
    return this.identity.id === 'openai-hosted' && this.baseUrl === OPENAI_BASE_URL && this.bearer() !== null
  }

  async searchPublicWeb(request: PublicSearchRequest): Promise<PublicLookupEvidence> {
    if (!this.supportsPublicSearch) throw new Error('Public web search is unavailable for this configured provider')
    return searchOpenAIPublicWeb(request, this.requestHeaders(undefined))
  }

  /** Model ids the account can actually use. Listing is not a billed request. */
  async listModels(): Promise<string[]> {
    if (!this.bearer()) throw new Error('OpenAI hosted provider is not configured')
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: { authorization: `Bearer ${this.bearer() ?? ''}` },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) throw new Error(`Model listing failed with HTTP ${response.status}`)
    const body = await response.json() as { data?: Array<{ id?: string }> }
    return (body.data ?? []).map((entry) => entry.id).filter((entry): entry is string => typeof entry === 'string').sort()
  }

  /** A request's own tier, else the configured default for direct OpenAI requests. Relays and other API roots never receive a default. */
  private serviceTierFor(requested?: 'default' | 'fast', model?: string): 'default' | 'fast' | undefined {
    const tier = requested ?? (this.baseUrl === OPENAI_BASE_URL ? this.defaultServiceTier() : undefined)
    return tier === 'fast' && model !== undefined && !fastTierApplies(model) ? undefined : tier
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    requireRequestCapabilities(this, request)
    if (!this.bearer()) throw new Error('OpenAI hosted provider is not configured. Set OPENAI_API_KEY or select the mock/local provider.')
    const requestModel = validateOpenAIModelId(request.model ?? this.model)
    const startedAt = new Date().toISOString()
    const started = performance.now()
    // Where this request is, for a failure's record (ProviderRequestTiming); updated as it progresses.
    let timedHeadersMs: number | null = null, timedStatus: number | null = null, timedAttempts = 0, timedStream: ResponseStreamProgress | undefined, timedConnectionRetries = 0
    try {
    const streaming = this.baseUrl === OPENAI_BASE_URL
    let stream: ResponseStreamProgress | undefined
    const explicitCache = this.explicitPromptCache && request.promptCache === 'explicit' && /^gpt-(?:5\.6-|6-)/u.test(requestModel)
    const serviceTier = this.serviceTierFor(request.serviceTier, requestModel)
    const prefixes = request.cacheablePrefixes?.length ? request.cacheablePrefixes : request.cacheablePrefix ? [request.cacheablePrefix] : []
    if (prefixes.some((candidate, index) => !request.prompt.startsWith(candidate) || (index > 0 && !candidate.startsWith(prefixes[index - 1]!))))
      throw new Error('Cache prefix must match the exact beginning of the request')
    const breakpoints = explicitCache ? prefixes.filter((candidate, index) => candidate.length > (index ? prefixes[index - 1]!.length : 0)) : []
    const prefix = breakpoints.at(-1)
    // Split at every earlier segment boundary as well as this turn's breakpoints, marking only the breakpoints.
    const marked = new Set(breakpoints.map(candidate => candidate.length))
    const cuts = [...new Set([...(explicitCache && prefix ? (request.cacheSegmentBoundaries ?? []).filter(offset => offset > 0 && offset < prefix.length) : []), ...marked])].sort((a, b) => a - b)
    const userContent = [
      ...cuts.map((end, index) => ({ type: 'input_text', text: request.prompt.slice(index ? cuts[index - 1]! : 0, end), ...(marked.has(end) ? { prompt_cache_breakpoint: { mode: 'explicit' } } : {}) })),
      ...(request.prompt.length > (prefix?.length ?? 0) ? [{ type: 'input_text', text: request.prompt.slice(prefix?.length ?? 0) }] : []),
      ...(request.images ?? []).map(image => ({ type: 'input_image', image_url: image.dataUrl, detail: image.detail ?? 'high' })),
    ]
    const input = request.images?.length || prefix ? [{ role: 'user', content: userContent }] : request.prompt
    let connectionRetries = 0
    for (let attempt = 0; ; attempt++) {
    timedHeadersMs = null; timedStatus = null; timedStream = undefined
    // A connection that fails before any response is resent here (26 Sep
    // qualification: `fetch failed` ×3); a stream that already delivered
    // bytes is never replayed, because only the fetch itself is wrapped.
    const sent = await withTransportRetry(() => fetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      redirect: 'error',
      headers: this.requestHeaders(request.metering),
      body: JSON.stringify({
        model: requestModel,
        ...(streaming ? { stream: true } : {}),
        ...(explicitCache ? {
          input: [
            { role: 'developer', content: [{ type: 'input_text', text: request.system, prompt_cache_breakpoint: { mode: 'explicit' } }] },
            ...(typeof input === 'string' ? [{ role: 'user', content: [{ type: 'input_text', text: input }] }] : input),
          ],
          prompt_cache_options: { mode: 'explicit', ...(/^gpt-6-/u.test(requestModel) ? { ttl: '30m' } : {}) },
        } : { instructions: request.system, input }),
        ...(serviceTier ? { service_tier: serviceTier } : {}),
        // Recall inputs can contain private screen evidence. Keep each request
        // stateless even when the account's broader retention policy allows
        // stored Responses objects.
        store: false,
        ...(request.maxOutputTokens === undefined ? {} : { max_output_tokens: request.maxOutputTokens }),
        ...(request.reasoningEffort === undefined ? {} : { reasoning: { effort: request.reasoningEffort } }),
        ...(request.safetyIdentifier === undefined ? {} : { safety_identifier: request.safetyIdentifier }),
        ...(request.jsonSchema
          ? { text: { format: { type: 'json_schema', name: request.jsonSchema.name, schema: request.jsonSchema.schema, strict: request.jsonSchema.strict } } }
          : request.requireJson ? { text: { format: { type: 'json_object' } } } : {}),
      }),
      signal: request.signal
        ? AbortSignal.any([request.signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
    }), { phase: 'text', callerSignal: request.signal })
    const response = sent.value
    connectionRetries += sent.connectionRetries
    const headersMs = performance.now() - started
    timedHeadersMs = headersMs; timedStatus = response.status; timedAttempts = attempt + 1; timedConnectionRetries = connectionRetries
    // A failed response is described before its body is parsed, so an empty
    // or non-JSON body reports the HTTP status instead of a parse error. A
    // JSON failure body still carries usage and tier for cost accounting.
    const failed = response.ok ? null : await describeFailedResponse(response)
    const relayError = failed ? this.responseError(response.status, failed.body) : null
    if (relayError) throw relayError
    if (failed?.transient) {
      if (attempt < transientResendLimit && !request.signal?.aborted) { await transientResendDelay(attempt, request.signal); continue }
      throw new ProviderTransientRequestError('text', response.status, failed.requestId, `OpenAI request failed (${response.status}): ${failed.message}`)
    }
    const body: HostedResponse = failed
      ? (failed.body as HostedResponse | null) ?? { error: { message: failed.message } }
      : response.headers.get('content-type')?.includes('text/event-stream')
        ? await readResponseStream<HostedResponse>(response, started, (progress) => {
            stream = progress; timedStream = progress
            request.onStreamProgress?.(progress)
          })
        : await response.json() as HostedResponse
    const responseMs = performance.now() - started
    const telemetry: ModelResponseTelemetry = {
        requestStartedAt: startedAt, headersMs, responseMs, responseId: body.id ?? null,
        providerRequestCount: attempt + 1 + connectionRetries, transportRetries: attempt + connectionRetries,
        ...(connectionRetries ? { connectionRetries } : {}),
        outputMessagePhases: (body.output ?? []).filter(item => item.type === 'message').map(item => item.phase ?? 'unspecified'),
        ...(stream ? { stream } : {}),
        ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
        ...(serviceTier ? { requestedServiceTier: serviceTier } : {}),
        ...(body.service_tier ? { serviceTier: body.service_tier } : {}),
        ...(explicitCache ? { promptCache: 'explicit' as const } : {}),
        systemHash: createHash('sha256').update(request.system).digest('hex'),
        schemaHash: request.jsonSchema ? createHash('sha256').update(JSON.stringify(request.jsonSchema)).digest('hex') : null,
        promptCharacters: request.prompt.length,
        cachedPrefixCharacters: prefix?.length ?? 0,
        contextSections: [
          ...prefixes.map((candidate, index) => ({ name: index ? `task-prefix-${index + 1}` : 'task-prefix', text: candidate.slice(index ? prefixes[index - 1]!.length : 0) })),
          { name: 'current-decision', text: request.prompt.slice(prefixes.at(-1)?.length ?? 0) },
        ].map(section => ({ name: section.name, characters: section.text.length, sha256: createHash('sha256').update(section.text).digest('hex') })),
        imageCount: request.images?.length ?? 0,
        imageDescriptors: (request.images ?? []).map(image => ({ width: image.width ?? null, height: image.height ?? null, detail: image.detail ?? 'high' })),
      }
    if (failed || body.status && body.status !== 'completed') {
      const error = new OpenAIComputerActionResponseError('text', body.status ?? `http_${response.status}`, body.incomplete_details?.reason ?? null,
        normalizeHostedUsage(body.usage), body.id ?? null, body.model ?? requestModel)
      error.telemetry = telemetry
      if (body.error?.code || body.error?.type) Object.assign(error, { code: body.error.code ?? body.error.type })
      if (failed) error.message = `OpenAI request failed (${response.status}): ${failed.message}`
      throw error
    }
    const text = hostedFinalText(body)
    return { text, model: body.model ?? requestModel, providerId: this.summary.id,
      usage: normalizeHostedUsage(body.usage), responseId: body.id ?? null, telemetry }
    }
    } catch (error) {
      const eventCount = timedStream?.eventCount ?? 0
      throw attachRequestTiming(error, {
        stage: error instanceof OpenAIComputerActionResponseError ? 'after_response' : timedHeadersMs === null ? 'awaiting_headers'
          : timedStatus !== null && (timedStatus < 200 || timedStatus >= 300) ? 'http_error' : !eventCount ? 'awaiting_first_event' : 'streaming',
        requestStartedAt: startedAt, elapsedMs: performance.now() - started, headersMs: timedHeadersMs, httpStatus: timedStatus,
        firstEventMs: timedStream?.firstEventMs ?? null, firstTextMs: timedStream?.firstTextMs ?? null, lastEventMs: timedStream?.lastEventMs ?? null,
        eventCount, outputCharacters: timedStream?.outputCharacters ?? 0, providerRequestCount: Math.max(1, timedAttempts) + timedConnectionRetries,
        connectionRetries: timedConnectionRetries, promptCharacters: request.prompt.length, imageCount: request.images?.length ?? 0,
      })
    }
  }
  /**
   * One stateless, screenshot-first OpenAI computer-tool proposal over an
   * already authorized frame. The first response must request a screenshot;
   * the second replays that response plus `computer_call_output`, including
   * encrypted reasoning items, without relying on provider-side storage.
   * Returned actions remain advisory data only.
   */
  async proposeComputerActions(request: ComputerActionRequest): Promise<ComputerActionResponse> {
    requireCapabilities(this, ['text', 'vision', 'tool_calling'])
    if (!this.bearer()) throw new Error('OpenAI hosted provider is not configured. Set OPENAI_API_KEY before requesting computer-action proposals.')
    const requestModel = validateOpenAIModelId(request.model ?? this.model)
    const frame = validateComputerFrame(request.screenshot.width, request.screenshot.height)
    const evidenceId = boundedString(request.screenshot.evidenceId, 'computer-action evidence id', 300)
    const screenshotDataUrl = validateComputerScreenshotDataUrl(request.screenshot.dataUrl)
    const userInput = [{ role: 'user', content: [{ type: 'input_text', text: request.prompt }] }]
    const commonBody = {
      model: requestModel,
      instructions: request.system,
      tools: [{ type: 'computer' }],
      // This surface asks for one advisory action, never a conversational
      // answer. Binding tool choice prevents "click X" prose from being
      // mistaken for an executable proposal; callers still compile it.
      tool_choice: { type: 'computer' },
      // Encrypted reasoning items make manual, stateless turn replay possible
      // when storage is disabled or the account uses Zero Data Retention.
      include: ['reasoning.encrypted_content'],
      store: false,
      ...(this.serviceTierFor(undefined, requestModel) === undefined ? {} : { service_tier: this.serviceTierFor(undefined, requestModel) }),
      ...(request.maxOutputTokens === undefined ? {} : { max_output_tokens: request.maxOutputTokens }),
      ...(request.reasoningEffort === undefined ? {} : { reasoning: { effort: request.reasoningEffort } }),
      ...(request.safetyIdentifier === undefined ? {} : { safety_identifier: request.safetyIdentifier }),
    }
    const createResponse = async (phase: 'screenshot request' | 'action proposal', input: unknown): Promise<HostedResponse> => {
      const { value: response } = await withTransportRetry(() => fetch(`${this.baseUrl}/responses`, {
        method: 'POST',
        redirect: 'error',
        headers: this.requestHeaders(request.metering),
        body: JSON.stringify({ ...commonBody, input }),
        signal: request.signal
          ? AbortSignal.any([request.signal, AbortSignal.timeout(60_000)])
          : AbortSignal.timeout(60_000),
      }), { phase: `computer-action ${phase}`, callerSignal: request.signal })
      if (!response.ok) {
        const failure = await describeFailedResponse(response)
        const relayError = this.responseError(response.status, failure.body)
        if (relayError) throw relayError
        const message = `OpenAI computer-action ${phase} failed (${response.status}): ${failure.message}`
        if (failure.transient) throw new ProviderTransientRequestError(phase, response.status, failure.requestId, message)
        throw new Error(message)
      }
      const body = await response.json() as HostedResponse
      assertCompletedComputerResponse(body, phase)
      return body
    }

    const initial = await createResponse('screenshot request', userInput)
    const initialCall = onlyComputerCall(initial, 'screenshot request')
    const initialSafetyChecks = normalizeOpenAISafetyChecks(initialCall.pending_safety_checks)
    if (initialSafetyChecks.length > 0) {
      return {
        callId: boundedString(initialCall.call_id, 'screenshot request call id', 300),
        evidenceId,
        frame,
        providerRequestCount: 1,
        actions: [],
        terminalText: null,
        pendingSafetyChecks: initialSafetyChecks,
        model: initial.model ?? requestModel,
        providerId: this.summary.id,
        usage: normalizeHostedUsage(initial.usage),
        responseId: initial.id ?? null,
      }
    }
    requireOnlyScreenshotAction(initialCall.actions, frame)
    const initialCallId = boundedString(initialCall.call_id, 'screenshot request call id', 300)
    request.onScreenshotTransmitted?.()
    let final: HostedResponse
    try {
      final = await createResponse('action proposal', [
        ...userInput,
        ...(initial.output ?? []),
        {
          type: 'computer_call_output',
          call_id: initialCallId,
          output: {
            type: 'computer_screenshot',
            image_url: screenshotDataUrl,
            // Computer use depends on small UI details. Preserve exact pixels.
            detail: 'original',
          },
        },
      ])
    } catch (error) {
      if (error instanceof OpenAIComputerActionResponseError) error.includePriorUsage(initial.usage)
      throw error
    }
    const call = optionalComputerCall(final, 'action proposal')
    if (!call) {
      return {
        callId: null,
        evidenceId,
        frame,
        providerRequestCount: this.computerActionRequestCount,
        actions: [],
        terminalText: hostedResponseText(final),
        pendingSafetyChecks: [],
        model: final.model ?? requestModel,
        providerId: this.summary.id,
        usage: combineHostedUsage(initial.usage, final.usage),
        responseId: final.id ?? null,
      }
    }
    const callId = boundedString(call.call_id, 'computer call id', 300)
    const actions = normalizeOpenAIComputerActions(call.actions, frame)
    if (actions.length === 0) throw new Error('OpenAI computer-action response contained no actions')
    return {
      callId,
      evidenceId,
      frame,
      providerRequestCount: this.computerActionRequestCount,
      actions,
      terminalText: null,
      pendingSafetyChecks: normalizeOpenAISafetyChecks(call.pending_safety_checks),
      model: final.model ?? requestModel,
      providerId: this.summary.id,
      usage: combineHostedUsage(initial.usage, final.usage),
      responseId: final.id ?? null,
    }
  }

  /**
   * Start the provider-owned computer-use loop used by Universal mode. This is
   * intentionally separate from the stateless one-shot proposal API above:
   * A supplied initial image permits a grounded first answer/action proposal.
   * Without one, the first tool call must request a screenshot. Returned call
   * IDs bind continuations; they never authorize local input execution.
   */
  async startComputerUseSession(request: StartComputerUseSessionRequest): Promise<ComputerUseTurn> {
    requireCapabilities(this, ['text', 'vision', 'tool_calling'])
    if (!this.bearer()) throw new Error('OpenAI hosted provider is not configured. Set OPENAI_API_KEY before starting computer use.')
    const requestModel = validateOpenAIModelId(request.model ?? this.model)
    const system = boundedString(request.system, 'computer-use system instructions', 100_000, true)
    const prompt = boundedString(request.prompt, 'computer-use goal', 100_000)
    const frame = request.screenshot ? validateComputerFrame(request.screenshot.width, request.screenshot.height) : null
    const image = request.screenshot ? validateComputerScreenshotDataUrl(request.screenshot.dataUrl) : null
    if (request.screenshot) boundedString(request.screenshot.evidenceId, 'computer-use evidence id', 300)
    request.signal?.throwIfAborted()
    if (image) request.onScreenshotTransmitted?.()
    const body = await this.createStoredComputerUseResponse({
      phase: 'session start',
      model: requestModel,
      system,
      input: image ? [{ role: 'user', content: [
        { type: 'input_text', text: `${prompt}\n\nYour first observation is attached: a screenshot of the authorized window taken just now (${frame!.width}×${frame!.height}). It is current and authoritative, and it is your coordinate space. Do not spend a turn requesting a screenshot; propose your first action, or answer, from this image. Request another screenshot only after the window changes.` },
        { type: 'input_image', image_url: image, detail: 'original' },
      ] }] : prompt,
      initialScreenshot: Boolean(image),
      ...(request.onRequestTiming ? { onRequestTiming: request.onRequestTiming } : {}),
      ...(request.metering === undefined ? {} : { metering: request.metering }),
      ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
      ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
      ...(request.safetyIdentifier === undefined ? {} : { safetyIdentifier: request.safetyIdentifier }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    return normalizeComputerTurnWithUsage(body, 'session start', () => normalizeStartedComputerUseTurn(body, this.summary.id, requestModel, frame))
  }

  /** Continue exactly the response that produced the pending computer call. */
  async continueComputerUseSession(request: ContinueComputerUseSessionRequest): Promise<ComputerUseTurn> {
    requireCapabilities(this, ['text', 'vision', 'tool_calling'])
    if (!this.bearer()) throw new Error('OpenAI hosted provider is not configured. Set OPENAI_API_KEY before continuing computer use.')
    const session = validateComputerUseSessionHandle(request.session, this.summary.id)
    const frame = validateComputerFrame(request.screenshot.width, request.screenshot.height)
    boundedString(request.screenshot.evidenceId, 'computer-use evidence id', 300)
    const instructions = boundedString(request.instructions, 'computer-use continuation instructions', 100_000, true)
    const runtimeNote = request.runtimeNote === undefined ? null : boundedString(request.runtimeNote, 'computer-use continuation status', 100_000, true)
    const attachments = (request.attachments ?? []).slice(0, 2).map((attachment) => ({
      dataUrl: validateComputerScreenshotDataUrl(attachment.dataUrl),
      width: validateComputerFrame(attachment.width, attachment.height).width,
      height: attachment.height,
      label: boundedString(attachment.label, 'computer-use attachment label', 200, true),
    }))
    const screenshotDataUrl = validateComputerScreenshotDataUrl(request.screenshot.dataUrl)
    if (!session.pendingCallId) throw new Error('The computer-use session has no pending call to receive a screenshot')
    request.onScreenshotTransmitted?.()
    const body = await this.createStoredComputerUseResponse({
      phase: 'session continuation',
      ...(request.onRequestTiming ? { onRequestTiming: request.onRequestTiming } : {}),
      model: session.model,
      system: instructions,
      previousResponseId: session.responseId,
      input: [{
        type: 'computer_call_output',
        call_id: session.pendingCallId,
        output: {
          type: 'computer_screenshot',
          image_url: screenshotDataUrl,
          detail: 'original',
        },
      },
      // The status note and any crop follow the screenshot so everything
      // before them is a prefix the cache already holds from the previous turn.
      ...(runtimeNote || attachments.length ? [{ role: 'user', content: [
        ...(runtimeNote ? [{ type: 'input_text', text: runtimeNote }] : []),
        ...attachments.flatMap((attachment) => [
          { type: 'input_text', text: `Attached image: ${attachment.label} (${attachment.width}×${attachment.height}). It is for reading only; it is not a coordinate space.` },
          { type: 'input_image', image_url: attachment.dataUrl, detail: 'original' },
        ]),
      ] }] : [])],
      ...(request.metering === undefined ? {} : { metering: request.metering }),
      ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
      ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
      ...(request.safetyIdentifier === undefined ? {} : { safetyIdentifier: request.safetyIdentifier }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    return normalizeComputerTurnWithUsage(body, 'session continuation', () => normalizeContinuedComputerUseTurn(body, session, frame))
  }

  private async createStoredComputerUseResponse(input: {
    initialScreenshot?: boolean
    onRequestTiming?: (timing: ComputerRequestTiming) => void
    phase: string
    model: string
    system?: string
    previousResponseId?: string
    input: unknown
    metering?: ModelMetering
    maxOutputTokens?: number
    reasoningEffort?: ModelRequest['reasoningEffort']
    safetyIdentifier?: string
    signal?: AbortSignal
  }): Promise<HostedResponse> {
    const started = performance.now()
    const requestStartedAt = new Date().toISOString()
    const requestId = randomUUID()
    let headersMs: number | null = null
    let httpStatus: number | null = null
    let progress: ResponseStreamProgress | undefined
    let responseId: string | null = null
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000)
    const report = (stage: ComputerRequestTiming['stage']) => {
      try { input.onRequestTiming?.({ requestId, phase: input.phase, stage, requestStartedAt,
        elapsedMs: performance.now() - started, headersMs, httpStatus,
        firstEventMs: progress?.firstEventMs ?? null, firstTextMs: progress?.firstTextMs ?? null,
        responseId: responseId ?? progress?.responseId ?? null, model: input.model, initialScreenshot: input.initialScreenshot ?? false }) } catch { /* Telemetry never changes execution. */ }
    }
    report('started')
    try {
      signal.throwIfAborted()
      // One 60 s deadline covers every resend of this turn: a connection that
      // failed fast is resent, one that used the deadline is not.
      const { value: response } = await withTransportRetry(() => fetch(`${this.baseUrl}/responses`, {
        method: 'POST',
        redirect: 'error',
        headers: this.requestHeaders(input.metering),
        body: JSON.stringify({
          model: input.model,
          stream: this.baseUrl === OPENAI_BASE_URL,
          ...(input.system === undefined ? {} : { instructions: input.system }),
          input: input.input,
          tools: [{ type: 'computer' }],
          tool_choice: 'auto',
          // Universal mode deliberately buys provider-owned conversational state
          // for the shortest faithful implementation of the documented loop.
          store: true,
          ...(this.serviceTierFor(undefined, input.model) === undefined ? {} : { service_tier: this.serviceTierFor(undefined, input.model) }),
          ...(input.previousResponseId === undefined ? {} : { previous_response_id: input.previousResponseId }),
          ...(input.maxOutputTokens === undefined ? {} : { max_output_tokens: input.maxOutputTokens }),
          ...(input.reasoningEffort === undefined ? {} : { reasoning: { effort: input.reasoningEffort } }),
          ...(input.safetyIdentifier === undefined ? {} : { safety_identifier: input.safetyIdentifier }),
        }),
        signal,
      }), { phase: `computer-use ${input.phase}`, callerSignal: signal })
      headersMs = performance.now() - started
      httpStatus = response.status
      report('headers')
      if (!response.ok) {
        const failure = await describeFailedResponse(response)
        const relayError = this.responseError(response.status, failure.body)
        if (relayError) throw relayError
        const message = `OpenAI computer-use ${input.phase} failed (${response.status}): ${failure.message}`
        if (failure.transient) throw new ProviderTransientRequestError(input.phase, response.status, failure.requestId, message)
        if (response.status === 404 && input.previousResponseId !== undefined) throw new ComputerUseSessionStateLostError(input.phase, response.status, message)
        throw new Error(message)
      }
      const body = response.headers.get('content-type')?.includes('text/event-stream')
        ? await readResponseStream<HostedResponse>(response, started, value => {
          const first = !progress
          progress = value
          if (first) report('first_event')
        }, { idleMs: computerUseStreamIdleMs(input.phase) }) : await response.json() as HostedResponse
      responseId = body.id ?? null
      assertCompletedComputerResponse(body, input.phase)
      report('completed')
      return body
    } catch (error) { report(input.signal?.aborted ? 'cancelled' : 'failed'); throw error }
  }

  async retrieveResponseUsage(responseId: string, signal?: AbortSignal): Promise<{ usage: ComputerActionResponse['usage']; model: string | null; status: string | null } | { status: 'not_found' } | null> {
    if (!this.bearer() || !/^[A-Za-z0-9_-]{1,300}$/u.test(responseId)) return null
    try {
      const response = await fetch(`${this.baseUrl}/responses/${encodeURIComponent(responseId)}`, {
        method: 'GET', redirect: 'error', headers: this.requestHeaders(undefined),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
      })
      if (response.status === 404) return { status: 'not_found' }
      if (!response.ok) return null
      const body = await response.json() as HostedResponse
      const usage = normalizeHostedUsage(body.usage)
      if (usage.inputTokens === null || usage.outputTokens === null) return null
      return { usage, model: body.model ?? null, status: body.status ?? null }
    } catch { return null }
  }

  async embed(texts: string[]): Promise<EmbeddingResponse> {
    requireCapabilities(this, ['embeddings'])
    if (!this.bearer()) throw new Error('OpenAI hosted provider is not configured')
    if (texts.length === 0) return { vectors: [], usage: { inputTokens: 0 } }
    for (let attempt = 0; ; attempt++) {
      const { value: response } = await withTransportRetry(() => fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        redirect: 'error',
        headers: this.requestHeaders({ purpose: 'recall' }),
        body: JSON.stringify({ model: this.embeddingModel, input: texts }),
        signal: AbortSignal.timeout(60_000),
      }), { phase: 'embeddings' })
      if (!response.ok) {
        const failure = await describeFailedResponse(response)
        const relayError = this.responseError(response.status, failure.body)
        if (relayError) throw relayError
        if (failure.transient && attempt < transientResendLimit) { await transientResendDelay(attempt); continue }
        const message = `OpenAI embeddings failed (${response.status}): ${failure.message}`
        if (failure.transient) throw new ProviderTransientRequestError('embeddings', response.status, failure.requestId, message)
        throw new Error(message)
      }
      const body = await response.json() as { data?: Array<{ embedding: number[]; index: number }>; usage?: { prompt_tokens?: number }; error?: { message?: string } }
      if (!body.data) throw new Error(body.error?.message ?? 'OpenAI embeddings returned no vectors')
      // The API may return out of order; index is authoritative.
      return {
        vectors: [...body.data].sort((left, right) => left.index - right.index).map((item) => item.embedding),
        usage: { inputTokens: body.usage?.prompt_tokens ?? null },
      }
    }
  }

  async health(): Promise<{ ok: boolean; message: string }> {
    return this.bearer()
      ? { ok: true, message: 'Configured; no paid request was made' }
      : { ok: false, message: this.identity.id === 'openai-hosted' ? 'OPENAI_API_KEY is not set' : `${this.identity.name} has no credentials yet` }
  }
}

function validateOpenAIModelId(model: string): string {
  const trimmed = model.trim()
  if (!trimmed || trimmed.length > 200 || !/^[A-Za-z0-9._:-]+$/u.test(trimmed)) {
    throw new Error('The OpenAI model id is invalid')
  }
  return trimmed
}

interface ComputerFrameBounds { width: number; height: number }

const computerModifierAliases: Record<string, ComputerActionModifier> = {
  ALT: 'ALT', OPTION: 'ALT', CTRL: 'CTRL', CONTROL: 'CTRL', META: 'META', CMD: 'META', COMMAND: 'META', WIN: 'META', WINDOWS: 'META', SHIFT: 'SHIFT',
}

function assertCompletedComputerResponse(body: HostedResponse, phase: string): void {
  if (body.status !== 'completed') {
    const status = body.status === undefined ? 'missing' : boundedString(body.status, `${phase} response status`, 40)
    const reason = body.incomplete_details?.reason === undefined
      ? null
      : boundedString(body.incomplete_details.reason, `${phase} incomplete reason`, 120)
    throw new OpenAIComputerActionResponseError(
      phase,
      status,
      reason,
      normalizeHostedUsage(body.usage),
      body.id ?? null,
      body.model ?? null,
    )
  }
}

function onlyComputerCall(body: HostedResponse, phase: string): HostedResponseOutput {
  const call = optionalComputerCall(body, phase)
  if (!call) throw new Error(`OpenAI computer-action ${phase} contained 0 computer calls; exactly one is required`)
  return call
}

function optionalComputerCall(body: HostedResponse, phase: string): HostedResponseOutput | null {
  const calls = (body.output ?? []).filter((item) => item.type === 'computer_call')
  if (calls.length > 1) throw new Error(`OpenAI computer-action ${phase} contained ${calls.length} computer calls; at most one is accepted`)
  if (calls.length === 0) return null
  const call = calls[0]!
  if (call.status !== 'completed') {
    const status = call.status === undefined ? 'missing' : boundedString(call.status, `${phase} computer call status`, 40)
    throw new Error(`OpenAI computer-action ${phase} call was not complete (status: ${status})`)
  }
  return call
}

function hostedResponseText(body: HostedResponse): string | null {
  const text = hostedFinalText(body)
  if (text === undefined || text === null || !text.trim()) return null
  return boundedString(text, 'computer-action terminal text', 10_000, true).trim()
}

/** A completed API response can still contain an invalid tool proposal. Reject
 * the proposal while retaining its billed usage; never confuse validation with
 * a transport failure whose usage is genuinely unknown. */
function normalizeComputerTurnWithUsage(body: HostedResponse, phase: string, normalize: () => ComputerUseTurn): ComputerUseTurn {
  try { return normalize() } catch (cause) {
    if (cause instanceof OpenAIComputerActionResponseError) throw cause
    const error = new OpenAIComputerActionResponseError(phase, 'invalid_output', null,
      normalizeHostedUsage(body.usage), body.id ?? null, body.model ?? null)
    error.message = `OpenAI computer-use ${phase} response failed validation: ${cause instanceof Error ? cause.message : 'invalid tool output'}`
    throw error
  }
}

function normalizeStartedComputerUseTurn(
  body: HostedResponse,
  providerId: string,
  requestModel: string,
  frame: ComputerFrameBounds | null = null,
): ComputerUseTurn {
  const call = optionalComputerCall(body, 'session start')
  if (!call) return terminalComputerUseTurn(body, providerId, requestModel, 0)
  if (frame) {
    const actions = normalizeOpenAIComputerActions(call.actions, frame)
    if (!actions.length) throw new Error('OpenAI computer-use response contained no actions')
    return computerUseCallTurn(body, call, providerId, requestModel, 0, actions)
  }
  // Without an image the first call should only ask for one. A model that
  // acts instead (the Thin fallback's first turn, which read the
  // handoff note and clicked) chose blind: nothing it proposed runs, and the
  // call is answered with the screenshot it should have asked for. Only a
  // malformed call remains a validation failure.
  const blind = blindFirstTurnActions(call.actions)
  return { ...computerUseCallTurn(body, call, providerId, requestModel, 0, [{ kind: 'screenshot' }]), ...(blind ? { blindActionsDiscarded: blind } : {}) }
}

function normalizeContinuedComputerUseTurn(
  body: HostedResponse,
  prior: ComputerUseSessionHandle,
  frame: ComputerFrameBounds,
): ComputerUseTurn {
  const call = optionalComputerCall(body, 'session continuation')
  if (!call) return terminalComputerUseTurn(body, prior.providerId, prior.model, prior.turnIndex + 1)
  // A call with neither an action list nor a single action (the Thin
  // fallback's third turn, 11 output tokens) proposes nothing:
  // it runs nothing and only asks for a fresh observation, counted as an
  // invalid decision so repeated empty calls still end the run.
  const raw = Array.isArray(call.actions) ? call.actions : call.action !== undefined && call.action !== null ? [call.action] : []
  const actions = normalizeOpenAIComputerActions(raw, frame)
  if (actions.length === 0) return { ...computerUseCallTurn(body, call, prior.providerId, prior.model, prior.turnIndex + 1, [{ kind: 'screenshot' }]), invalidDecision: true }
  return computerUseCallTurn(body, call, prior.providerId, prior.model, prior.turnIndex + 1, actions)
}

function computerUseCallTurn(
  body: HostedResponse,
  call: HostedResponseOutput,
  providerId: string,
  fallbackModel: string,
  turnIndex: number,
  actions: ComputerActionProposal[],
): ComputerUseTurn {
  const callId = boundedString(call.call_id, 'computer-use call id', 300)
  const model = validateOpenAIModelId(body.model ?? fallbackModel)
  const session: ComputerUseSessionHandle = {
    providerId,
    model,
    responseId: boundedString(body.id, 'computer-use response id', 300),
    pendingCallId: callId,
    turnIndex,
    continuationMode: 'provider_state',
  }
  const usage = normalizeHostedUsage(body.usage)
  const served = body.service_tier ? { serviceTier: boundedString(body.service_tier, 'service tier', 40) } : {}
  const pendingSafetyChecks = normalizeOpenAISafetyChecks(call.pending_safety_checks)
  if (pendingSafetyChecks.length > 0) {
    return {
      kind: 'safety_check',
      session,
      providerId,
      model,
      usage,
      ...served,
      callId,
      actions,
      pendingSafetyChecks,
      terminalText: null,
    }
  }
  return {
    kind: 'actions',
    session,
    providerId,
    model,
    usage,
    ...served,
    callId,
    actions,
    pendingSafetyChecks: [],
    terminalText: null,
  }
}

function terminalComputerUseTurn(
  body: HostedResponse,
  providerId: string,
  fallbackModel: string,
  turnIndex: number,
): ComputerUseTurn {
  const model = validateOpenAIModelId(body.model ?? fallbackModel)
  return {
    kind: 'terminal',
    session: {
      providerId,
      model,
      responseId: boundedString(body.id, 'computer-use response id', 300),
      pendingCallId: null,
      turnIndex,
      continuationMode: 'provider_state',
    },
    providerId,
    model,
    usage: normalizeHostedUsage(body.usage),
    ...(body.service_tier ? { serviceTier: boundedString(body.service_tier, 'service tier', 40) } : {}),
    callId: null,
    actions: [],
    pendingSafetyChecks: [],
    terminalText: hostedResponseText(body),
  }
}

/** How many non-screenshot actions a first turn without an image proposed (0
 * for the expected lone screenshot request). Every entry must still be an
 * object with a type; anything else is malformed and fails validation. */
function blindFirstTurnActions(raw: unknown): number {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) {
    throw new Error('OpenAI computer-use first turn must contain a screenshot request')
  }
  const types = raw.map((entry, index) => objectValue(entry, `initial computer action ${index + 1}`)['type'])
  if (types.some(type => typeof type !== 'string')) throw new Error('OpenAI computer-use first turn contained an action without a type')
  return types.filter(type => type !== 'screenshot').length
}

function validateComputerUseSessionHandle(
  value: ComputerUseSessionHandle,
  providerId: string,
): ComputerUseSessionHandle {
  if (value.providerId !== providerId) throw new Error('The computer-use session belongs to a different provider')
  if (value.continuationMode !== 'provider_state') throw new Error('The computer-use continuation mode is unsupported')
  if (!Number.isInteger(value.turnIndex) || value.turnIndex < 0 || value.turnIndex > 100_000) throw new Error('The computer-use turn index is invalid')
  return {
    providerId,
    model: validateOpenAIModelId(value.model),
    responseId: boundedString(value.responseId, 'computer-use response id', 300),
    pendingCallId: value.pendingCallId === null ? null : boundedString(value.pendingCallId, 'computer-use pending call id', 300),
    turnIndex: value.turnIndex,
    continuationMode: value.continuationMode,
  }
}

function requireOnlyScreenshotAction(raw: unknown, frame: ComputerFrameBounds): void {
  const actions = normalizeOpenAIComputerActions(raw, frame)
  if (actions.length !== 1 || actions[0]?.kind !== 'screenshot') {
    throw new Error('OpenAI computer-action first turn must contain exactly one screenshot request; no pre-screenshot action is accepted')
  }
}

function combineHostedUsage(
  first: HostedResponse['usage'],
  second: HostedResponse['usage'],
): ComputerActionResponse['usage'] {
  const combine = (left: number | undefined, right: number | undefined): number | null => left === undefined || right === undefined ? null : left + right
  const combined: ComputerActionResponse['usage'] = {
    inputTokens: combine(first?.input_tokens, second?.input_tokens),
    outputTokens: combine(first?.output_tokens, second?.output_tokens),
  }
  const totalTokens = combine(first?.total_tokens, second?.total_tokens)
  const cachedInputTokens = combine(first?.input_tokens_details?.cached_tokens, second?.input_tokens_details?.cached_tokens)
  const cacheWriteTokens = combine(first?.input_tokens_details?.cache_write_tokens, second?.input_tokens_details?.cache_write_tokens)
  const reasoningTokens = combine(first?.output_tokens_details?.reasoning_tokens, second?.output_tokens_details?.reasoning_tokens)
  if (totalTokens !== null) combined.totalTokens = totalTokens
  if (cachedInputTokens !== null) combined.cachedInputTokens = cachedInputTokens
  if (cacheWriteTokens !== null) combined.cacheWriteTokens = cacheWriteTokens
  if (reasoningTokens !== null) combined.reasoningTokens = reasoningTokens
  return combined
}

function combineNormalizedUsage(
  first: ComputerActionResponse['usage'],
  second: ComputerActionResponse['usage'],
): ComputerActionResponse['usage'] {
  const combine = (left: number | null, right: number | null): number | null => left === null || right === null ? null : left + right
  const combined: ComputerActionResponse['usage'] = {
    inputTokens: combine(first.inputTokens, second.inputTokens),
    outputTokens: combine(first.outputTokens, second.outputTokens),
  }
  const combineOptional = (left: number | null | undefined, right: number | null | undefined): number | null => left === undefined || left === null || right === undefined || right === null ? null : left + right
  const totalTokens = combineOptional(first.totalTokens, second.totalTokens)
  const cachedInputTokens = combineOptional(first.cachedInputTokens, second.cachedInputTokens)
  const cacheWriteTokens = combineOptional(first.cacheWriteTokens, second.cacheWriteTokens)
  const reasoningTokens = combineOptional(first.reasoningTokens, second.reasoningTokens)
  if (totalTokens !== null) combined.totalTokens = totalTokens
  if (cachedInputTokens !== null) combined.cachedInputTokens = cachedInputTokens
  if (cacheWriteTokens !== null) combined.cacheWriteTokens = cacheWriteTokens
  if (reasoningTokens !== null) combined.reasoningTokens = reasoningTokens
  return combined
}

function normalizeHostedUsage(usage: HostedResponse['usage']): ComputerActionResponse['usage'] {
  const normalized = normalizeOpenAIProviderUsage(usage)
  return { inputTokens: normalized.inputTokens, outputTokens: normalized.outputTokens,
    ...Object.fromEntries(Object.entries(normalized).filter(([key, value]) => key !== 'inputTokens' && key !== 'outputTokens' && value !== null)) }
}

function validateComputerFrame(width: number, height: number): ComputerFrameBounds {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 32_768 || height > 32_768) {
    throw new Error('Computer-action frame dimensions must be integers between 1 and 32768 pixels')
  }
  return { width, height }
}

function validateComputerScreenshotDataUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 50_000_000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/u.test(value)) {
    throw new Error('Computer-action screenshots must be bounded PNG, JPEG, or WebP data URLs')
  }
  return value
}

function normalizeOpenAIComputerActions(raw: unknown, frame: ComputerFrameBounds): ComputerActionProposal[] {
  if (!Array.isArray(raw)) throw new Error('OpenAI computer call did not contain an action array')
  if (raw.length > 32) throw new Error('OpenAI computer call exceeded Carve\'s 32-action proposal limit')
  return raw.map((value, index) => normalizeOpenAIComputerAction(value, frame, index))
}

function normalizeOpenAIComputerAction(value: unknown, frame: ComputerFrameBounds, index: number): ComputerActionProposal {
  const action = objectValue(value, `computer action ${index + 1}`)
  const kind = boundedString(action['type'], `computer action ${index + 1} type`, 40)
  if (kind === 'click' || kind === 'double_click') {
    return {
      kind,
      point: computerPoint(action, frame, `computer action ${index + 1}`),
      button: computerButton(action['button']),
      modifiers: computerModifiers(action['keys']),
    }
  }
  if (kind === 'move') {
    return { kind, point: computerPoint(action, frame, `computer action ${index + 1}`), modifiers: computerModifiers(action['keys']) }
  }
  if (kind === 'scroll') {
    return {
      kind,
      point: computerPoint(action, frame, `computer action ${index + 1}`),
      deltaX: boundedNumber(action['scroll_x'], `computer action ${index + 1} scroll_x`, -100_000, 100_000),
      deltaY: boundedNumber(action['scroll_y'], `computer action ${index + 1} scroll_y`, -100_000, 100_000),
      modifiers: computerModifiers(action['keys']),
    }
  }
  if (kind === 'type') return { kind, text: boundedString(action['text'], `computer action ${index + 1} text`, 100_000, true) }
  if (kind === 'keypress') return { kind, keys: computerKeys(action['keys']) }
  if (kind === 'drag') {
    if (!Array.isArray(action['path']) || action['path'].length < 2 || action['path'].length > 100) {
      throw new Error(`Computer action ${index + 1} drag path must contain 2 to 100 points`)
    }
    return {
      kind,
      path: action['path'].map((point, pointIndex) => computerPoint(objectValue(point, `computer action ${index + 1} drag point ${pointIndex + 1}`), frame, `computer action ${index + 1} drag point ${pointIndex + 1}`)),
      modifiers: computerModifiers(action['keys']),
    }
  }
  if (kind === 'wait' || kind === 'screenshot') return { kind }
  throw new Error(`OpenAI computer call returned unsupported action type "${kind}"`)
}

function computerPoint(value: Record<string, unknown>, frame: ComputerFrameBounds, label: string): { x: number; y: number } {
  return {
    x: boundedNumber(value['x'], `${label} x`, 0, frame.width - 1),
    y: boundedNumber(value['y'], `${label} y`, 0, frame.height - 1),
  }
}

function computerButton(value: unknown): ComputerActionMouseButton {
  const button = value === undefined ? 'left' : boundedString(value, 'computer action button', 20)
  if (!['left', 'right', 'wheel', 'back', 'forward'].includes(button)) throw new Error(`OpenAI computer call returned unsupported mouse button "${button}"`)
  return button as ComputerActionMouseButton
}

function computerModifiers(value: unknown): ComputerActionModifier[] {
  // Current computer responses may serialize an omitted optional modifier
  // list as null. Both absent forms mean that no modifier key was held.
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 4) throw new Error('Computer mouse action must contain at most four modifier keys')
  return value.map((key, index) => {
    const normalized = boundedString(key, `computer modifier ${index + 1}`, 50).toUpperCase()
    const result = computerModifierAliases[normalized]
    if (!result) throw new Error(`OpenAI computer mouse action contained non-modifier key "${normalized}"`)
    return result
  })
}

function computerKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new Error('Computer key action must contain 1 to 20 keys')
  return value.map((key, index) => boundedString(key, `computer key ${index + 1}`, 50))
}

function normalizeOpenAISafetyChecks(value: unknown): ComputerActionResponse['pendingSafetyChecks'] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 20) throw new Error('OpenAI computer call returned an invalid safety-check list')
  return value.map((raw, index) => {
    const check = objectValue(raw, `computer safety check ${index + 1}`)
    return {
      id: boundedString(check['id'], `computer safety check ${index + 1} id`, 300),
      code: boundedString(check['code'], `computer safety check ${index + 1} code`, 100),
      message: boundedString(check['message'], `computer safety check ${index + 1} message`, 1_000, true),
    }
  })
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function boundedString(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > maxLength) {
    throw new Error(`${label} must be ${allowEmpty ? 'a' : 'a non-empty'} string no longer than ${maxLength} characters`)
  }
  return value
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number between ${minimum} and ${maximum}`)
  }
  return value
}
