import type { ResponseStreamProgress } from './response-stream.js'
import type { ModelCapabilities, ModelCapability, ModelProviderSummary } from '../types.js'
import type { PublicSearchRequest, PublicLookupEvidence } from '../public-web.js'

/** Billing purpose for hosted relays. Local and direct providers ignore it. */
export interface ModelMetering {
  purpose: 'guide' | 'task' | 'recall' | 'other'
  taskId?: string | null
}

export interface ModelRequest {
  onStreamProgress?: (progress: ResponseStreamProgress) => void
  system: string
  metering?: ModelMetering
  prompt: string
  requireJson: boolean
  /** Optional provider-specific model override for this call. Carve uses
   * this to route high-leverage judgments separately from routine execution
   * without mutating the provider's user-selected base model. */
  model?: string
  /** Opt-in experiments; omitted fields retain provider/project defaults. */
  promptCache?: 'explicit'
  /** Exact leading user text eligible for reuse; never elevated to instructions. */
  cacheablePrefix?: string
  /** Several nested leading prefixes, shortest first, each marked as its own
   * cache breakpoint; the last one plays the role of `cacheablePrefix`. */
  cacheablePrefixes?: string[]
  /** Offsets at which the user text is split into parts even where no breakpoint is marked this turn. A provider
   * cache keys on the parts, so the same text regrouped differently misses (an append-only log cached
   * only the system prompt on 6 of 8 turns because each turn split at a different set of breakpoints). */
  cacheSegmentBoundaries?: number[]
  serviceTier?: 'default' | 'fast'
  images?: ModelImageInput[]
  jsonSchema?: ModelJsonSchema
  /** Per-request generation ceiling. Evaluation governors use this to keep a
   * single unexpectedly verbose response from consuming the evaluation budget. */
  maxOutputTokens?: number
  /** Reasoning effort is explicit in metered evaluations so the same run
   * does not silently become more expensive when provider defaults change. */
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  /** Stable, privacy-preserving identifier for hosted-provider abuse controls.
   * It must never contain an account id, email address, or API credential. */
  safetyIdentifier?: string
  /** Lets the caller stop an in-flight network request when its own deadline wins. */
  signal?: AbortSignal
}

export interface ModelImageInput {
  width?: number
  height?: number
  dataUrl: string
  evidenceId: string
  detail?: 'auto' | 'low' | 'high' | 'original'
}

export interface ComputerActionScreenshot {
  /** Controller-authored recovery receipt; never screen/model text. */
  runtimeNotice?: string
  dataUrl: string
  evidenceId: string
  /** Exact selected-window dimensions used to reject provider coordinates
   * outside the frame before any proposal can reach Carve's controller. */
  width: number
  height: number
  /** Ephemeral controller-only fingerprints. Providers receive only the image
   * and dimensions; the Universal harness uses these fields for generic local
   * settling and no-progress detection. */
  sha256?: string
  visualSample?: string | null
  /** Hash of the observed controls' roles, names and values. A one-line text
   * change is invisible to a coarse pixel sample but changes this digest, so
   * the controller can tell real progress from a hover highlight. */
  elementDigest?: string | null
  /** Bounds of the focused control, when the capture carried one; the
   * observation policy spends full resolution there when nothing changed. */
  focusedBounds?: { x: number; y: number; width: number; height: number } | null
}

export interface ComputerActionRequest {
  system: string
  prompt: string
  screenshot: ComputerActionScreenshot
  metering?: ModelMetering
  model?: string
  maxOutputTokens?: number
  reasoningEffort?: ModelRequest['reasoningEffort']
  safetyIdentifier?: string
  signal?: AbortSignal
  /** Called immediately before the provider places the screenshot into an
   * outbound request. The controller uses this boundary to keep its privacy
   * audit truthful even when the screenshot-bearing request later fails. */
  onScreenshotTransmitted?: () => void
}

export type ComputerActionModifier = 'ALT' | 'CTRL' | 'META' | 'SHIFT'
export type ComputerActionMouseButton = 'left' | 'right' | 'wheel' | 'back' | 'forward'
export interface ComputerActionPoint { x: number; y: number }

/**
 * Provider-neutral, advisory computer actions. These are deliberately not
 * Carve `LiveComputerAction`s: a provider cannot supply objective coverage,
 * authority, risk, approval, or verification merely by emitting tool output.
 * A controller must compile and validate a proposal before anything executes.
 */
export type ComputerActionProposal =
  | { kind: 'click' | 'double_click'; point: ComputerActionPoint; button: ComputerActionMouseButton; modifiers: ComputerActionModifier[] }
  | { kind: 'move'; point: ComputerActionPoint; modifiers: ComputerActionModifier[] }
  | { kind: 'scroll'; point: ComputerActionPoint; deltaX: number; deltaY: number; modifiers: ComputerActionModifier[] }
  | { kind: 'type'; text: string }
  | { kind: 'keypress'; keys: string[] }
  | { kind: 'drag'; path: ComputerActionPoint[]; modifiers: ComputerActionModifier[] }
  | { kind: 'wait' }
  | { kind: 'screenshot' }

export interface ComputerActionSafetyCheck {
  id: string
  code: string
  message: string
}

/** Safe accounting metadata returned by a model response. Optional details
 * remain absent for providers that do not expose them. */
export interface ProviderTokenUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens?: number | null
  cachedInputTokens?: number | null
  cacheWriteTokens?: number | null
  reasoningTokens?: number | null
}

export interface ComputerActionResponse {
  /** Provider call identity is audit metadata, never execution authority. */
  callId: string | null
  /** Binds every coordinate to the exact controller-owned frame supplied in
   * the request so a later compiler can reject stale proposal reuse. */
  evidenceId: string
  frame: { width: number; height: number }
  /** Number of provider API requests consumed by this logical proposal. The
   * evaluation governor uses it to budget screenshot-first protocols. */
  providerRequestCount: number
  actions: ComputerActionProposal[]
  /** A completed computer turn may legitimately stop emitting tool calls and
   * return a final answer or handoff. It remains advisory model text. */
  terminalText: string | null
  pendingSafetyChecks: ComputerActionSafetyCheck[]
  model: string
  providerId: string
  usage: ProviderTokenUsage
  responseId: string | null
}

/**
 * Opaque continuation state for a provider-owned computer-use conversation.
 * The controller may persist the identifiers for audit, but they never grant
 * permission to execute input and they must not be reused with another target.
 */
export interface ComputerUseSessionHandle {
  providerId: string
  model: string
  responseId: string
  pendingCallId: string | null
  turnIndex: number
  continuationMode: 'provider_state'
}

export interface ComputerRequestTiming {
  requestId: string
  phase: string
  stage: 'started' | 'headers' | 'first_event' | 'completed' | 'failed' | 'cancelled'
  requestStartedAt: string
  elapsedMs: number
  headersMs: number | null
  firstEventMs: number | null
  firstTextMs: number | null
  responseId: string | null
  httpStatus: number | null
  model: string
  initialScreenshot: boolean
}

export interface StartComputerUseSessionRequest {
  screenshot?: ComputerActionScreenshot
  onScreenshotTransmitted?: () => void
  onRequestTiming?: (timing: ComputerRequestTiming) => void
  system: string
  prompt: string
  metering?: ModelMetering
  model?: string
  maxOutputTokens?: number
  reasoningEffort?: ModelRequest['reasoningEffort']
  safetyIdentifier?: string
  signal?: AbortSignal
}

export interface ContinueComputerUseSessionRequest {
  /** Controller-owned: input is closed and this turn only asks for a report.
   * An adapter may then answer from the recorded frame this screenshot names
   * instead of requiring the newest observation. */
  inputClosed?: boolean
  onRequestTiming?: (timing: ComputerRequestTiming) => void
  session: ComputerUseSessionHandle
  screenshot: ComputerActionScreenshot
  metering?: ModelMetering
  /** Responses does not carry prior `instructions` forward when a request
   * uses `previous_response_id`, so the controller must supply the complete
   * current instruction set on every continuation. */
  instructions: string
  /** Turn-specific controller status (counts, receipts, recovery directives).
   * Delivered after the screenshot as ordinary input so `instructions` can stay
   * byte-identical across turns and the provider's prompt cache keeps hitting;
   * a varying prefix defeats caching on every continuation. */
  runtimeNote?: string
  /** Extra images for this turn beside the screenshot: a full-resolution crop
   * the model may read but must not use as a coordinate space. */
  attachments?: Array<{ dataUrl: string; width: number; height: number; label: string }>
  maxOutputTokens?: number
  reasoningEffort?: ModelRequest['reasoningEffort']
  safetyIdentifier?: string
  signal?: AbortSignal
  /** Called immediately before screenshot bytes are placed in an outbound request. */
  onScreenshotTransmitted?: () => void
}

interface ComputerUseTurnBase {
  session: ComputerUseSessionHandle
  providerId: string
  model: string
  usage: ProviderTokenUsage
  /** The processing tier the provider reports it served, when it reports one. */
  serviceTier?: string
  /** Action geometry defaults to the transmitted screenshot. Local compilers
   * that resolve controls against the original frame must opt out of image
   * scaling. This is adapter-owned metadata, never a model-provided field. */
  actionCoordinateSpace?: 'screenshot' | 'source_frame'
  /** Adapter-owned accounting. A `local` turn was compiled by the controller
   * without a model request and carries zero usage; `stage` names which paid
   * route produced a model turn. Never model-supplied. */
  origin?: 'model' | 'local'
  stage?: 'decision' | 'verification' | 'repair'
  /** A terminal report accepted by the independent final check or a controller proof. */
  verified?: boolean
  /** A verification turn that rejected the proposed answer. */
  verificationRejected?: boolean
  /** Adapter-owned: the final check's latest rewrite of a rejected report keeping only what it found supported, and
   * the items it named as unmet. Used when a closing report ends without an accepted answer. */
  supportedAnswer?: { answer: string; unmet: string[] }
  /** Adapter-owned: the model's decision could not be compiled into any
   * runnable command (unsupported command, or a ref that cannot take it), so
   * this turn only asks for a fresh observation. */
  invalidDecision?: boolean
  /** Adapter-owned: consecutive acting decisions after which the page's text
   * and control values only revisited states already seen in this run
   * (pixels and focus excluded). The screen changes; the task does not. */
  nonConvergingDecisions?: number
  /** Adapter-owned: acting decisions since the last one that had its intended
   * effect whose own target showed no effect (a link click that did not
   * navigate, an Enter in a search field that ran no search). Unknown outcomes
   * (a boundary page, a withheld batch) are never counted. */
  ineffectiveActions?: number
  /** Adapter-owned: a first turn without an attached screenshot proposed
   * input the model could not have grounded. None of it runs; the turn only
   * asks for the screenshot, and the controller says so in its next note. */
  blindActionsDiscarded?: number
}

/** One response in a stateful provider-owned computer-use loop. */
export type ComputerUseTurn =
  | ComputerUseTurnBase & {
      kind: 'actions'
      callId: string
      actions: ComputerActionProposal[]
      pendingSafetyChecks: []
      terminalText: null
    }
  | ComputerUseTurnBase & {
      kind: 'safety_check'
      callId: string
      actions: ComputerActionProposal[]
      pendingSafetyChecks: ComputerActionSafetyCheck[]
      terminalText: null
    }
  | ComputerUseTurnBase & {
      kind: 'terminal'
      callId: null
      actions: []
      pendingSafetyChecks: []
      terminalText: string | null
      /** Set by a controller adapter after an independent review establishes
       * both the limited report and the reason to stop. Never model-supplied
       * metadata and never evidence that the original goal was completed. */
      independentlyVerifiedStop?: boolean
    }

export interface ModelJsonSchema {
  name: string
  schema: Record<string, unknown>
  strict: true
}

export interface EmbeddingResponse {
  vectors: number[][]
  usage: { inputTokens: number | null }
}

export interface ModelResponseTelemetry {
  /** For a failed call: where the request was when it failed (ProviderRequestTiming). */
  failure?: ProviderRequestTiming
  /** Actual transport dispatches, including unbilled service-auth resends. */
  providerRequestCount?: number
  transportRetries?: number
  /** Resends after a connection failed before any response (included in transportRetries). */
  connectionRetries?: number
  outputMessagePhases?: string[]
  responseId?: string | null
  searchCalls?: number | null
  contextSections?: Array<{ name: string; characters: number; sha256: string }>
  cachedPrefixCharacters?: number

  stream?: ResponseStreamProgress
  requestStartedAt: string
  headersMs: number
  responseMs: number
  reasoningEffort?: ModelRequest['reasoningEffort']
  requestedServiceTier?: ModelRequest['serviceTier']
  serviceTier?: string
  promptCache?: ModelRequest['promptCache']
  systemHash: string
  schemaHash: string | null
  promptCharacters: number
  imageCount: number
  imageDescriptors?: Array<{ width: number | null; height: number | null; detail: string }>
}

/** A completed, billable response can still fail local report verification.
 * Keep that usage attached when unwinding the controller. */
export class ComputerUseReportRejectedError extends Error {
  /** The verifier's last reason, the rejection count, and the unverified
   * proposal. The proposal is diagnostic only: it never becomes a result.
   * `supportedAnswer` is the verifier's own rewrite keeping only supported
   * claims, with `unmet`: the only text from a rejection that may be shown. */
  constructor(message: string, readonly response: ModelResponse, readonly detail: { reason: string; rejections: number; proposedAnswer: string | null; supportedAnswer?: string | null; unmet?: string[] } = { reason: message, rejections: 0, proposedAnswer: null }) {
    super(message)
    this.name = 'ComputerUseReportRejectedError'
  }
}

export interface ModelResponse {
  telemetry?: ModelResponseTelemetry
  text: string
  model: string
  providerId: string
  usage: ProviderTokenUsage
  responseId: string | null
}

/**
 * Safe, persisted context for a failed provider request. This deliberately
 * excludes request bodies, headers, credentials, and full URLs: an audit needs
 * to explain whether inference was unreachable without turning the audit into
 * another store of user content or secrets.
 */
/**
 * Where a failed request was when it failed, carried on the thrown error (never request or response content). A call
 * that never answered is 'awaiting_headers' (the request never got a response: often a dead pooled connection) or
 * 'awaiting_first_event' / 'streaming' (the service answered, then went silent). In one run a routing call failed
 * twice at 60 s with nothing recorded to tell these apart.
 */
export interface ProviderRequestTiming {
  stage: 'awaiting_headers' | 'awaiting_first_event' | 'streaming' | 'http_error' | 'after_response'
  requestStartedAt: string
  elapsedMs: number
  headersMs: number | null
  httpStatus: number | null
  firstEventMs: number | null
  firstTextMs: number | null
  lastEventMs: number | null
  eventCount: number
  outputCharacters: number
  providerRequestCount: number
  connectionRetries: number
  promptCharacters: number
  imageCount: number
}

const requestTimings = new WeakMap<object, ProviderRequestTiming>()
/** Attach where a request was when it failed; the first attachment wins (the innermost, most specific one). */
export function attachRequestTiming<T>(error: T, timing: ProviderRequestTiming): T {
  if (error && typeof error === 'object' && !requestTimings.has(error)) requestTimings.set(error, timing)
  return error
}
export function requestTimingOf(error: unknown): ProviderRequestTiming | null {
  return error && typeof error === 'object' ? requestTimings.get(error) ?? null : null
}

export interface ModelProviderFailure {
  kind: 'transport' | 'timeout' | 'aborted' | 'response' | 'configuration' | 'quota' | 'unknown'
  retryable: boolean
  errorName: string
  message: string
  causeName: string | null
  causeCode: string | null
  causeMessage: string | null
  elapsedMs: number | null
  callerAborted: boolean
  /** Where the request was when it failed, when the provider recorded it. */
  stage?: ProviderRequestTiming['stage']
  headersMs?: number | null
  firstEventMs?: number | null
  lastEventMs?: number | null
  eventCount?: number
}

interface ModelProviderFailureOptions {
  elapsedMs?: number
  signal?: AbortSignal
}

/** Extracts enough information to diagnose a provider outage without persisting sensitive request data. */
/** The provider no longer holds the stored conversation a continuation names
 * (OpenAI answers 404 for the previous response). Completed input is real;
 * only the model's memory of it is gone, so the controller can start a fresh
 * chain from the current window instead of failing the task. */
/** A request OpenAI's own service failed before the model saw it: an
 * empty-bodied 404 whose headers name a service auth failure. Nothing was
 * processed or billed, and the same request usually succeeds seconds later,
 * so it is retried more generously than an ordinary provider error. */
export class ProviderTransientRequestError extends Error {
  constructor(readonly phase: string, readonly status: number, readonly requestId: string | null, message: string) {
    super(message)
    this.name = 'ProviderTransientRequestError'
  }
}

export class ComputerUseSessionStateLostError extends Error {
  constructor(readonly phase: string, readonly status: number, message: string) {
    super(message)
    this.name = 'ComputerUseSessionStateLostError'
  }
}

export function describeModelProviderFailure(error: unknown, options: ModelProviderFailureOptions = {}): ModelProviderFailure {
  const primary = errorFields(error)
  const cause = errorFields(primary.cause)
  const values = [primary.name, primary.message, primary.code, cause.name, cause.message, cause.code]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase()
  const callerAborted = options.signal?.aborted === true
  const quota = /insufficient_quota|credit_balance_exhausted|(?:api )?credits? (?:are )?exhausted/u.test(values)
  const timeout = /timeout|timed out|und_err_(?:connect|headers|body)_timeout/u.test(values)
  const transport = /fetch failed|network(?:\s+error)?|socket|connection|connect|dns|econn|enotfound|eai_again|tls|certificate|und_err_|transient service failure|service_auth_failure/u.test(values)
  const incomplete = /response was not complete|status:\s*incomplete/u.test(values)
  const response = incomplete || /\bhttp\s+[1-5]\d\d\b|\bstatus\s*[1-5]\d\d\b|failed \([1-5]\d\d\)/u.test(values)
  const configuration = /not configured|missingcapabilityerror|cannot perform this task/u.test(values)
  const kind = callerAborted
    ? 'aborted'
    : quota
      ? 'quota'
      : timeout
        ? 'timeout'
        : transport
          ? 'transport'
          : response
            ? 'response'
            : configuration
              ? 'configuration'
              : 'unknown'
  const statusMatch = /\b(?:http|status)\s+(\d{3})\b|failed \((\d{3})\)/u.exec(values)
  const status = statusMatch?.[1] ?? statusMatch?.[2]
  const retryable = !callerAborted && (
    kind === 'transport'
    || kind === 'timeout'
    || (kind === 'response' && incomplete && /reason:\s*max_output_tokens/u.test(values))
    || (kind === 'response' && (status === '408' || status === '409' || status === '425' || status === '429' || (status !== undefined && Number(status) >= 500)))
  )
  return {
    kind,
    retryable,
    errorName: safeProviderFailureText(primary.name ?? 'Error', 80),
    message: safeProviderFailureText(primary.message ?? String(error), 300),
    causeName: cause.name ? safeProviderFailureText(cause.name, 80) : null,
    causeCode: cause.code ? safeProviderFailureText(cause.code, 100) : null,
    causeMessage: cause.message ? safeProviderFailureText(cause.message, 300) : null,
    elapsedMs: options.elapsedMs === undefined ? null : Math.max(0, Math.round(options.elapsedMs)),
    callerAborted,
    ...(() => {
      const timing = requestTimingOf(error)
      const ms = (value: number | null) => value === null ? null : Math.round(value)
      return timing ? { stage: timing.stage, headersMs: ms(timing.headersMs), firstEventMs: ms(timing.firstEventMs), lastEventMs: ms(timing.lastEventMs), eventCount: timing.eventCount } : {}
    })(),
  }
}

/** Controller-owned copy; never expose arbitrary provider messages in the UI. */
export function providerQuotaMessage(failure: ModelProviderFailure | undefined): string | null {
  return failure?.kind === 'quota'
    ? 'The selected AI provider has run out of API credits or reached its billing quota. Add credits or resolve its billing limit, or select a funded provider in Settings.'
    : null
}

function errorFields(error: unknown): { name: string | null; message: string | null; code: string | null; cause: unknown } {
  if (!error || typeof error !== 'object') return { name: null, message: null, code: null, cause: null }
  const value = error as Record<string, unknown>
  return {
    name: typeof value.name === 'string' ? value.name : null,
    message: typeof value.message === 'string' ? value.message : null,
    code: typeof value.code === 'string' || typeof value.code === 'number' ? String(value.code) : null,
    cause: value.cause,
  }
}

function safeProviderFailureText(value: string, limit: number): string {
  return value
    .replace(/data:[^\s,]+,[^\s]*/giu, '[redacted data URL]')
    .replace(/\b(?:authorization\s*:\s*)?bearer\s+[\w.-]+/giu, 'Bearer [redacted]')
    .replace(/\bsk-[\w-]+/giu, 'sk-[redacted]')
    .replace(/\b(api[_-]?key|token|secret|password)=([^\s&]+)/giu, '$1=[redacted]')
    .replace(/https?:\/\/([^/?\s#]+)[^\s]*/giu, 'https://$1')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, limit)
}

export class MissingCapabilityError extends Error {
  constructor(providerId: string, capability: ModelCapability) {
    super(`Provider "${providerId}" cannot perform this task because it does not declare the required ${capability} capability.`)
    this.name = 'MissingCapabilityError'
  }
}

export interface ModelProvider {
  readonly supportsInitialComputerScreenshot?: boolean
  readonly summary: ModelProviderSummary
  readonly supportsPublicSearch?: boolean
  searchPublicWeb?(request: PublicSearchRequest): Promise<PublicLookupEvidence>
  /** Opt-in for providers that can turn a natural-language computer-use goal
   * into Carve's typed, clause-covered objective graph. Test and legacy
   * providers remain deterministic unless they explicitly enable it. */
  readonly supportsGoalPlanning?: boolean
  /** Fixed request count for one specialized proposal. Absent when the
   * provider has no computer-action surface. */
  readonly computerActionRequestCount?: number
  /** Most provider requests one stateful computer-use turn may issue, when an
   * adapter can make a bounded internal follow-up (a report reminder, a call
   * correction). Governors size a turn's reservation by it. Absent means one. */
  readonly maxRequestsPerComputerTurn?: number
  /** Adapters that can be pointed at a different model without a restart. */
  setModel?(model: string): void
  /** Model ids the endpoint reports. Absent when the adapter has a fixed model. */
  listModels?(): Promise<string[]>
  complete(request: ModelRequest): Promise<ModelResponse>
  /** Optional specialized perception/action surface. Results are untrusted
   * proposals and must never be sent directly to a native input backend. */
  proposeComputerActions?(request: ComputerActionRequest): Promise<ComputerActionResponse>
  /** Look up a stored response's final usage after its stream went silent, so a stalled call can be metered instead of treated as unknown. `not_found` means the provider affirms no such response exists (nothing was stored or billed); null means it could not be read. */
  retrieveResponseUsage?(responseId: string, signal?: AbortSignal): Promise<{ usage: ComputerActionResponse['usage']; model: string | null; status: string | null } | { status: 'not_found' } | null>
  /** Optional stateful computer-use loop. Unlike one-shot proposals, each
   * observation continues the response that produced the executed batch. */
  startComputerUseSession?(request: StartComputerUseSessionRequest): Promise<ComputerUseTurn>
  continueComputerUseSession?(request: ContinueComputerUseSessionRequest): Promise<ComputerUseTurn>
  /** Vectors plus what the call consumed, so embedding spend is not invisible. */
  embed(texts: string[]): Promise<EmbeddingResponse>
  health(): Promise<{ ok: boolean; message: string }>
}

export interface ComputerActionProvider extends ModelProvider {
  readonly computerActionRequestCount: number
  proposeComputerActions(request: ComputerActionRequest): Promise<ComputerActionResponse>
}

export interface ComputerUseSessionProvider extends ModelProvider {
  startComputerUseSession(request: StartComputerUseSessionRequest): Promise<ComputerUseTurn>
  continueComputerUseSession(request: ContinueComputerUseSessionRequest): Promise<ComputerUseTurn>
}

export function supportsComputerActionProposals(provider: ModelProvider): provider is ComputerActionProvider {
  return typeof provider.proposeComputerActions === 'function'
    && Number.isInteger(provider.computerActionRequestCount)
    && (provider.computerActionRequestCount ?? 0) > 0
}

export function supportsComputerUseSessions(provider: ModelProvider): provider is ComputerUseSessionProvider {
  return typeof provider.startComputerUseSession === 'function'
    && typeof provider.continueComputerUseSession === 'function'
}

export function hasCapability(capabilities: ModelCapabilities, capability: ModelCapability): boolean {
  const mapping: Record<ModelCapability, keyof ModelCapabilities> = {
    text: 'text',
    vision: 'vision',
    embeddings: 'embeddings',
    structured_output: 'structuredOutput',
    tool_calling: 'toolCalling',
  }
  return capabilities[mapping[capability]]
}

export function requireCapabilities(provider: ModelProvider, required: ModelCapability[]): void {
  for (const capability of required) {
    if (!hasCapability(provider.summary.capabilities, capability)) {
      throw new MissingCapabilityError(provider.summary.id, capability)
    }
  }
}

export function requireRequestCapabilities(provider: ModelProvider, request: ModelRequest): void {
  const required: ModelCapability[] = ['text']
  if (request.images?.length) required.push('vision')
  if (request.requireJson || request.jsonSchema) required.push('structured_output')
  requireCapabilities(provider, required)
}
