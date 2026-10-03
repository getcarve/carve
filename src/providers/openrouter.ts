import type { EmbeddingResponse, ModelProvider, ModelRequest, ModelResponse } from './types.js'
import { requireRequestCapabilities } from './types.js'
import { usageCount } from '../../gateway/src/provider-cost.js'
import { withTransportRetry } from './transport-retry.js'

export const openRouterBaseUrl = 'https://openrouter.ai/api/v1'
/** The pair Carve's prompts were tuned on, as OpenRouter names them. */
export const defaultOpenRouterModel = 'openai/gpt-6-sol'
export const defaultOpenRouterFastModel = 'openai/gpt-6-luna'

export interface OpenRouterOptions {
  apiKey?: string
  model?: string
  fastModel?: string
  dataCollection?: string
}

interface OpenRouterChatResponse {
  id?: string
  model?: string
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    total_tokens?: unknown
    prompt_tokens_details?: { cached_tokens?: unknown }
    completion_tokens_details?: { reasoning_tokens?: unknown }
  }
  error?: { code?: number | string; message?: string }
}

interface OpenRouterModelEntry {
  id?: string
  architecture?: { input_modalities?: string[] }
  supported_parameters?: string[]
}

/** `deny` asks OpenRouter to use only upstream providers that do not collect prompts. Carve sends window images,
 * so that is the default; `allow` is an explicit choice. */
export function openRouterDataCollection(value: string | undefined): 'deny' | 'allow' {
  return value?.trim().toLowerCase() === 'allow' ? 'allow' : 'deny'
}

/**
 * OpenRouter: one key, many upstream models, through its OpenAI-compatible chat surface.
 *
 * It has no stateful computer-use session, so it drives the compact engine (browser windows) and every text and
 * vision call, and not the screenshot loop used for other Mac apps. Each request tells OpenRouter to use only
 * upstream providers that honour every parameter sent (structured output must not be dropped silently) and,
 * by default, only ones that do not collect prompts.
 */
export class OpenRouterProvider implements ModelProvider {
  readonly supportsGoalPlanning = true
  private readonly apiKey: string
  private model: string
  private readonly explicitFastModel: string | null
  private readonly dataCollection: 'deny' | 'allow'

  constructor(options: OpenRouterOptions = {}) {
    this.apiKey = (options.apiKey ?? process.env.OPENROUTER_API_KEY ?? '').trim()
    this.model = (options.model ?? process.env.STEWARD_OPENROUTER_MODEL ?? '').trim() || defaultOpenRouterModel
    this.explicitFastModel = (options.fastModel ?? process.env.STEWARD_OPENROUTER_FAST_MODEL ?? '').trim() || null
    this.dataCollection = openRouterDataCollection(options.dataCollection ?? process.env.STEWARD_OPENROUTER_DATA_COLLECTION)
  }

  get summary() {
    return {
      id: 'openrouter',
      name: 'OpenRouter',
      kind: 'hosted' as const,
      model: this.model,
      embeddingModel: null,
      baseUrl: openRouterBaseUrl,
      configured: this.apiKey.length > 0,
      capabilities: { text: true, vision: true, embeddings: false, structuredOutput: true, toolCalling: false },
      privacyNote: this.dataCollection === 'deny'
        ? 'Requests go to OpenRouter, which forwards them to the model you chose. Carve asks it to use only upstream providers that do not collect prompts.'
        : 'Requests go to OpenRouter, which forwards them to the model you chose. Upstream providers that store or train on prompts are allowed by your setting.',
    }
  }

  /** The model for frequent execution calls. The tuned default pair is used only while the main model is the
   * default; choosing another main model without naming a fast one uses that model for everything. */
  get fastModel(): string {
    return this.explicitFastModel ?? (this.model === defaultOpenRouterModel ? defaultOpenRouterFastModel : this.model)
  }

  setModel(model: string): void {
    this.model = model.trim()
  }

  /** Models that accept images and structured output, the two things every Carve task needs. */
  async listModels(): Promise<string[]> {
    const response = await fetch(`${openRouterBaseUrl}/models`, { signal: AbortSignal.timeout(8_000) })
    if (!response.ok) throw new Error(`OpenRouter model listing failed with HTTP ${response.status}`)
    const body = await response.json() as { data?: OpenRouterModelEntry[] }
    return (body.data ?? [])
      .filter(entry => entry.architecture?.input_modalities?.includes('image') && entry.supported_parameters?.includes('structured_outputs'))
      .map(entry => entry.id)
      .filter((id): id is string => typeof id === 'string')
      .sort()
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (!this.apiKey) throw new Error('OpenRouter is not configured. Set OPENROUTER_API_KEY.')
    requireRequestCapabilities(this, request)
    const model = request.model?.trim() || this.model
    const userContent = request.images?.length
      ? [
          { type: 'text', text: request.prompt },
          ...request.images.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl, detail: image.detail ?? 'high' } })),
        ]
      : request.prompt
    const response = (await withTransportRetry(() => fetch(`${openRouterBaseUrl}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
        // Attribution only: OpenRouter shows which application a request came from.
        'http-referer': 'https://www.getcarve.app',
        'x-title': 'Carve',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: userContent },
        ],
        provider: { require_parameters: true, data_collection: this.dataCollection },
        ...(request.jsonSchema
          ? { response_format: { type: 'json_schema', json_schema: { name: request.jsonSchema.name, schema: request.jsonSchema.schema, strict: request.jsonSchema.strict } } }
          : request.requireJson ? { response_format: { type: 'json_object' } } : {}),
        ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
        ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
      }),
      signal: request.signal
        ? AbortSignal.any([request.signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
    }), { phase: 'text', callerSignal: request.signal })).value
    const body = await response.json().catch(() => ({})) as OpenRouterChatResponse
    // OpenRouter reports some upstream failures inside a 200 response.
    if (!response.ok || body.error) throw new Error(openRouterFailure(response.status, body.error?.message, model, this.dataCollection, Boolean(request.reasoningEffort)))
    return {
      text: body.choices?.[0]?.message?.content ?? '',
      model: body.model ?? model,
      providerId: this.summary.id,
      usage: {
        inputTokens: usageCount(body.usage?.prompt_tokens),
        outputTokens: usageCount(body.usage?.completion_tokens),
        totalTokens: usageCount(body.usage?.total_tokens),
        cachedInputTokens: usageCount(body.usage?.prompt_tokens_details?.cached_tokens),
        reasoningTokens: usageCount(body.usage?.completion_tokens_details?.reasoning_tokens),
      },
      responseId: body.id ?? null,
    }
  }

  async embed(_texts: string[]): Promise<EmbeddingResponse> {
    throw new Error('OpenRouter is not used for embeddings in Carve. Choose a provider with an embeddings model for semantic search.')
  }

  async health(): Promise<{ ok: boolean; message: string }> {
    if (!this.apiKey) return { ok: false, message: 'OPENROUTER_API_KEY is not set' }
    try {
      const response = await fetch(`${openRouterBaseUrl}/key`, { headers: { authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(4_000) })
      return response.ok
        ? { ok: true, message: `Key accepted; using ${this.model}${this.fastModel === this.model ? '' : ` with ${this.fastModel} for frequent calls`}` }
        : { ok: false, message: response.status === 401 ? 'OpenRouter rejected the key' : `OpenRouter returned HTTP ${response.status}` }
    } catch {
      return { ok: false, message: 'OpenRouter could not be reached' }
    }
  }
}

/** A refusal for want of an eligible upstream provider is the one failure a person can fix from the settings, so
 * the message says which setting. */
export function openRouterFailure(status: number, message: string | undefined, model: string, dataCollection: 'deny' | 'allow', sentReasoning: boolean): string {
  const detail = message?.trim() || 'unknown error'
  const noEndpoint = /no (?:allowed )?(?:endpoints|providers)|data policy/iu.test(detail)
  if (!noEndpoint) return `OpenRouter request failed (${status}): ${detail}`
  const hints = [
    dataCollection === 'deny' ? 'STEWARD_OPENROUTER_DATA_COLLECTION=allow permits upstream providers that store or train on prompts' : null,
    sentReasoning ? 'STEWARD_OPENROUTER_REASONING_EFFORT=off stops sending a reasoning effort' : null,
    'the model must accept images and structured output',
  ].filter((hint): hint is string => hint !== null)
  return `OpenRouter has no upstream provider for ${model} that meets this request (${status}): ${detail}. Check: ${hints.join('; ')}.`
}
