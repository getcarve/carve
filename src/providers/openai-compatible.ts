import { isLoopbackEndpoint } from '../ai-sharing.js'
import type { ModelCapabilities, ModelCapability } from '../types.js'
import type { EmbeddingResponse, ModelProvider, ModelRequest, ModelResponse } from './types.js'
import { requireCapabilities, requireRequestCapabilities } from './types.js'
import { withTransportRetry } from './transport-retry.js'

interface ChatResponse {
  id?: string
  model?: string
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

const capabilityMapping: Record<ModelCapability, keyof ModelCapabilities> = {
  text: 'text',
  vision: 'vision',
  embeddings: 'embeddings',
  structured_output: 'structuredOutput',
  tool_calling: 'toolCalling',
}

function configuredCapabilities(raw: string): ModelCapabilities {
  const selected = new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))
  const result: ModelCapabilities = {
    text: false,
    vision: false,
    embeddings: false,
    structuredOutput: false,
    toolCalling: false,
  }
  for (const capability of selected) {
    if (!Object.hasOwn(capabilityMapping, capability)) {
      throw new Error(`Unknown local model capability "${capability}". Use text, vision, embeddings, structured_output, or tool_calling.`)
    }
    result[capabilityMapping[capability as ModelCapability]] = true
  }
  return result
}

export class LocalOpenAICompatibleProvider implements ModelProvider {
  readonly supportsGoalPlanning = true
  private model: string
  private readonly declaredCapabilities

  constructor(
    private readonly baseUrl = process.env.STEWARD_LOCAL_BASE_URL ?? 'http://127.0.0.1:11434/v1',
    model = process.env.STEWARD_LOCAL_MODEL ?? 'qwen3:8b',
    capabilities = process.env.STEWARD_LOCAL_CAPABILITIES ?? 'text,structured_output,tool_calling',
    // A chat model cannot produce embeddings, so pointing `embed` at
    // STEWARD_LOCAL_MODEL would fail against every real endpoint. Named
    // separately, and small: nomic-embed-text is about 140 MB.
    readonly embeddingModel = process.env.STEWARD_LOCAL_EMBEDDING_MODEL ?? 'nomic-embed-text',
  ) {
    this.model = model
    this.declaredCapabilities = configuredCapabilities(capabilities)
  }

  get summary() {
    return {
      id: 'local-openai-compatible',
      name: isLoopbackEndpoint(this.baseUrl) ? 'Local OpenAI-compatible' : 'Remote OpenAI-compatible',
      kind: isLoopbackEndpoint(this.baseUrl) ? 'local' as const : 'hosted' as const,
      model: this.model,
      embeddingModel: this.embeddingModel,
      baseUrl: this.baseUrl,
      configured: true,
      capabilities: this.declaredCapabilities,
      privacyNote: 'Requests go only to the configured endpoint. The default URL is loopback; remote URLs should be treated as vendors.',
    }
  }

  setModel(model: string): void {
    this.model = model
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/u, '')}/models`, { signal: AbortSignal.timeout(4_000) })
    if (!response.ok) throw new Error(`Model listing failed with HTTP ${response.status}`)
    const body = await response.json() as { data?: Array<{ id?: string }> }
    return (body.data ?? []).map((entry) => entry.id).filter((entry): entry is string => typeof entry === 'string').sort()
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    requireRequestCapabilities(this, request)
    const userContent = request.images?.length
      ? [
          { type: 'text', text: request.prompt },
          ...request.images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl, detail: image.detail ?? 'high' } })),
        ]
      : request.prompt
    const response = (await withTransportRetry(() => fetch(`${this.baseUrl.replace(/\/$/u, '')}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', authorization: 'Bearer steward-local' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: userContent },
        ],
        ...(request.jsonSchema
          ? { response_format: { type: 'json_schema', json_schema: { name: request.jsonSchema.name, schema: request.jsonSchema.schema, strict: request.jsonSchema.strict } } }
          : request.requireJson ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: request.signal
        ? AbortSignal.any([request.signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    }), { phase: 'text', callerSignal: request.signal })).value
    const body = await response.json() as ChatResponse
    if (!response.ok) throw new Error(`Local provider request failed (${response.status}): ${body.error?.message ?? 'unknown error'}`)
    return {
      text: body.choices?.[0]?.message?.content ?? '',
      model: body.model ?? this.model,
      providerId: this.summary.id,
      usage: { inputTokens: body.usage?.prompt_tokens ?? null, outputTokens: body.usage?.completion_tokens ?? null },
      responseId: body.id ?? null,
    }
  }

  async embed(texts: string[]): Promise<EmbeddingResponse> {
    requireCapabilities(this, ['embeddings'])
    const response = (await withTransportRetry(() => fetch(`${this.baseUrl.replace(/\/$/u, '')}/embeddings`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', authorization: 'Bearer steward-local' },
      body: JSON.stringify({ model: this.embeddingModel, input: texts }),
      signal: AbortSignal.timeout(30_000),
    }), { phase: 'embeddings' })).value
    const body = await response.json() as { data?: Array<{ embedding: number[] }>; usage?: { prompt_tokens?: number }; error?: { message?: string } }
    if (!response.ok || !body.data) throw new Error(body.error?.message ?? 'Local embeddings endpoint did not return vectors')
    return { vectors: body.data.map((item) => item.embedding), usage: { inputTokens: body.usage?.prompt_tokens ?? null } }
  }

  async health(): Promise<{ ok: boolean; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/u, '')}/models`, { signal: AbortSignal.timeout(1500) })
      return response.ok
        ? { ok: true, message: `Endpoint reachable; capabilities are declared per configuration for ${this.model}` }
        : { ok: false, message: `Endpoint returned HTTP ${response.status}` }
    } catch {
      return { ok: false, message: `No server reachable at ${this.baseUrl}` }
    }
  }
}
