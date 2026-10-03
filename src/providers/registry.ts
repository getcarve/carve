import { packagedEvaluationProvider } from '../evaluation/packaged-model-budget.js'
import type { CarveDatabase } from '../db.js'
import type { ModelProviderSummary } from '../types.js'
import { HostedAnthropicProvider } from './anthropic-hosted.js'
import { AWSBedrockProvider } from './aws-bedrock.js'
import { AzureOpenAIProvider } from './azure-openai.js'
import { MockModelProvider } from './mock.js'
import { LocalOpenAICompatibleProvider } from './openai-compatible.js'
import { OpenRouterProvider } from './openrouter.js'
import { HostedOpenAIProvider } from './openai-hosted.js'
import { supportsComputerActionProposals, supportsComputerUseSessions, type ModelProvider } from './types.js'

/** Settings key holding the model chosen for one provider. */
function modelKey(providerId: string): string {
  return `model.${providerId}`
}

export class ProviderRegistry {
  private readonly providers: Map<string, ModelProvider>
  private activeId: string
  private sharingEpoch = new AbortController()
  private readonly sharingProviders = new Map<ModelProvider, ModelProvider>()

  /** Invalidate held providers as well as in-flight requests on revocation. */
  revokeSharing(): void {
    this.sharingEpoch.abort(new DOMException('AI sharing was stopped. Review permission before continuing.', 'AbortError'))
    this.sharingEpoch = new AbortController()
    this.sharingProviders.clear()
  }

  private sharingProvider(provider: ModelProvider): ModelProvider {
    if (provider.summary.kind !== 'hosted') return provider
    const existing = this.sharingProviders.get(provider)
    if (existing) return existing
    const signal = this.sharingEpoch.signal
    const outbound = new Set(['complete', 'proposeComputerActions', 'startComputerUseSession', 'continueComputerUseSession', 'searchPublicWeb', 'embed'])
    const wrapped = new Proxy(provider, { get(target, property) {
      const value: unknown = Reflect.get(target, property, target)
      if (typeof value !== 'function') return value
      if (!outbound.has(String(property))) return value.bind(target)
      return (...args: unknown[]) => {
        signal.throwIfAborted()
        if (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
          const request = args[0] as { signal?: AbortSignal }
          args[0] = { ...request, signal: request.signal ? AbortSignal.any([signal, request.signal]) : signal }
        }
        return Promise.resolve(Reflect.apply(value, target, args)).then(result => { signal.throwIfAborted(); return result })
      }
    } })
    this.sharingProviders.set(provider, wrapped)
    return wrapped
  }
  private readonly evaluationProviders = new Map<string, ModelProvider>()

  constructor(private readonly database: CarveDatabase, additionalProviders: ModelProvider[] = []) {
    const defaults: ModelProvider[] = [
      new MockModelProvider(),
      new HostedOpenAIProvider(),
      new HostedAnthropicProvider(),
      new AWSBedrockProvider(),
      new AzureOpenAIProvider(),
      new OpenRouterProvider(),
      new LocalOpenAICompatibleProvider(),
    ]
    this.providers = new Map(defaults.map((provider) => [provider.summary.id, provider]))
    for (const provider of additionalProviders) this.providers.set(provider.summary.id, provider)
    // A configured Carve Cloud relay is the launch default so a fresh install
    // works before anyone pastes a key; explicit choices still win.
    const cloud = this.providers.get('carve-cloud')
    const fallback = cloud?.summary.configured ? 'carve-cloud' : 'mock'
    const requested = process.env.CARVE_MANAGED_CLOUD === 'true' ? 'carve-cloud' : process.env.STEWARD_PROVIDER ?? database.getSetting('active_provider') ?? fallback
    this.activeId = this.providers.has(requested) ? requested : fallback
    // A model chosen in the interface outlives the process; the environment is
    // only the default for a provider nobody has chosen a model for yet.
    for (const provider of this.providers.values()) {
      const stored = database.getSetting(modelKey(provider.summary.id))
      if (stored && provider.setModel) provider.setModel(stored)
    }
  }

  setModel(providerId: string, model: string): ModelProviderSummary {
    const provider = this.get(providerId)
    if (!provider.setModel) throw new Error(`Provider "${providerId}" has a fixed model`)
    const next = model.trim()
    if (!next) throw new Error('A model name is required')
    provider.setModel(next)
    this.database.setSetting(modelKey(providerId), next)
    return provider.summary
  }

  async listModels(providerId: string): Promise<string[]> {
    const provider = this.get(providerId)
    if (!provider.listModels) return []
    return provider.listModels()
  }

  list(): Array<ModelProviderSummary & { active: boolean }> {
    return [...this.providers.values()].filter(provider => process.env.CARVE_MANAGED_CLOUD !== 'true' || provider.summary.id === 'carve-cloud').map((provider) => ({
      ...provider.summary,
      computerActionProposals: supportsComputerActionProposals(provider),
      computerUseSessions: supportsComputerUseSessions(provider),
      active: provider.summary.id === this.activeId,
    }))
  }

  active(): ModelProvider {
    const provider = this.providers.get(this.activeId)
    if (!provider) throw new Error('Active model provider is unavailable')
    return this.sharingProvider(this.evaluationProvider(provider))
  }

  get(providerId: string): ModelProvider {
    if (process.env.CARVE_MANAGED_CLOUD === 'true' && providerId !== 'carve-cloud') throw new Error('This beta uses your Carve account. Choose Carve Cloud in Settings.')
    const provider = this.providers.get(providerId)
    if (!provider) throw new Error(`Unknown model provider: ${providerId}`)
    return this.sharingProvider(this.evaluationProvider(provider))
  }

  private evaluationProvider(provider: ModelProvider): ModelProvider {
    const path = process.env.STEWARD_PACKAGED_EVAL_BUDGET
    if (!path || provider.summary.kind !== 'hosted') return provider
    let governed = this.evaluationProviders.get(provider.summary.id)
    if (!governed) { governed = packagedEvaluationProvider(provider, path); this.evaluationProviders.set(provider.summary.id, governed) }
    return governed
  }

  select(providerId: string): ModelProviderSummary {
    const provider = this.get(providerId)
    this.activeId = providerId
    this.database.setSetting('active_provider', providerId)
    return provider.summary
  }
}
