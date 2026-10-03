import type {
  ComputerUseSessionHandle,
  ComputerUseTurn,
  ContinueComputerUseSessionRequest,
  EmbeddingResponse,
  ModelMetering,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  StartComputerUseSessionRequest,
} from './types.js'
import { requireCapabilities, requireRequestCapabilities } from './types.js'
import { withTransportRetry } from './transport-retry.js'
import { claudeBatchToolResults, claudeComputerTurnContent, defaultBedrockDisplay, normalizeClaudeUsage, type ClaudeMessagesResponse } from './aws-bedrock-computer.js'
import { firstJsonObject } from './aws-bedrock.js'
import { readComputerOutcome } from '../computer-use/outcome.js'
import { id as newId } from '../util.js'

/**
 * Anthropic Messages API adapter. Text and vision with structured output, no
 * embeddings, and the first-party computer-use toolset for Universal mode:
 * Claude's member tool calls are translated by the same module that serves
 * Bedrock, so one grammar governs both routes. Like the OpenAI adapter it can
 * be pointed at a relay that speaks the same API.
 */

export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Claude 5 models think adaptively by default; effort is what bounds it.
 * Unset leaves the model's own default in force. */
export function parseAnthropicEffort(value: string | undefined): AnthropicEffort | null {
  const normalized = value?.trim().toLowerCase() ?? ''
  if (normalized === '') return null
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'xhigh' || normalized === 'max') return normalized
  throw new Error('STEWARD_ANTHROPIC_EFFORT must be one of low, medium, high, xhigh or max')
}

export interface HostedAnthropicProviderOptions {
  apiKey?: string
  model?: string
  baseUrl?: string
  identity?: { id: string; name: string; privacyNote: string }
  credentials?: () => string | null
  extraHeaders?: (metering: ModelMetering | undefined) => Record<string, string>
  /** Effort for the computer-use loop; null keeps the model default. */
  effort?: AnthropicEffort | null
  /** Required by keys that are not scoped to one workspace; sent as `anthropic-workspace-id`. */
  workspaceId?: string | null
}

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1'
const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MODEL = 'claude-sonnet-5'
/** Models the adapter offers; the relay enforces its own allowlist server-side. */
const KNOWN_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']
const REQUEST_TIMEOUT_MS = 120_000
/** The production computer-use toolset: no beta header, member tools named
 * individually, zoom disabled because Carve observes whole windows only. */
export const anthropicComputerToolset = { type: 'computer_toolset_20260801', configs: { zoom: { enabled: false } } } as const
const computerEnvironmentNote = 'Environment note: you cannot see the window until a screenshot has been returned in this conversation, so when none has been, your first and only call must be screenshot; do not assume the page state. hold_key, left_mouse_down, left_mouse_up and cursor_position are unavailable here; use the other actions.'
/** Adapter-held computer-use transcripts; the Messages API keeps no server-side state. */
const MAX_HELD_COMPUTER_SESSIONS = 8

interface HeldComputerConversation {
  model: string
  messages: Array<Record<string, unknown>>
  pendingToolUseIds: string[]
  turnIndex: number
  /** The pending calls were proposed before any screenshot existed; none ran. */
  blind?: boolean
}

const blindFirstTurnResult = 'Not executed: no screenshot had been returned yet, so this call was withheld. The current screenshot is attached to the last call; act on it.'

/** A refusal ends the loop as a blocked report in the model's own name: the
 * task was not completed and the reason is stated. It never reads as success. */
function refusalReport(body: ClaudeMessagesResponse): string {
  const category = body.stop_details?.category ? ` (${body.stop_details.category})` : ''
  return JSON.stringify({ status: 'blocked', message: `Claude declined to continue this task${category}. Nothing further was done.`, remaining: ['The task was not completed because the model declined to continue.'] })
}

/** Every tool_use in a raw content array, for answering calls Carve could not
 * interpret. A result may carry `toolset_name` only when its call did. */
function rawToolUses(content: unknown): Array<{ id: string; toolset: boolean }> {
  return Array.isArray(content) ? content.flatMap((block) => {
    const b = block && typeof block === 'object' ? block as Record<string, unknown> : null
    return b && b['type'] === 'tool_use' && typeof b['id'] === 'string' ? [{ id: b['id'], toolset: b['toolset_name'] === 'computer' }] : []
  }) : []
}

/** Keywords Anthropic's structured outputs reject. Carve validates the parsed
 * result against its full schema locally, so dropping them costs nothing. */
const unsupportedSchemaKeywords = new Set(['maxItems', 'uniqueItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minProperties', 'maxProperties', 'pattern'])

export function anthropicJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(anthropicJsonSchema)
  if (!schema || typeof schema !== 'object') return schema
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (unsupportedSchemaKeywords.has(key)) continue
    if (key === 'minItems') { if (value === 0 || value === 1) out[key] = value; continue }
    if (key === 'oneOf') { out['anyOf'] = anthropicJsonSchema(value); continue }
    if (key === 'properties' || key === '$defs' || key === 'definitions') {
      out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, child]) => [name, anthropicJsonSchema(child)]))
      continue
    }
    out[key] = key === 'items' || key === 'anyOf' || key === 'allOf' || key === 'not' ? anthropicJsonSchema(value) : value
  }
  return out
}

function structuredOutputRejected(status: number, message: string): boolean {
  return status === 400 && /output_config|json_schema|schema|structured/iu.test(message)
}

/** Translation failures name the calls involved (names only, never inputs) so a vocabulary gap is diagnosable from the audit. */
function translateTurn(content: unknown, frame: { width: number; height: number }): ReturnType<typeof claudeComputerTurnContent> {
  try {
    return claudeComputerTurnContent(content, frame)
  } catch (error) {
    const names = Array.isArray(content) ? content.filter((block) => block && typeof block === 'object' && (block as Record<string, unknown>)['type'] === 'tool_use')
      .map((block) => { const b = block as Record<string, unknown>; return `${String(b['name'])}${b['toolset_name'] ? `@${String(b['toolset_name'])}` : ''}` }) : []
    throw new Error(`${error instanceof Error ? error.message : String(error)} (tool calls: ${names.join(', ') || 'none'})`)
  }
}

/** Keeps only the system breakpoint plus one on the latest observation; the API allows four in total. */
function stripCacheControl(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return messages.map((message) => Array.isArray(message['content'])
    ? { ...message, content: (message['content'] as Array<Record<string, unknown>>).map((block) => { const copy = { ...block }; delete copy['cache_control']; return copy }) }
    : message)
}

interface MessagesResponse {
  id?: string
  model?: string
  stop_reason?: string
  content?: Array<{ type?: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
  error?: { type?: string; message?: string }
}

export class HostedAnthropicProvider implements ModelProvider {
  readonly supportsGoalPlanning = true
  /** The loop may attach the already-captured frame to the session start, in
   * which case Claude has seen pixels and its first turn may act. */
  readonly supportsInitialComputerScreenshot = true
  /** One bounded follow-up per turn: the report reminder or a call correction. */
  readonly maxRequestsPerComputerTurn = 2
  private model: string
  private readonly baseUrl: string
  private readonly identity: { id: string; name: string; privacyNote: string }
  private readonly credentials: () => string | null
  private readonly extraHeaders: (metering: ModelMetering | undefined) => Record<string, string>
  private readonly effort: AnthropicEffort | null
  private readonly workspaceId: string | null
  private readonly heldSessions = new Map<string, HeldComputerConversation>()

  constructor(options: HostedAnthropicProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? ''
    this.model = options.model ?? process.env.STEWARD_ANTHROPIC_MODEL ?? DEFAULT_MODEL
    this.baseUrl = (options.baseUrl ?? ANTHROPIC_BASE_URL).replace(/\/+$/u, '')
    this.identity = options.identity ?? {
      id: 'anthropic-hosted',
      name: 'Anthropic hosted',
      privacyNote: 'Selected inputs are sent to Anthropic. Carve never sends captures merely because this adapter is configured.',
    }
    this.credentials = options.credentials ?? (() => (apiKey ? apiKey : null))
    this.extraHeaders = options.extraHeaders ?? (() => ({}))
    this.effort = options.effort === undefined ? parseAnthropicEffort(process.env.STEWARD_ANTHROPIC_EFFORT) : options.effort
    this.workspaceId = validateWorkspaceId(options.workspaceId === undefined ? process.env.ANTHROPIC_WORKSPACE_ID : options.workspaceId)
  }

  get summary() {
    return {
      id: this.identity.id,
      name: this.identity.name,
      kind: 'hosted' as const,
      model: this.model,
      embeddingModel: null,
      baseUrl: this.baseUrl,
      configured: this.bearer() !== null,
      capabilities: {
        text: true,
        vision: true,
        embeddings: false,
        structuredOutput: true,
        toolCalling: true,
      },
      privacyNote: this.identity.privacyNote,
    }
  }

  setModel(model: string): void {
    this.model = validateModelId(model)
  }

  async listModels(): Promise<string[]> {
    return [...KNOWN_MODELS]
  }

  private bearer(): string | null {
    const token = this.credentials()
    return token && token.length > 0 ? token : null
  }

  private requestHeaders(metering: ModelMetering | undefined): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.bearer() ?? '',
      'anthropic-version': ANTHROPIC_VERSION,
      ...(this.workspaceId ? { 'anthropic-workspace-id': this.workspaceId } : {}),
      ...this.extraHeaders(metering),
    }
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    requireRequestCapabilities(this, request)
    if (!this.bearer()) throw new Error('Anthropic hosted provider is not configured. Set ANTHROPIC_API_KEY or select another provider.')
    const model = validateModelId(request.model ?? this.model)
    const content: Array<Record<string, unknown>> = []
    for (const image of request.images ?? []) {
      const parsed = parseDataUrl(image.dataUrl)
      content.push({ type: 'image', source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data } })
    }
    content.push({ type: 'text', text: request.requireJson && !request.jsonSchema ? `${request.prompt}\n\nRespond with a single JSON object and nothing else.` : request.prompt })
    const schema = request.jsonSchema ? anthropicJsonSchema(request.jsonSchema.schema) : null
    const effort = request.reasoningEffort === undefined || request.reasoningEffort === 'none' || request.reasoningEffort === 'minimal' ? null : request.reasoningEffort
    // `grammar` asks the API to constrain output to the schema. When the API
    // rejects a schema anyway, the same schema is stated in the system prompt
    // and the first complete JSON object in the reply is returned instead.
    const body = (grammar: boolean): Record<string, unknown> => ({
      model,
      max_tokens: request.maxOutputTokens ?? 4_096,
      system: schema && !grammar ? `${request.system}\nRespond with exactly one JSON object and nothing else. It must conform to this JSON Schema (${request.jsonSchema!.name}): ${JSON.stringify(schema)}` : request.system,
      messages: [{ role: 'user', content }],
      ...(schema && grammar ? { output_config: { format: { type: 'json_schema', schema }, ...(effort ? { effort } : {}) } } : effort ? { output_config: { effort } } : {}),
      ...(request.safetyIdentifier === undefined ? {} : { metadata: { user_id: request.safetyIdentifier } }),
    })
    const send = async (grammar: boolean) => {
      const response = (await withTransportRetry(() => fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        redirect: 'error',
        headers: this.requestHeaders(request.metering),
        body: JSON.stringify(body(grammar)),
        signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }), { phase: 'text', callerSignal: request.signal })).value
      return { response, parsed: await response.json() as MessagesResponse }
    }
    let grammar = Boolean(schema)
    let { response, parsed } = await send(grammar)
    if (!response.ok && grammar && structuredOutputRejected(response.status, parsed.error?.message ?? '')) {
      grammar = false
      ;({ response, parsed } = await send(false))
    }
    if (!response.ok) throw new Error(`Anthropic request failed (${response.status}): ${parsed.error?.message ?? 'unknown error'}`)
    // A refusal is a completed, billed response with no usable answer. It is
    // returned as empty text so callers fall back on their own terms and the
    // metered usage is recorded, instead of an unbilled failure.
    const raw = parsed.stop_reason === 'refusal' ? '' : (parsed.content ?? []).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('')
    const text = schema && !grammar && raw ? firstJsonObject(raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gu, '')) : raw
    return {
      text,
      model: parsed.model ?? model,
      providerId: this.summary.id,
      usage: {
        inputTokens: count(parsed.usage?.input_tokens) + count(parsed.usage?.cache_read_input_tokens) + count(parsed.usage?.cache_creation_input_tokens),
        outputTokens: count(parsed.usage?.output_tokens),
        cachedInputTokens: count(parsed.usage?.cache_read_input_tokens),
        totalTokens: count(parsed.usage?.input_tokens) + count(parsed.usage?.cache_read_input_tokens) + count(parsed.usage?.cache_creation_input_tokens) + count(parsed.usage?.output_tokens),
      },
      responseId: parsed.id ?? null,
    }
  }

  /** Opens the stateful computer-use loop. Claude's first turn must ask for
   * a screenshot; input proposed before it has seen pixels is refused, as on
   * the other adapters. */
  async startComputerUseSession(request: StartComputerUseSessionRequest): Promise<ComputerUseTurn> {
    requireCapabilities(this, ['text', 'vision', 'tool_calling'])
    if (!this.bearer()) throw new Error('Anthropic hosted provider is not configured. Set ANTHROPIC_API_KEY before starting computer use.')
    const model = validateModelId(request.model ?? this.model)
    const system = boundedString(request.system, 'computer-use system instructions', 100_000, true)
    const prompt = boundedString(request.prompt, 'computer-use goal', 100_000)
    const initial = request.screenshot ? parseDataUrl(request.screenshot.dataUrl) : null
    const display = request.screenshot ? validateFrame(request.screenshot.width, request.screenshot.height) : defaultBedrockDisplay
    const messages: Array<Record<string, unknown>> = [{ role: 'user', content: [
      { type: 'text', text: prompt },
      ...(initial ? [{ type: 'text', text: 'The current screenshot of the selected window is attached; act on it.' }, { type: 'image', source: { type: 'base64', media_type: initial.mediaType, data: initial.data } }] : []),
    ] }]
    if (initial) request.onScreenshotTransmitted?.()
    const body = await this.invokeComputerUse({ phase: 'session start', model, system, messages, ...optional(request) })
    const turn = body.stop_reason === 'refusal' ? { toolUseIds: [], actions: [], terminalText: refusalReport(body) } : translateTurn(body.content, display)
    // Without an attached frame Claude has seen no pixels, so the only thing
    // the first turn can obtain is a look. Whatever it proposed collapses into
    // one observation: nothing runs, every call is answered on the
    // continuation, and input calls are told they were withheld.
    let blind = false
    if (!initial && turn.toolUseIds.length > 0) {
      blind = turn.actions.some((action) => action.kind !== 'screenshot' && action.kind !== 'wait')
      turn.actions = [{ kind: 'screenshot' }]
    }
    messages.push({ role: 'assistant', content: body.content ?? [] })
    return this.computerUseTurn(body, turn, { model, messages, pendingToolUseIds: turn.toolUseIds, turnIndex: 0, ...(blind ? { blind } : {}) })
  }

  async continueComputerUseSession(request: ContinueComputerUseSessionRequest): Promise<ComputerUseTurn> {
    requireCapabilities(this, ['text', 'vision', 'tool_calling'])
    if (!this.bearer()) throw new Error('Anthropic hosted provider is not configured. Set ANTHROPIC_API_KEY before continuing computer use.')
    const session = request.session
    if (session.providerId !== this.summary.id) throw new Error('The computer-use session belongs to a different provider')
    if (session.continuationMode !== 'provider_state') throw new Error('The computer-use continuation mode is unsupported')
    const held = this.heldSessions.get(session.responseId)
    if (!held) throw new Error('The computer-use session is no longer held by the Anthropic adapter; start a fresh session')
    if (!session.pendingCallId || held.pendingToolUseIds.length === 0) throw new Error('The computer-use session has no pending call to receive a screenshot')
    if (session.pendingCallId !== held.pendingToolUseIds.join(',')) throw new Error('The computer-use continuation does not match the pending call')
    const frame = validateFrame(request.screenshot.width, request.screenshot.height)
    boundedString(request.screenshot.evidenceId, 'computer-use evidence id', 300)
    const instructions = boundedString(request.instructions, 'computer-use continuation instructions', 100_000, true)
    const results = claudeBatchToolResults(held.pendingToolUseIds, request.screenshot.dataUrl, { toolset: true, ...(held.blind ? { executedText: blindFirstTurnResult } : {}) })
    // A held transcript is consumed exactly once; a retry after a transport
    // failure must not append the same observation twice.
    this.heldSessions.delete(session.responseId)
    const extras: Array<Record<string, unknown>> = [
      ...(request.runtimeNote ? [{ type: 'text', text: request.runtimeNote }] : []),
      ...(request.attachments ?? []).slice(0, 2).flatMap((attachment) => {
        const parsed = parseDataUrl(attachment.dataUrl)
        return [{ type: 'text', text: `Attached image: ${attachment.label} (${attachment.width}×${attachment.height}). For reading only; not a coordinate space.` }, { type: 'image', source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data } }]
      }),
    ]
    const content = [...results, ...extras]
    // The moving cache breakpoint: everything up to and including this turn's
    // observation is reused verbatim by the next continuation.
    content[content.length - 1] = { ...content[content.length - 1]!, cache_control: { type: 'ephemeral' } }
    const messages = [...stripCacheControl(held.messages), { role: 'user', content }]
    request.onScreenshotTransmitted?.()
    let body = await this.invokeComputerUse({ phase: 'session continuation', model: held.model, system: instructions, messages, ...optional(request) })
    let turn: ReturnType<typeof claudeComputerTurnContent>
    if (body.stop_reason === 'refusal') {
      turn = { toolUseIds: [], actions: [], terminalText: refusalReport(body) }
      messages.push({ role: 'assistant', content: body.content ?? [] })
    } else {
      try {
        turn = translateTurn(body.content, frame)
        messages.push({ role: 'assistant', content: body.content ?? [] })
      } catch (error) {
        // A call outside the vocabulary is answered as a tool error once, so
        // the model can restate it with the member tools; a second failure
        // ends the turn as before. Nothing from the rejected call runs.
        const uses = rawToolUses(body.content)
        if (uses.length === 0) throw error
        messages.push({ role: 'assistant', content: body.content ?? [] })
        const reason = error instanceof Error ? error.message : String(error)
        messages.push({ role: 'user', content: uses.map(({ id, toolset }) => ({ type: 'tool_result', tool_use_id: id, ...(toolset ? { toolset_name: 'computer' } : {}), is_error: true,
          content: [{ type: 'text', text: `Not executed. This call could not be interpreted: ${reason}. Use the computer toolset member tools (screenshot, left_click, double_click, type, key, scroll, left_click_drag, mouse_move, wait) with their documented inputs.` }] })) })
        const retried = await this.invokeComputerUse({ phase: 'call correction', model: held.model, system: instructions, messages, ...optional(request) })
        turn = retried.stop_reason === 'refusal' ? { toolUseIds: [], actions: [], terminalText: refusalReport(retried) } : translateTurn(retried.content, frame)
        messages.push({ role: 'assistant', content: retried.content ?? [] })
        const usage = sumUsage(body.usage, retried.usage)
        body = { ...retried, ...(usage ? { usage } : {}) }
      }
    }
    // A final answer without the report object is asked for once more in the
    // same transcript. The model still writes its own status; nothing here
    // upgrades prose into a completion claim.
    if (turn.toolUseIds.length === 0 && readComputerOutcome(turn.terminalText).status === 'unclassified') {
      messages.push({ role: 'user', content: [{ type: 'text', text: 'Your last message was not the required report. Return ONLY the JSON object with status ("completed", "partial", or "blocked"), message (your full user-facing answer, repeated in full), and remaining (unmet requirements; empty for completed). No prose or code fences around it.' }] })
      const reminded = await this.invokeComputerUse({ phase: 'report request', model: held.model, system: instructions, messages, ...optional(request) })
      const remindedTurn = translateTurn(reminded.content, frame)
      messages.push({ role: 'assistant', content: reminded.content ?? [] })
      if (remindedTurn.toolUseIds.length === 0) turn = remindedTurn
      const usage = sumUsage(body.usage, reminded.usage)
      body = { ...reminded, ...(usage ? { usage } : {}) }
    }
    return this.computerUseTurn(body, turn, { model: held.model, messages, pendingToolUseIds: turn.toolUseIds, turnIndex: held.turnIndex + 1 })
  }

  private computerUseTurn(body: ClaudeMessagesResponse, turn: ReturnType<typeof claudeComputerTurnContent>, held: HeldComputerConversation): ComputerUseTurn {
    const providerId = this.summary.id
    const model = held.model
    const responseId = typeof body.id === 'string' && body.id.length > 0 && body.id.length <= 300 ? body.id : newId('anthropic_response')
    const usage = normalizeClaudeUsage(body.usage)
    if (turn.toolUseIds.length === 0) {
      const session: ComputerUseSessionHandle = { providerId, model, responseId, pendingCallId: null, turnIndex: held.turnIndex, continuationMode: 'provider_state' }
      return { kind: 'terminal', session, providerId, model, usage, callId: null, actions: [], pendingSafetyChecks: [], terminalText: turn.terminalText }
    }
    const callId = turn.toolUseIds.join(',')
    this.heldSessions.set(responseId, held)
    while (this.heldSessions.size > MAX_HELD_COMPUTER_SESSIONS) {
      const oldest = this.heldSessions.keys().next().value
      if (oldest === undefined) break
      this.heldSessions.delete(oldest)
    }
    const session: ComputerUseSessionHandle = { providerId, model, responseId, pendingCallId: callId, turnIndex: held.turnIndex, continuationMode: 'provider_state' }
    return { kind: 'actions', session, providerId, model, usage, callId, actions: turn.actions, pendingSafetyChecks: [], terminalText: null }
  }

  /** One Messages request carrying the computer-use toolset. The system
   * prompt is a cached prefix; the transcript's cache breakpoint moves with
   * each observation so continuations reuse everything already sent. */
  private async invokeComputerUse(input: {
    phase: string
    model: string
    system: string
    messages: Array<Record<string, unknown>>
    maxOutputTokens?: number
    reasoningEffort?: ModelRequest['reasoningEffort']
    safetyIdentifier?: string
    metering?: ModelMetering
    signal?: AbortSignal
  }): Promise<ClaudeMessagesResponse> {
    const effort = this.effort ?? requestEffort(input.reasoningEffort)
    const response = (await withTransportRetry(() => fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      redirect: 'error',
      headers: this.requestHeaders(input.metering),
      body: JSON.stringify({
        model: input.model,
        max_tokens: input.maxOutputTokens ?? 8_192,
        // The note leads so Carve's own closing instruction (the report format) stays last.
        system: [{ type: 'text', text: `${computerEnvironmentNote}\n${input.system}`, cache_control: { type: 'ephemeral' } }],
        messages: input.messages,
        tools: [anthropicComputerToolset],
        ...(effort ? { output_config: { effort } } : {}),
        ...(input.safetyIdentifier === undefined ? {} : { metadata: { user_id: input.safetyIdentifier } }),
      }),
      signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }), { phase: 'computer-use', callerSignal: input.signal })).value
    const body = await response.json() as ClaudeMessagesResponse
    if (!response.ok) throw new Error(`Anthropic computer-use ${input.phase} failed (${response.status}): ${body.error?.message ?? 'unknown error'}`)
    if (body.stop_reason === 'max_tokens') throw new Error(`Anthropic computer-use ${input.phase} was cut off at the output ceiling (stop_reason: max_tokens)`)
    // A refusal is returned to the caller, which ends the loop with a blocked report; it is billed and must not read as an unmetered failure.
    return body
  }

  async embed(): Promise<EmbeddingResponse> {
    requireCapabilities(this, ['embeddings'])
    throw new Error('Anthropic hosted provider does not offer embeddings')
  }

  async health(): Promise<{ ok: boolean; message: string }> {
    return this.bearer()
      ? { ok: true, message: 'Configured; no paid request was made' }
      : { ok: false, message: this.identity.id === 'anthropic-hosted' ? 'ANTHROPIC_API_KEY is not set' : `${this.identity.name} has no credentials yet` }
  }
}

function validateModelId(model: string): string {
  const trimmed = model.trim()
  if (!trimmed || trimmed.length > 200 || !/^[A-Za-z0-9._:-]+$/u.test(trimmed)) throw new Error('The Anthropic model id is invalid')
  return trimmed
}

function sumUsage(first: ClaudeMessagesResponse['usage'], second: ClaudeMessagesResponse['usage']): ClaudeMessagesResponse['usage'] {
  if (!first || !second) return undefined
  const keys = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'] as const
  const summed: NonNullable<ClaudeMessagesResponse['usage']> = {}
  for (const key of keys) {
    const a = first[key], b = second[key]
    if (a !== undefined || b !== undefined) summed[key] = (a ?? 0) + (b ?? 0)
  }
  return summed
}

function validateWorkspaceId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return null
  if (trimmed.length > 200 || !/^[A-Za-z0-9_-]+$/u.test(trimmed)) throw new Error('ANTHROPIC_WORKSPACE_ID is invalid')
  return trimmed
}

/** Per-request fields the computer-use loop may pass through. */
function optional(request: Pick<StartComputerUseSessionRequest, 'maxOutputTokens' | 'reasoningEffort' | 'safetyIdentifier' | 'metering' | 'signal'>) {
  return {
    ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
    ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
    ...(request.safetyIdentifier === undefined ? {} : { safetyIdentifier: request.safetyIdentifier }),
    ...(request.metering === undefined ? {} : { metering: request.metering }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  }
}

/** A caller's OpenAI-style effort mapped onto Claude's levels; none/minimal become low. */
function requestEffort(effort: ModelRequest['reasoningEffort']): AnthropicEffort | null {
  if (effort === undefined) return null
  if (effort === 'none' || effort === 'minimal') return 'low'
  return effort
}

function validateFrame(width: number, height: number): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 32_768 || height > 32_768) {
    throw new Error('Computer-use frame dimensions must be integers between 1 and 32768 pixels')
  }
  return { width, height }
}

function boundedString(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > maxLength) {
    throw new Error(`${label} must be ${allowEmpty ? 'a' : 'a non-empty'} string no longer than ${maxLength} characters`)
  }
  return value
}

function parseDataUrl(dataUrl: string): { mediaType: string; data: string } {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/u.exec(dataUrl)
  if (!match?.[1] || !match[2]) throw new Error('Images must be base64 data URLs of type png, jpeg, webp, or gif')
  return { mediaType: match[1], data: match[2] }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0
}
