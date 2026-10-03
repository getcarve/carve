import { HostedOpenAIProvider } from './openai-hosted.js'
import type {
  ComputerActionRequest,
  ComputerActionResponse,
  ComputerUseTurn,
  ModelRequest,
  ModelResponse,
  StartComputerUseSessionRequest,
} from './types.js'

/**
 * Azure OpenAI through the Responses-compatible `/openai/v1` surface of one
 * Azure OpenAI resource. It is the direct OpenAI adapter with three
 * differences: the credential is the resource's `api-key` (also accepted as
 * a bearer), the hostname is derived from a validated resource endpoint so a
 * typo cannot send the key elsewhere, and Azure serves *deployments* rather
 * than model names. Carve's live-computer routing asks for OpenAI model names
 * (Sol, Terra, Astra); the deployment map turns each into whichever
 * deployment this resource has, defaulting to one deployment for everything
 * until the others exist. Nothing else changes: the same computer-use
 * surfaces, the same structured outputs, the same advisory proposals.
 */
export interface AzureOpenAIProviderOptions {
  apiKey?: string
  endpoint?: string
  /** Deployment used for any model name the map does not cover. */
  deployment?: string
  /** `model:deployment` pairs, comma separated. */
  deploymentMap?: string
  /** Deployment names that may be requested as-is. */
  deployments?: string
  apiVersion?: string
}

const DEFAULT_DEPLOYMENT = 'gpt-5.4'
const DEFAULT_DEPLOYMENTS = 'gpt-5.4,gpt-5.4-mini'
const DEFAULT_MANAGEMENT_API_VERSION = '2023-03-15-preview'

export function parseDeploymentMap(value: string | undefined): Map<string, string> {
  const map = new Map<string, string>()
  for (const pair of (value ?? '').split(',')) {
    const separator = pair.indexOf(':')
    if (separator < 0) continue
    const model = pair.slice(0, separator).trim()
    const deployment = pair.slice(separator + 1).trim()
    if (model && deployment) map.set(model, validateDeploymentName(deployment))
  }
  return map
}

function validateDeploymentName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 100 || !/^[A-Za-z0-9._-]+$/u.test(trimmed)) throw new Error(`The Azure OpenAI deployment name "${value}" is invalid`)
  return trimmed
}

/** Only an Azure OpenAI resource hostname is accepted; the path is fixed. */
export function validateAzureOpenAIEndpoint(value: string): string {
  const trimmed = value.trim().replace(/\/+$/u, '')
  let url: URL
  try { url = new URL(trimmed) } catch { throw new Error('AZURE_OPENAI_ENDPOINT must be an https URL such as https://<resource>.openai.azure.com') }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username
    || !/^[a-z0-9-]+\.(?:openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)$/u.test(url.hostname)) {
    throw new Error('AZURE_OPENAI_ENDPOINT must be an https URL such as https://<resource>.openai.azure.com')
  }
  return `${url.protocol}//${url.hostname}`
}

export class AzureOpenAIProvider extends HostedOpenAIProvider {
  private readonly endpoint: string | null
  private readonly apiKey: string
  private readonly defaultDeployment: string
  private readonly deploymentMap: Map<string, string>
  private readonly knownDeployments: Set<string>
  private readonly managementApiVersion: string
  private requestedModel: string

  constructor(options: AzureOpenAIProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.AZURE_OPENAI_API_KEY ?? ''
    const rawEndpoint = options.endpoint ?? process.env.AZURE_OPENAI_ENDPOINT ?? ''
    const endpoint = rawEndpoint ? validateAzureOpenAIEndpoint(rawEndpoint) : null
    const defaultDeployment = validateDeploymentName(options.deployment ?? process.env.STEWARD_AZURE_OPENAI_DEPLOYMENT ?? DEFAULT_DEPLOYMENT)
    const requestedModel = process.env.STEWARD_AZURE_OPENAI_MODEL ?? defaultDeployment
    super({
      apiKey,
      model: requestedModel,
      baseUrl: `${endpoint ?? 'https://unconfigured.openai.azure.com'}/openai/v1`,
      identity: {
        id: 'azure-openai',
        name: 'Azure OpenAI',
        privacyNote: 'Selected inputs are sent to your Azure OpenAI resource. The Azure key is never reused for direct OpenAI or Bedrock.',
      },
      credentials: () => (apiKey && endpoint ? apiKey : null),
      extraHeaders: () => ({ 'api-key': apiKey }),
    })
    this.endpoint = endpoint
    this.apiKey = apiKey
    this.defaultDeployment = defaultDeployment
    this.deploymentMap = parseDeploymentMap(options.deploymentMap ?? process.env.STEWARD_AZURE_OPENAI_DEPLOYMENT_MAP)
    this.knownDeployments = new Set((options.deployments ?? process.env.STEWARD_AZURE_OPENAI_DEPLOYMENTS ?? DEFAULT_DEPLOYMENTS).split(',').map((name) => name.trim()).filter(Boolean).map(validateDeploymentName))
    this.knownDeployments.add(defaultDeployment)
    this.managementApiVersion = options.apiVersion ?? process.env.STEWARD_AZURE_OPENAI_API_VERSION ?? DEFAULT_MANAGEMENT_API_VERSION
    this.requestedModel = requestedModel
  }

  override get summary() {
    const base = super.summary
    return {
      ...base,
      configured: Boolean(this.apiKey && this.endpoint),
      // Embeddings would need their own deployment; recall stays local-only here.
      capabilities: { ...base.capabilities, embeddings: false },
    }
  }

  /** Which deployment serves a requested model name. */
  deploymentFor(model: string | undefined): string {
    const requested = (model ?? this.requestedModel).trim()
    const mapped = this.deploymentMap.get(requested)
    if (mapped) return mapped
    if (this.knownDeployments.has(requested)) return requested
    return this.defaultDeployment
  }

  override setModel(model: string): void {
    this.requestedModel = model.trim()
    super.setModel(this.requestedModel)
  }

  /** Azure's `/models` lists the regional catalog, not this resource; the
   * deployments endpoint is what can actually be called. */
  override async listModels(): Promise<string[]> {
    if (!this.endpoint || !this.apiKey) throw new Error('Azure OpenAI provider is not configured')
    const response = await fetch(`${this.endpoint}/openai/deployments?api-version=${encodeURIComponent(this.managementApiVersion)}`, {
      headers: { 'api-key': this.apiKey },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) throw new Error(`Deployment listing failed with HTTP ${response.status}`)
    const body = await response.json() as { data?: Array<{ id?: string; status?: string }> }
    return (body.data ?? []).filter((entry) => entry.status === undefined || entry.status === 'succeeded').map((entry) => entry.id).filter((entry): entry is string => typeof entry === 'string').sort()
  }

  override complete(request: ModelRequest): Promise<ModelResponse> {
    return super.complete({ ...request, model: this.deploymentFor(request.model) })
  }

  override proposeComputerActions(request: ComputerActionRequest): Promise<ComputerActionResponse> {
    return super.proposeComputerActions({ ...request, model: this.deploymentFor(request.model) })
  }

  override startComputerUseSession(request: StartComputerUseSessionRequest): Promise<ComputerUseTurn> {
    return super.startComputerUseSession({ ...request, model: this.deploymentFor(request.model) })
  }

  override async health(): Promise<{ ok: boolean; message: string }> {
    if (!this.apiKey) return { ok: false, message: 'AZURE_OPENAI_API_KEY is not set' }
    if (!this.endpoint) return { ok: false, message: 'AZURE_OPENAI_ENDPOINT is not set' }
    return { ok: true, message: `Configured for ${new URL(this.endpoint).hostname}, default deployment ${this.defaultDeployment}; no paid request was made` }
  }
}
