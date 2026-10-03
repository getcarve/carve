import { guideQuestionId } from '../guide-metering.js'
import { randomUUID } from 'node:crypto'
import { CloudError, type CarveCloudClient } from '../cloud/client.js'
import { HostedOpenAIProvider } from './openai-hosted.js'
import { RelayConcurrency } from './relay-concurrency.js'
import type {
  ComputerActionRequest,
  ComputerActionResponse,
  ComputerUseTurn,
  ContinueComputerUseSessionRequest,
  EmbeddingResponse,
  ModelMetering,
  ModelRequest,
  ModelResponse,
  StartComputerUseSessionRequest,
} from './types.js'

export const STEWARD_CLOUD_PROVIDER_ID = 'carve-cloud'

/**
 * Carve Cloud speaks the OpenAI Responses API through the gateway relay,
 * so this adapter is the hosted OpenAI adapter pointed at the relay with a
 * device or session token instead of an API key. What it adds is billing
 * context: every request carries a purpose header, and requests made during
 * a delegated run carry the run's task id so the relay can meter it.
 */
export class CarveCloudProvider extends HostedOpenAIProvider {
  private activeTask: { taskId: string } | null = null
  /** The relay's per-account in-flight limit, honoured here (see relay-concurrency.ts). */
  private readonly relayConcurrency = RelayConcurrency.fromEnvironment()
  private limited<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    return this.relayConcurrency ? this.relayConcurrency.run(signal, operation) : operation()
  }

  constructor(private readonly client: CarveCloudClient, model = process.env.STEWARD_CLOUD_MODEL ?? 'gpt-5.6-terra') {
    super({
      model,
      baseUrl: client.relayBaseUrl('openai') ?? 'https://carve-cloud.invalid/v1/relay/openai',
      identity: {
        id: STEWARD_CLOUD_PROVIDER_ID,
        name: 'Carve Cloud',
        privacyNote: 'Requests pass through Carve Cloud to OpenAI. Carve Cloud records usage metadata for your plan. OpenAI processing and retention depend on the mode; local task history is separate.',
      },
      credentials: () => (client.configured ? client.bearerToken() ?? 'pending-device-registration' : null),
      // The relay forwards prompt_cache_options and breakpoints as sent. Without them GPT-6 caches implicitly and bills
      // most of every prompt at the cache-write rate: on 43 recorded requests from five real runs (1 October), replayed
      // both ways, the implicit path cost 20% more ($0.452 vs $0.376) at the same latency (131 s vs 129 s).
      explicitPromptCache: true,
      extraHeaders: (metering) => this.meteringHeaders(metering),
      responseError: (status, body) => {
        if (!body || typeof body !== 'object' || !('error' in body) || typeof body.error !== 'string'
          || !('message' in body) || typeof body.message !== 'string') return null
        return new CloudError(status, body.error, body.message)
      },
    })
  }

  /** Requests without an explicit purpose made while a task is active bill to that task. */
  setActiveTask(taskId: string | null): void {
    this.activeTask = taskId ? { taskId } : null
  }

  activeTaskId(): string | null {
    return this.activeTask?.taskId ?? null
  }

  private meteringHeaders(metering: ModelMetering | undefined): Record<string, string> {
    const effective: ModelMetering = metering
      ?? (this.activeTask ? { purpose: 'task', taskId: this.activeTask.taskId } : { purpose: 'other' })
    const headers: Record<string, string> = { 'x-carve-purpose': effective.purpose }
    const taskId = effective.taskId ?? (effective.purpose === 'task' ? this.activeTask?.taskId : null)
    if (taskId) headers['x-carve-task'] = taskId
    if (effective.purpose === 'guide') headers['x-carve-question'] = guideQuestionId() ?? randomUUID()
    return headers
  }

  override async listModels(): Promise<string[]> {
    await this.client.ensureDevice()
    return super.listModels()
  }

  override async complete(request: ModelRequest): Promise<ModelResponse> {
    await this.client.requireSignIn()
    // Interpretation and route planning happen before a task exists. They are
    // part of the user's question; task execution keeps its explicit funding.
    const metered = { ...request, metering: request.metering
      ?? (this.activeTask ? { purpose: 'task' as const, taskId: this.activeTask.taskId } : { purpose: 'guide' as const }) }
    return this.limited(request.signal, () => super.complete(metered))
  }

  override async proposeComputerActions(request: ComputerActionRequest): Promise<ComputerActionResponse> {
    await this.client.requireSignIn()
    return this.limited(request.signal, () => super.proposeComputerActions(request))
  }

  override async startComputerUseSession(request: StartComputerUseSessionRequest): Promise<ComputerUseTurn> {
    await this.client.requireSignIn()
    return this.limited(request.signal, () => super.startComputerUseSession(request))
  }

  override async continueComputerUseSession(request: ContinueComputerUseSessionRequest): Promise<ComputerUseTurn> {
    await this.client.requireSignIn()
    return this.limited(request.signal, () => super.continueComputerUseSession(request))
  }

  override async embed(texts: string[]): Promise<EmbeddingResponse> {
    await this.client.requireSignIn()
    return this.limited(undefined, () => super.embed(texts))
  }

  override async health(): Promise<{ ok: boolean; message: string }> {
    if (!this.client.configured) return { ok: false, message: 'Carve Cloud is not configured for this build' }
    const status = await this.client.refresh()
    if (status.lastError) return { ok: false, message: status.lastError }
    const plan = status.entitlement?.plan.name ?? 'Free'
    return { ok: true, message: `${plan} plan · no paid request was made` }
  }
}
