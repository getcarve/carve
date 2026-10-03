import type {
  ComputerActionRequest,
  ComputerActionResponse,
  ComputerUseSessionHandle,
  ComputerUseTurn,
  ContinueComputerUseSessionRequest,
  EmbeddingResponse,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  StartComputerUseSessionRequest,
} from './types.js'
import { requireCapabilities, requireRequestCapabilities } from './types.js'
import { withTransportRetry } from './transport-retry.js'
import {
  bedrockComputerToolDefinition,
  claudeBatchToolResults,
  claudeComputerTurnContent,
  claudeImageBlock,
  defaultBedrockDisplay,
  normalizeClaudeUsage,
  parseBedrockComputerToolConfig,
  type BedrockComputerToolConfig,
  type ClaudeMessagesResponse,
} from './aws-bedrock-computer.js'
import { id as newId } from '../util.js'

interface BedrockConverseResponse {
  output?: { message?: { content?: Array<{ text?: string }> } }
  usage?: { inputTokens?: number; outputTokens?: number }
  message?: string
  Message?: string
}

const DEFAULT_REGION = 'us-west-2'
const DEFAULT_MODEL = 'us.anthropic.claude-sonnet-4-6'
const BEDROCK_REQUEST_TIMEOUT_MS = 180_000
const BEDROCK_ANTHROPIC_VERSION = 'bedrock-2023-05-31'
/** Adapter-held computer-use conversations. Bedrock has no server-side
 * response chaining, so the transcript that produced a pending call lives
 * here until the controller continues or abandons it. */
const MAX_HELD_COMPUTER_SESSIONS = 8

interface HeldComputerConversation {
  model: string
  messages: Array<Record<string, unknown>>
  pendingToolUseIds: string[]
  turnIndex: number
}

export type BedrockThinkingMode = 'off' | 'adaptive'

export function parseBedrockThinkingMode(value: string | undefined): BedrockThinkingMode {
  const normalized = value?.trim().toLowerCase() ?? ''
  if (normalized === '' || normalized === 'off' || normalized === '0' || normalized === 'false') return 'off'
  if (normalized === 'adaptive' || normalized === '1' || normalized === 'true' || normalized === 'on') return 'adaptive'
  throw new Error('STEWARD_BEDROCK_THINKING must be "off" or "adaptive"')
}

export type BedrockEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Claude 5 models run adaptive thinking on Bedrock even when the request
 * omits `thinking`; the effort level is what bounds it. Unset leaves the
 * model's own default in force. */
export function parseBedrockEffort(value: string | undefined): BedrockEffort | null {
  const normalized = value?.trim().toLowerCase() ?? ''
  if (normalized === '') return null
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'xhigh' || normalized === 'max') return normalized
  throw new Error('STEWARD_BEDROCK_EFFORT must be one of low, medium, high, xhigh or max')
}

/** Actions in the Bedrock computer-use vocabulary that Carve cannot execute.
 * Claude is told so up front rather than discovering it through a failed turn. */
const bedrockComputerEnvironmentNote = 'Environment note: the zoom action is unavailable here; when you need to inspect a region, request a screenshot instead (zoom is answered with the full current screenshot). hold_key, left_mouse_down, left_mouse_up and cursor_position are unavailable.'

/** Bedrock rejects the structured-output grammar for some Claude models. When
 * a request fails that way, the same schema is stated in the prompt and the
 * first complete JSON object in the reply is returned as the text. */
function structuredOutputRejected(status: number, message: string): boolean {
  return status === 400 && /structured|outputConfig|textFormat|json_schema|output format|response format/iu.test(message)
}

export function firstJsonObject(text: string): string {
  const start = text.indexOf('{')
  if (start < 0) return text
  let depth = 0
  let inString = false
  for (let index = start; index < text.length; index++) {
    const character = text[index]
    if (inString) {
      if (character === '\\') index++
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth++
    else if (character === '}' && --depth === 0) return text.slice(start, index + 1)
  }
  return text
}

function validateModelId(model: string): string {
  const trimmed = model.trim()
  if (!trimmed || trimmed.length > 200 || !/^[A-Za-z0-9._:-]+$/u.test(trimmed)) throw new Error('The Bedrock model id is invalid')
  return trimmed
}

// Bedrock structured outputs implement a deliberately small JSON Schema
// Draft 2020-12 subset. Carve keeps richer bounds in its provider-neutral
// schemas for local validation, so remove only validation annotations that
// Bedrock cannot compile while preserving the response's object/array shape.
// Unsupported structural operators fail closed instead of silently widening
// the response contract. See: https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html
const BEDROCK_UNSUPPORTED_ASSERTION_KEYWORDS = new Set([
  'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'maxItems', 'uniqueItems', 'minContains', 'maxContains',
  'minProperties', 'maxProperties',
  'contentEncoding', 'contentMediaType', 'contentSchema',
])
const BEDROCK_UNSUPPORTED_STRUCTURAL_KEYWORDS = new Set([
  'oneOf', 'not', 'if', 'then', 'else',
  'contains', 'prefixItems', 'patternProperties', 'propertyNames',
  'dependentRequired', 'dependentSchemas', 'unevaluatedProperties', 'unevaluatedItems',
])
const BEDROCK_SUPPORTED_FORMATS = new Set([
  'date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid',
])
const BEDROCK_PASSTHROUGH_SCHEMA_KEYWORDS = new Set([
  'type', 'enum', 'const', 'required', 'title', 'description',
])

function schemaRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Amazon Bedrock JSON Schema node at ${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function normalizeBedrockSchemaMap(value: unknown, path: string): Record<string, unknown> {
  const source = schemaRecord(value, path)
  return Object.fromEntries(Object.entries(source).map(([name, child]) => [
    name,
    normalizeBedrockJsonSchemaNode(schemaRecord(child, `${path}.${name}`), `${path}.${name}`),
  ]))
}

function valueMatchesJsonSchemaType(value: unknown, type: string): boolean {
  switch (type) {
    case 'null': return value === null
    case 'string': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    default: return false
  }
}

/** Bedrock accepts nullable `type` arrays and primitive enums separately, but
 * rejects their combination. Express the same contract as typed anyOf arms. */
function normalizeBedrockTypedEnum(schema: Record<string, unknown>, path: string): Record<string, unknown> {
  if (!Array.isArray(schema.enum)) return schema
  if (schema.enum.some((value) => value !== null && !['string', 'number', 'boolean'].includes(typeof value))) {
    throw new Error(`Amazon Bedrock structured outputs support enum values only for strings, numbers, booleans, or null at ${path}`)
  }
  if (!Array.isArray(schema.type)) return schema
  if (schema.anyOf !== undefined) {
    throw new Error(`Amazon Bedrock cannot combine a union type enum with an existing anyOf at ${path}`)
  }
  const types = schema.type
  if (!types.every((type) => typeof type === 'string')) {
    throw new Error(`Amazon Bedrock JSON Schema type union at ${path} must contain only type names`)
  }
  const remaining = [...schema.enum]
  const anyOf = (types as string[]).flatMap((type) => {
    const matching = remaining.filter((value) => valueMatchesJsonSchemaType(value, type))
    for (const value of matching) remaining.splice(remaining.indexOf(value), 1)
    return matching.length > 0 ? [{ type, enum: matching }] : []
  })
  if (remaining.length > 0 || anyOf.length === 0) {
    throw new Error(`Amazon Bedrock JSON Schema enum at ${path} contains values outside its declared type union`)
  }
  const normalized: Record<string, unknown> = { ...schema, anyOf }
  delete normalized['type']
  delete normalized['enum']
  return normalized
}

function normalizeBedrockJsonSchemaNode(source: Record<string, unknown>, path: string): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const [keyword, value] of Object.entries(source)) {
    if (BEDROCK_UNSUPPORTED_ASSERTION_KEYWORDS.has(keyword)) continue
    if (BEDROCK_UNSUPPORTED_STRUCTURAL_KEYWORDS.has(keyword)) {
      throw new Error(`Amazon Bedrock structured outputs do not support JSON Schema keyword "${keyword}" at ${path}`)
    }
    if (BEDROCK_PASSTHROUGH_SCHEMA_KEYWORDS.has(keyword)) {
      normalized[keyword] = structuredClone(value)
      continue
    }
    switch (keyword) {
      case 'properties':
      case '$defs':
      case 'definitions':
        normalized[keyword] = normalizeBedrockSchemaMap(value, `${path}.${keyword}`)
        break
      case 'items':
        normalized[keyword] = normalizeBedrockJsonSchemaNode(schemaRecord(value, `${path}.items`), `${path}.items`)
        break
      case 'anyOf':
      case 'allOf': {
        if (!Array.isArray(value)) throw new Error(`Amazon Bedrock JSON Schema ${keyword} at ${path} must be an array`)
        normalized[keyword] = value.map((child, index) => normalizeBedrockJsonSchemaNode(
          schemaRecord(child, `${path}.${keyword}[${index}]`),
          `${path}.${keyword}[${index}]`,
        ))
        break
      }
      case '$ref':
        if (typeof value !== 'string' || !value.startsWith('#')) {
          throw new Error(`Amazon Bedrock structured outputs support only internal JSON Schema references at ${path}`)
        }
        normalized[keyword] = value
        break
      case 'additionalProperties':
        if (value === false) normalized[keyword] = false
        else if (value !== true) {
          throw new Error(`Amazon Bedrock structured outputs support additionalProperties only when set to false at ${path}`)
        }
        break
      case 'minItems':
        if (value === 0 || value === 1) normalized[keyword] = value
        break
      case 'format':
        if (typeof value === 'string' && BEDROCK_SUPPORTED_FORMATS.has(value)) normalized[keyword] = value
        break
      default:
        throw new Error(`Amazon Bedrock structured outputs do not support JSON Schema keyword "${keyword}" at ${path}`)
    }
  }
  return normalizeBedrockTypedEnum(normalized, path)
}

function normalizeBedrockJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return normalizeBedrockJsonSchemaNode(schema, '$')
}

function validateComputerFrame(width: number, height: number): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 32_768 || height > 32_768) {
    throw new Error('Computer-action frame dimensions must be integers between 1 and 32768 pixels')
  }
  return { width, height }
}

function boundedString(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > maxLength) {
    throw new Error(`${label} must be ${allowEmpty ? 'a' : 'a non-empty'} string no longer than ${maxLength} characters`)
  }
  return value
}

function validateRegion(region: string): string {
  const normalized = region.trim()
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u.test(normalized)) {
    throw new Error('STEWARD_BEDROCK_REGION must be an AWS Region such as us-west-2')
  }
  return normalized
}

function imageBlock(dataUrl: string): { image: { format: 'png' | 'jpeg' | 'gif' | 'webp'; source: { bytes: string } } } {
  const match = /^data:image\/(png|jpe?g|gif|webp);base64,([a-z0-9+/=\s]+)$/iu.exec(dataUrl)
  if (!match?.[1] || !match[2]) throw new Error('Amazon Bedrock image inputs must be base64 PNG, JPEG, GIF, or WebP data URLs')
  const format = match[1].toLowerCase().replace('jpg', 'jpeg') as 'png' | 'jpeg' | 'gif' | 'webp'
  return { image: { format, source: { bytes: match[2].replace(/\s+/gu, '') } } }
}

/**
 * Amazon Bedrock Runtime adapter for Claude models that support vision and
 * Bedrock structured outputs. Authentication is deliberately separate from
 * OPENAI_API_KEY so selecting Bedrock can never spend the direct OpenAI key.
 */
export class AWSBedrockProvider implements ModelProvider {
  readonly supportsGoalPlanning = true
  /** Claude receives the screenshot in the same request that asks for an
   * action, so one Assured proposal costs one Bedrock request. */
  readonly computerActionRequestCount = 1
  private model: string
  private readonly region: string
  private readonly baseUrl: string
  private readonly thinking: BedrockThinkingMode
  private readonly effort: BedrockEffort | null
  private readonly computerTool: BedrockComputerToolConfig
  private readonly heldSessions = new Map<string, HeldComputerConversation>()

  constructor(
    private readonly apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK ?? '',
    model = process.env.STEWARD_BEDROCK_MODEL ?? DEFAULT_MODEL,
    region = process.env.STEWARD_BEDROCK_REGION ?? DEFAULT_REGION,
    options: { thinking?: BedrockThinkingMode; effort?: BedrockEffort | null; computerTool?: BedrockComputerToolConfig } = {},
  ) {
    this.model = validateModelId(model)
    this.region = validateRegion(region)
    // The hostname is derived from a validated Region instead of accepting an
    // arbitrary URL, preventing a configuration typo from exfiltrating the key.
    this.baseUrl = `https://bedrock-runtime.${this.region}.amazonaws.com`
    this.thinking = options.thinking ?? parseBedrockThinkingMode(process.env.STEWARD_BEDROCK_THINKING)
    this.effort = options.effort === undefined ? parseBedrockEffort(process.env.STEWARD_BEDROCK_EFFORT) : options.effort
    this.computerTool = options.computerTool ?? parseBedrockComputerToolConfig(process.env)
  }

  /** Model request fields that are not part of the Converse schema. */
  private additionalModelRequestFields(): Record<string, unknown> {
    return {
      ...(this.thinking === 'adaptive' ? { thinking: { type: 'adaptive' } } : {}),
      ...(this.effort ? { output_config: { effort: this.effort } } : {}),
    }
  }

  get summary() {
    return {
      id: 'aws-bedrock',
      name: 'AWS Bedrock (Claude)',
      kind: 'hosted' as const,
      model: this.model,
      embeddingModel: null,
      baseUrl: this.baseUrl,
      configured: this.apiKey.length > 0,
      capabilities: {
        text: true,
        vision: true,
        embeddings: false,
        structuredOutput: true,
        toolCalling: true,
      },
      privacyNote: 'Selected inputs are sent to Amazon Bedrock for Anthropic Claude inference. The Bedrock credential is isolated from direct OpenAI.',
    }
  }

  setModel(model: string): void {
    this.model = validateModelId(model)
  }

  /** Bedrock Runtime does not expose a model-list operation on its data plane. */
  async listModels(): Promise<string[]> {
    return [this.model]
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    requireRequestCapabilities(this, request)
    if (!this.apiKey) {
      throw new Error('AWS Bedrock provider is not configured. Set AWS_BEARER_TOKEN_BEDROCK or select another provider.')
    }
    // Extended thinking is an explicit opt-in (STEWARD_BEDROCK_THINKING). Off,
    // the caller's output ceiling stays authoritative and metered evals stay
    // stable; a caller's reasoning effort is then a no-op rather than a fault
    // so shared controllers that request "medium" still run on Bedrock.
    const model = validateModelId(request.model ?? this.model)
    const schema = request.jsonSchema ?? (request.requireJson
      ? { name: 'steward_json_object', schema: { type: 'object' }, strict: true as const }
      : null)
    const content: Array<Record<string, unknown>> = [{ text: request.prompt }]
    for (const image of request.images ?? []) content.push(imageBlock(image.dataUrl))
    const normalizedSchema = schema ? normalizeBedrockJsonSchema(schema.schema) : null
    const additional = this.additionalModelRequestFields()
    const payload = (grammar: boolean) => ({
      system: [{ text: schema && !grammar
        ? `${request.system}\nRespond with exactly one JSON object and nothing else. It must conform to this JSON Schema (${schema.name}): ${JSON.stringify(normalizedSchema)}`
        : request.system }],
      messages: [{ role: 'user', content }],
      inferenceConfig: { maxTokens: request.maxOutputTokens ?? 4_096 },
      ...(Object.keys(additional).length ? { additionalModelRequestFields: additional } : {}),
      ...(schema && grammar
        ? {
            outputConfig: {
              textFormat: {
                type: 'json_schema',
                structure: {
                  jsonSchema: {
                    name: schema.name,
                    schema: JSON.stringify(normalizedSchema),
                  },
                },
              },
            },
          }
        : {}),
    })
    const endpoint = `${this.baseUrl}/model/${encodeURIComponent(model)}/converse`
    const converse = async (grammar: boolean): Promise<{ response: Response; body: BedrockConverseResponse }> => {
      const response = (await withTransportRetry(() => fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload(grammar)),
        signal: request.signal
          ? AbortSignal.any([request.signal, AbortSignal.timeout(BEDROCK_REQUEST_TIMEOUT_MS)])
          : AbortSignal.timeout(BEDROCK_REQUEST_TIMEOUT_MS),
      }), { phase: 'text', callerSignal: request.signal })).value
      return { response, body: await response.json() as BedrockConverseResponse }
    }
    let grammar = Boolean(schema)
    let { response, body } = await converse(grammar)
    if (!response.ok && grammar && structuredOutputRejected(response.status, body.message ?? body.Message ?? '')) {
      grammar = false
      ;({ response, body } = await converse(false))
    }
    if (!response.ok) throw new Error(`AWS Bedrock request failed (${response.status}): ${body.message ?? body.Message ?? 'unknown error'}`)
    const raw = body.output?.message?.content?.map((block) => block.text ?? '').join('') ?? ''
    const text = schema && !grammar ? firstJsonObject(raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gu, '')) : raw
    return {
      text,
      model,
      providerId: this.summary.id,
      usage: { inputTokens: body.usage?.inputTokens ?? null, outputTokens: body.usage?.outputTokens ?? null },
      responseId: null,
    }
  }

  /**
   * One Assured-mode proposal: the authorized frame travels in the same
   * request that asks Claude for an action, so no pre-screenshot turn exists.
   * Returned actions are advisory until Carve's compiler accepts them.
   */
  async proposeComputerActions(request: ComputerActionRequest): Promise<ComputerActionResponse> {
    requireCapabilities(this, ['text', 'vision', 'tool_calling'])
    this.requireCredential('requesting computer-action proposals')
    const model = validateModelId(request.model ?? this.model)
    const frame = validateComputerFrame(request.screenshot.width, request.screenshot.height)
    const evidenceId = boundedString(request.screenshot.evidenceId, 'computer-action evidence id', 300)
    const screenshot = claudeImageBlock(request.screenshot.dataUrl)
    request.onScreenshotTransmitted?.()
    const body = await this.invokeClaude({
      phase: 'action proposal',
      model,
      system: boundedString(request.system, 'computer-action system instructions', 100_000, true),
      messages: [{ role: 'user', content: [{ type: 'text', text: boundedString(request.prompt, 'computer-action prompt', 100_000) }, screenshot] }],
      display: frame,
      ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    const turn = claudeComputerTurnContent(body.content, frame)
    return {
      callId: turn.toolUseIds.length > 0 ? turn.toolUseIds.join(',') : null,
      evidenceId,
      frame,
      providerRequestCount: this.computerActionRequestCount,
      actions: turn.actions,
      terminalText: turn.terminalText,
      pendingSafetyChecks: [],
      model,
      providerId: this.summary.id,
      usage: normalizeClaudeUsage(body.usage),
      responseId: body.id ?? null,
    }
  }

  /**
   * Universal-mode loop. Claude has no provider-side continuation, so the
   * adapter keeps the transcript that produced each pending call and replays
   * it with the controller's observation. The first turn must request a
   * screenshot: no input is proposed against pixels Claude has not seen.
   */
  async startComputerUseSession(request: StartComputerUseSessionRequest): Promise<ComputerUseTurn> {
    requireCapabilities(this, ['text', 'vision', 'tool_calling'])
    this.requireCredential('starting computer use')
    const model = validateModelId(request.model ?? this.model)
    const system = boundedString(request.system, 'computer-use system instructions', 100_000, true)
    const prompt = boundedString(request.prompt, 'computer-use goal', 100_000)
    const messages: Array<Record<string, unknown>> = [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
    const body = await this.invokeClaude({
      phase: 'session start',
      model,
      system,
      messages,
      display: defaultBedrockDisplay,
      ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    const turn = claudeComputerTurnContent(body.content, defaultBedrockDisplay)
    if (turn.toolUseIds.length > 0 && (turn.actions.length !== 1 || turn.actions[0]?.kind !== 'screenshot')) {
      throw new Error('Claude computer-use first turn must contain exactly one screenshot request; no pre-screenshot action is accepted')
    }
    messages.push({ role: 'assistant', content: body.content ?? [] })
    return this.computerUseTurn(body, turn, { model, messages, pendingToolUseIds: turn.toolUseIds, turnIndex: 0 })
  }

  async continueComputerUseSession(request: ContinueComputerUseSessionRequest): Promise<ComputerUseTurn> {
    requireCapabilities(this, ['text', 'vision', 'tool_calling'])
    this.requireCredential('continuing computer use')
    const session = request.session
    if (session.providerId !== this.summary.id) throw new Error('The computer-use session belongs to a different provider')
    if (session.continuationMode !== 'provider_state') throw new Error('The computer-use continuation mode is unsupported')
    const held = this.heldSessions.get(session.responseId)
    if (!held) throw new Error('The computer-use session is no longer held by the Bedrock adapter; start a fresh session')
    if (!session.pendingCallId || held.pendingToolUseIds.length === 0) throw new Error('The computer-use session has no pending call to receive a screenshot')
    if (session.pendingCallId !== held.pendingToolUseIds.join(',')) throw new Error('The computer-use continuation does not match the pending call')
    const frame = validateComputerFrame(request.screenshot.width, request.screenshot.height)
    boundedString(request.screenshot.evidenceId, 'computer-use evidence id', 300)
    const instructions = boundedString(request.instructions, 'computer-use continuation instructions', 100_000, true)
    const results = claudeBatchToolResults(held.pendingToolUseIds, request.screenshot.dataUrl)
    // A held transcript is consumed exactly once; a retry after a transport
    // failure must not append the same observation twice.
    this.heldSessions.delete(session.responseId)
    // InvokeModel speaks the Anthropic Messages shape, so these are typed
    // Messages blocks, not Converse blocks.
    const extras = [
      ...(request.runtimeNote ? [{ type: 'text', text: request.runtimeNote }] : []),
      ...(request.attachments ?? []).slice(0, 2).flatMap((attachment) => [{ type: 'text', text: `Attached image: ${attachment.label} (${attachment.width}×${attachment.height}). For reading only; not a coordinate space.` }, claudeImageBlock(attachment.dataUrl)]),
    ]
    const messages = [...held.messages, { role: 'user', content: extras.length ? [...results, ...extras] : results }]
    request.onScreenshotTransmitted?.()
    const body = await this.invokeClaude({
      phase: 'session continuation',
      model: held.model,
      system: instructions,
      messages,
      display: frame,
      ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    const turn = claudeComputerTurnContent(body.content, frame)
    messages.push({ role: 'assistant', content: body.content ?? [] })
    return this.computerUseTurn(body, turn, { model: held.model, messages, pendingToolUseIds: turn.toolUseIds, turnIndex: held.turnIndex + 1 })
  }

  private computerUseTurn(body: ClaudeMessagesResponse, turn: ReturnType<typeof claudeComputerTurnContent>, held: HeldComputerConversation): ComputerUseTurn {
    const providerId = this.summary.id
    // Bedrock reports the bare Anthropic model name (e.g. claude-sonnet-4-6),
    // which is not a valid Bedrock model id. The session keeps the id that
    // was requested so every continuation targets the same inference profile.
    const model = held.model
    const responseId = typeof body.id === 'string' && body.id.length > 0 && body.id.length <= 300 ? body.id : newId('bedrock_response')
    const usage = normalizeClaudeUsage(body.usage)
    if (turn.toolUseIds.length === 0) {
      const session: ComputerUseSessionHandle = { providerId, model, responseId, pendingCallId: null, turnIndex: held.turnIndex, continuationMode: 'provider_state' }
      return { kind: 'terminal', session, providerId, model, usage, callId: null, actions: [], pendingSafetyChecks: [], terminalText: turn.terminalText }
    }
    const callId = turn.toolUseIds.join(',')
    this.holdSession(responseId, held)
    const session: ComputerUseSessionHandle = { providerId, model, responseId, pendingCallId: callId, turnIndex: held.turnIndex, continuationMode: 'provider_state' }
    return { kind: 'actions', session, providerId, model, usage, callId, actions: turn.actions, pendingSafetyChecks: [], terminalText: null }
  }

  private holdSession(responseId: string, conversation: HeldComputerConversation): void {
    this.heldSessions.set(responseId, conversation)
    while (this.heldSessions.size > MAX_HELD_COMPUTER_SESSIONS) {
      const oldest = this.heldSessions.keys().next().value
      if (oldest === undefined) break
      this.heldSessions.delete(oldest)
    }
  }

  private requireCredential(activity: string): void {
    if (!this.apiKey) throw new Error(`AWS Bedrock provider is not configured. Set AWS_BEARER_TOKEN_BEDROCK before ${activity}.`)
  }

  /** Anthropic Messages request through Bedrock InvokeModel, the surface
   * Bedrock documents for Claude computer use. */
  private async invokeClaude(input: {
    phase: string
    model: string
    system: string
    messages: Array<Record<string, unknown>>
    display: { width: number; height: number }
    maxOutputTokens?: number
    signal?: AbortSignal
  }): Promise<ClaudeMessagesResponse> {
    const endpoint = `${this.baseUrl}/model/${encodeURIComponent(input.model)}/invoke`
    const response = (await withTransportRetry(() => fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        anthropic_version: BEDROCK_ANTHROPIC_VERSION,
        anthropic_beta: [this.computerTool.beta],
        max_tokens: input.maxOutputTokens ?? 4_096,
        system: `${input.system}\n${bedrockComputerEnvironmentNote}`,
        messages: input.messages,
        tools: [bedrockComputerToolDefinition(this.computerTool, input.display)],
        ...this.additionalModelRequestFields(),
      }),
      signal: input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(BEDROCK_REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(BEDROCK_REQUEST_TIMEOUT_MS),
    }), { phase: 'computer-use', callerSignal: input.signal })).value
    const body = await response.json() as ClaudeMessagesResponse
    if (!response.ok) {
      throw new Error(`AWS Bedrock computer-use ${input.phase} failed (${response.status}): ${body.error?.message ?? body.message ?? body.Message ?? 'unknown error'}`)
    }
    if (body.stop_reason === 'max_tokens') throw new Error(`AWS Bedrock computer-use ${input.phase} was cut off at the output ceiling (stop_reason: max_tokens)`)
    if (body.stop_reason === 'refusal') throw new Error(`AWS Bedrock computer-use ${input.phase} was declined by the model (stop_reason: refusal)`)
    return body
  }

  async embed(_texts: string[]): Promise<EmbeddingResponse> {
    requireCapabilities(this, ['embeddings'])
    throw new Error('AWS Bedrock Claude embeddings are unavailable')
  }

  async health(): Promise<{ ok: boolean; message: string }> {
    return this.apiKey
      ? { ok: true, message: `Configured for ${this.region}; no paid request was made` }
      : { ok: false, message: 'AWS_BEARER_TOKEN_BEDROCK is not set' }
  }
}
