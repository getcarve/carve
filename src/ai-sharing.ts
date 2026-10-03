import type { ModelProviderSummary } from './types.js'

export type SharingCategory = 'catalog' | 'windows'
export interface SharingRequest { category: SharingCategory; providerId: string; recipient: string }
export class AISharingRequiredError extends Error {
  readonly request: SharingRequest
  constructor(category: SharingCategory, provider: ModelProviderSummary) {
    super(category === 'catalog'
      ? `Allow app-name sharing with ${sharingRecipient(provider)} before choosing apps. No app names have been sent for this request.`
      : `Allow window sharing with ${sharingRecipient(provider)} before continuing.`)
    this.name = 'AISharingRequiredError'
    this.request = { category, providerId: provider.id, recipient: sharingRecipient(provider) }
  }
}
export interface SharingSettings { getSetting(key: string): string | null; setSetting(key: string, value: string): void }

/** These are endpoint claims, not promises about what a local server does next. */
export function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname.toLowerCase())
  } catch { return false }
}

export function sharingRecipient(provider: ModelProviderSummary): string {
  return provider.id === 'carve-cloud' ? 'Carve Cloud and OpenAI' : provider.name
}

export function recipientIdentity(provider: ModelProviderSummary): string {
  // Never persist URL credentials or query parameters. Endpoint paths can
  // select a different relay and must invalidate an earlier agreement too.
  let endpoint = provider.baseUrl ?? ''
  try { const url = new URL(endpoint); endpoint = `${url.origin}${url.pathname}` } catch { endpoint = '' }
  return JSON.stringify([provider.id, provider.kind, endpoint])
}

/** v2 deliberately does not inherit the old provider-ID-only visual grant. */
export class AISharingConsent {
  private readonly temporary = new Map<string, Set<string>>()
  constructor(private readonly settings: SharingSettings) {}
  private key(category: SharingCategory): string { return `ai_sharing.v2.${category}` }
  allows(category: SharingCategory, provider: ModelProviderSummary, taskId?: string): boolean {
    if (provider.kind !== 'hosted') return true
    const identity = recipientIdentity(provider)
    return this.settings.getSetting(this.key(category)) === identity
      || Boolean(this.temporary.get(`${category}:${identity}`)?.has('*'))
      || Boolean(taskId && this.temporary.get(`${category}:${identity}`)?.has(taskId))
  }
  taskScopes(category: SharingCategory, provider: ModelProviderSummary): string[] {
    return [...(this.temporary.get(`${category}:${recipientIdentity(provider)}`) ?? [])].filter(scope => scope !== '*')
  }
  remembered(category: SharingCategory, provider: ModelProviderSummary): boolean {
    return this.settings.getSetting(this.key(category)) === recipientIdentity(provider)
  }
  grant(category: SharingCategory, provider: ModelProviderSummary, remember: boolean, taskId?: string): void {
    const identity = recipientIdentity(provider)
    if (remember) this.settings.setSetting(this.key(category), identity)
    else {
      const key = `${category}:${identity}`
      const scopes = this.temporary.get(key) ?? new Set<string>()
      scopes.add(taskId ?? '*')
      this.temporary.set(key, scopes)
    }
  }
  revoke(category: SharingCategory): void {
    this.settings.setSetting(this.key(category), '')
    for (const key of this.temporary.keys()) if (key.startsWith(`${category}:`)) this.temporary.delete(key)
  }
  assert(category: SharingCategory, provider: ModelProviderSummary, taskId?: string): void {
    if (!this.allows(category, provider, taskId)) throw new AISharingRequiredError(category, provider)
  }
}
