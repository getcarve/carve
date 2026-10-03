import { resolve } from 'node:path'
import { MacOSCloudCredentialStore, type CloudCredentialStore } from './credential-store.js'
import { CloudCredentialsVault, eraseCloudKeychainItems } from './credentials.js'
import type { CarveDatabase } from '../db.js'

/**
 * Client for Carve Cloud: the account, entitlement, task-metering, and
 * billing service. Tokens live in macOS Keychain; request content
 * for models never passes through this module (the relay provider sends it).
 */

export type CloudPlanId = 'free' | 'pro' | 'max' | 'own_key'
export type CloudTaskPath = 'universal' | 'assured'
export type CloudTaskOutcome = 'completed' | 'handoff' | 'stopped' | 'failed'

export interface CloudEntitlement {
  plan: { id: CloudPlanId; name: string; basis: 'subscription' | 'grace' | 'free' }
  account: { id: string; email: string; status: string; interval: string | null; graceUntil: string | null } | null
  period: { key: string; start: string; end: string | null }
  guide: { used: number; limit: number | null; fairUse: number }
  tasks: { used: number; included: number; credits: number; creditsExpireAt: string | null; actionBudget: number; tokenCap: number; assuredAllowed: boolean }
  trial: { state?: 'not_started' | 'active' | 'exhausted' | 'expired' | 'ineligible'; active: boolean; tasksUsed: number; tasksTotal: number; endsAt: string | null } | null
  billing?: { checkoutEnabled: boolean; portalEnabled: boolean }
  relayInference: boolean
  /** Published by the gateway so the computer-use model can change after launch. Absent on older gateways. */
  modelPolicy?: { profile: string; strategyModel: string; executionModel: string; updatedAt?: string } | null
}

export interface CloudTask {
  id: string
  path: CloudTaskPath
  unitsConsumed: number
  actionBudget: number
  tokenCap: number
  tokensUsed: number
  status: string
  createdAt: string
}

export interface CloudStatus {
  configured: boolean
  baseUrl: string | null
  deviceId: string | null
  signedIn: boolean
  entitlement: CloudEntitlement | null
  entitlementAt: string | null
  lastError: string | null
  credentialStorage?: 'not_loaded' | 'available' | 'unavailable'
}

export interface BrowserSignInStart { id: string; url: string; expiresAt: string; confirmation: string }

export type SignInStart = { challengeId: string; expiresAt: string; verificationUrl?: never } | { verificationUrl: string; expiresAt: string; challengeId?: never }

export class CloudError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'CloudError'
  }
}

const SETTING_ENTITLEMENT = 'entitlement_json'
const SETTING_ENTITLEMENT_AT = 'entitlement_at'
const REQUEST_TIMEOUT_MS = 20_000

export interface CloudClientOptions {
  credentialStore?: CloudCredentialStore
  baseUrl?: string | null
  fetchImpl?: typeof fetch
  platform?: string
  appVersion?: string
}

export class CarveCloudClient {
  readonly baseUrl: string | null
  private readonly fetchImpl: typeof fetch
  private readonly platform: string
  private readonly appVersion: string
  private lastError: string | null = null
  private registering: Promise<void> | null = null
  private credentials: CloudCredentialsVault | null
  private readonly credentialStore: CloudCredentialStore
  private browserSignIn: { id: string; canceled: boolean } | null = null
  private authChanges: Promise<void> = Promise.resolve()

  constructor(private readonly database: CarveDatabase, options: CloudClientOptions = {}) {
    const configured = (options.baseUrl ?? process.env.CARVE_CLOUD_URL ?? '').trim().replace(/\/+$/u, '')
    if (configured) {
      let url: URL
      try { url = new URL(configured) } catch { throw new Error('Carve Cloud URL must be an HTTPS origin.') }
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
        throw new Error('Carve Cloud URL must be an HTTPS origin (HTTP is allowed only on loopback for development).')
    }
    this.baseUrl = configured || null
    this.credentialStore = options.credentialStore ?? new MacOSCloudCredentialStore(resolve('dist/native/carve-keychain-helper'))
    this.credentials = this.baseUrl ? new CloudCredentialsVault(database, this.credentialStore, this.baseUrl) : null
    this.fetchImpl = options.fetchImpl ?? fetch
    this.platform = options.platform ?? `${process.platform}-${process.arch}`
    this.appVersion = options.appVersion ?? process.env.STEWARD_APP_VERSION ?? '0.1.0'
  }

  async requireSignIn(): Promise<void> {
    await this.ensureDevice()
    if (!this.status().signedIn) throw new CloudError(401, 'sign_in_required', 'Sign in to Carve to start your beta trial. Open Settings → Account.')
  }

  get configured(): boolean {
    return this.baseUrl !== null
  }

  /** The bearer the relay provider should send: the session when signed in, else the device token. */
  bearerToken(): string | null {
    const saved = this.credentials?.snapshot()
    return saved?.sessionToken ?? saved?.deviceToken ?? null
  }

  authHeaders(): Record<string, string> {
    const token = this.bearerToken()
    return token ? { authorization: `Bearer ${token}` } : {}
  }

  relayBaseUrl(provider: 'openai' | 'anthropic'): string | null {
    return this.baseUrl ? `${this.baseUrl}/v1/relay/${provider}` : null
  }

  status(): CloudStatus {
    const raw = this.database.getSetting(this.setting(SETTING_ENTITLEMENT))
    let entitlement: CloudEntitlement | null = null
    if (raw) {
      try { entitlement = JSON.parse(raw) as CloudEntitlement } catch { entitlement = null }
    }
    if (entitlement?.account && !this.credentials?.snapshot()?.sessionToken) entitlement = null
    return {
      configured: this.configured,
      baseUrl: this.baseUrl,
      deviceId: this.credentials?.snapshot()?.deviceId ?? null,
      signedIn: Boolean(this.credentials?.snapshot()?.sessionToken),
      entitlement,
      entitlementAt: this.database.getSetting(this.setting(SETTING_ENTITLEMENT_AT)) || null,
      lastError: this.lastError,
      credentialStorage: this.credentials?.status() ?? 'not_loaded',
    }
  }

  cachedEntitlement(): CloudEntitlement | null {
    return this.status().entitlement
  }

  /** Registers this install once; later calls are no-ops. Safe to call before every cloud request. */
  async ensureDevice(): Promise<string> {
    await this.readyCredentials()
    const existing = this.credentials?.snapshot()?.deviceToken
    if (existing) return existing
    if (!this.registering) {
      this.registering = this.request<{ deviceId: string; token: string }>('POST', '/v1/devices', { body: { platform: this.platform, appVersion: this.appVersion }, auth: false })
        .then(async (registered) => {
          await this.credentials!.update({ deviceId: registered.deviceId, deviceToken: registered.token })
        })
        .finally(() => { this.registering = null })
    }
    await this.registering
    return this.credentials?.snapshot()?.deviceToken ?? ''
  }

  async refresh(): Promise<CloudStatus> {
    await this.ensureDevice()
    const attemptedSession = this.credentials?.snapshot()?.sessionToken
    try {
      const me = await this.request<{ deviceId: string; entitlement: CloudEntitlement }>('GET', '/v1/me')
      this.storeEntitlement(me.entitlement)
      this.lastError = null
    } catch (error) {
      if (error instanceof CloudError && error.status === 401 && attemptedSession && this.credentials?.snapshot()?.sessionToken === attemptedSession) {
        // The session lapsed; fall back to the device identity and try once more.
        this.credentials!.blockSession()
        this.clearEntitlement()
        await this.credentials!.update({ sessionToken: null })
        return this.refresh()
      }
      this.lastError = error instanceof Error ? error.message : String(error)
    }
    return this.status()
  }

  browserSignInStart(email: string, termsVersion: string): Promise<BrowserSignInStart> {
    if (this.browserSignIn) this.browserSignIn.canceled = true
    return this.serializeAuth(async () => {
      await this.ensureDevice()
      if (this.browserSignIn) {
        this.browserSignIn.canceled = true
        await this.request('POST', '/v1/auth/browser/cancel', { body: { id: this.browserSignIn.id } }).catch(() => {})
      }
      const result = await this.request<BrowserSignInStart>('POST', '/v1/auth/browser/start', { body: { email, termsVersion } })
      this.browserSignIn = { id: result.id, canceled: false }
      return result
    })
  }

  browserSignInFinish(id: string, termsVersion: string): Promise<{ pending: boolean; status?: CloudStatus }> {
    return this.serializeAuth(async () => {
      const attempt = this.browserSignIn
      if (!attempt || attempt.id !== id || attempt.canceled) throw new Error('Start a new browser sign-in request.')
      const result = await this.request<{ pending: boolean; token?: string; entitlement?: CloudEntitlement | null }>('POST', '/v1/auth/browser/finish', { body: { id, termsVersion } })
      if (result.pending) return { pending: true }
      if (!result.token) throw new Error('Could not finish sign-in. Try an email code.')
      const token = result.token
      const credentials = this.credentials!
      const discard = async () => {
        if (credentials.snapshot()?.sessionToken === token) {
          credentials.blockSession()
          this.clearEntitlement()
          await credentials.update({ sessionToken: null })
        }
        await this.request('POST', '/v1/auth/signout', { token }).catch(() => {})
      }
      if (attempt.canceled) { await discard(); return { pending: true } }
      await this.credentials!.update({ sessionToken: result.token })
      if (attempt.canceled) { await discard(); return { pending: true } }
      if (result.entitlement) this.storeEntitlement(result.entitlement)
      this.lastError = null
      this.browserSignIn = null
      return { pending: false, status: this.status() }
    })
  }

  browserSignInCancel(id: string): Promise<void> {
    if (this.browserSignIn?.id === id) this.browserSignIn.canceled = true
    return this.serializeAuth(async () => {
      await this.request('POST', '/v1/auth/browser/cancel', { body: { id } })
      if (this.browserSignIn?.id === id) this.browserSignIn = null
    })
  }

  async signInStart(email: string): Promise<SignInStart> {
    await this.ensureDevice()
    return this.request('POST', '/v1/auth/start', { body: { email } })
  }

  async signInVerificationStatus(ticket: string): Promise<{ verified: boolean }> {
    await this.ensureDevice()
    return this.request('POST', '/v1/onboarding/status', { body: { ticket } })
  }

  signInVerify(challengeId: string, code: string, termsVersion?: string): Promise<CloudStatus> {
    return this.serializeAuth(() => this.verify(challengeId, code, termsVersion))
  }

  private async verify(challengeId: string, code: string, termsVersion?: string): Promise<CloudStatus> {
    await this.ensureDevice()
    const verified = await this.request<{ token: string; entitlement: CloudEntitlement | null }>('POST', '/v1/auth/verify', { body: { challengeId, code, termsVersion } })
    await this.credentials!.update({ sessionToken: verified.token })
    if (verified.entitlement) this.storeEntitlement(verified.entitlement)
    this.lastError = null
    return this.status()
  }

  signOut(): Promise<CloudStatus> {
    return this.serializeAuth(async () => {
      const previousToken = this.bearerToken()
      this.credentials?.blockSession()
      this.clearEntitlement()
      await this.readyCredentials()
      const token = previousToken ?? this.bearerToken()
      // Start revocation with the captured token, while the local session is
      // already disabled. Failed Keychain writes cannot resurrect it on restart.
      const revoke = this.request('POST', '/v1/auth/signout', { token }).catch(() => {})
      try { await this.credentials!.update({ sessionToken: null }) } finally { await revoke }
      return this.refresh()
    })
  }

  signOutAll(): Promise<CloudStatus> {
    return this.serializeAuth(async () => {
      await this.readyCredentials()
      const token = this.bearerToken()
      if (!token?.startsWith('ss_')) throw new CloudError(401, 'sign_in_required', 'Sign in to sign out all devices.')
      // Confirm account-wide revocation before removing the credential needed
      // to retry. A network failure must not masquerade as global sign-out.
      try {
        await this.request('POST', '/v1/auth/signout-all', { token })
      } catch (error) {
        if (error instanceof CloudError && error.status === 401) {
          this.credentials!.blockSession()
          this.clearEntitlement()
          await this.credentials!.update({ sessionToken: null })
          throw new CloudError(401, 'session_expired', 'Your session expired. Sign in again to retry signing out all devices.')
        }
        throw error
      }
      this.credentials!.blockSession()
      this.clearEntitlement()
      await this.credentials!.update({ sessionToken: null })
      return this.refresh()
    })
  }

  async checkoutUrl(input: { plan?: 'pro' | 'max' | 'own_key'; interval?: 'month' | 'year' | 'lifetime'; pack?: 'tasks_20' | 'tasks_100' }): Promise<string> {
    const result = await this.request<{ url: string }>('POST', '/v1/billing/checkout', { body: input })
    return result.url
  }

  async portalUrl(): Promise<string> {
    const result = await this.request<{ url: string }>('POST', '/v1/billing/portal')
    return result.url
  }

  deleteAccount(): Promise<CloudStatus> {
    return this.serializeAuth(async () => {
      await this.request('DELETE', '/v1/me')
      this.credentials!.blockSession()
      this.clearEntitlement()
      await this.credentials!.update({ sessionToken: null })
      return this.refresh()
    })
  }

  async allocateTask(path: CloudTaskPath, requestId?: string): Promise<CloudTask> {
    await this.ensureDevice()
    const result = await this.request<{ task: CloudTask; entitlement: CloudEntitlement }>('POST', '/v1/tasks', { body: { path, requestId } })
    this.storeEntitlement(result.entitlement)
    return result.task
  }

  async continueTask(taskId: string, decisionId?: string): Promise<CloudTask> {
    // Never silently fall back to a gateway that cannot deduplicate decisions.
    const endpoint = decisionId ? 'continuations' : 'continue'
    const result = await this.request<{ task: CloudTask; entitlement: CloudEntitlement }>('POST', `/v1/tasks/${encodeURIComponent(taskId)}/${endpoint}`, { body: { decisionId } })
    this.storeEntitlement(result.entitlement)
    return result.task
  }

  async finishTask(taskId: string, outcome: CloudTaskOutcome, actions: number): Promise<void> {
    await this.request('POST', `/v1/tasks/${encodeURIComponent(taskId)}/finish`, { body: { outcome, actions } })
  }

  /** Called before the local database is wiped; Keychain denial must stop the
   * wipe so its cleanup registry is not lost. This does not delete cloud billing. */
  forgetLocalCredentials(): Promise<void> {
    return this.serializeAuth(async () => {
      this.credentials?.blockSession()
      this.credentials = null
      try { await eraseCloudKeychainItems(this.database, this.credentialStore) } catch (error) {
        this.resetAfterLocalPurge()
        this.lastError = error instanceof Error ? error.message : 'Keychain cleanup failed'
        throw error
      }
    })
  }

  resetAfterLocalPurge(): void {
    this.credentials = this.baseUrl ? new CloudCredentialsVault(this.database, this.credentialStore, this.baseUrl) : null
    this.lastError = null
  }

  private setting(key: string): string { return `${this.credentials?.settingsPrefix ?? 'cloud.unconfigured.'}${key}` }

  private clearEntitlement(): void {
    this.database.setSetting(this.setting(SETTING_ENTITLEMENT), '')
    this.database.setSetting(this.setting(SETTING_ENTITLEMENT_AT), '')
  }

  private async readyCredentials(): Promise<void> {
    if (!this.credentials) throw new CloudError(0, 'cloud_unconfigured', 'Carve Cloud is not configured for this build')
    try { await this.credentials.ready() } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Keychain is unavailable'
      throw error
    }
  }

  private serializeAuth<T>(action: () => Promise<T>): Promise<T> {
    const result = this.authChanges.then(action)
    this.authChanges = result.then(() => {}, () => {})
    return result
  }

  private storeEntitlement(entitlement: CloudEntitlement): void {
    this.database.setSetting(this.setting(SETTING_ENTITLEMENT), JSON.stringify(entitlement))
    this.database.setSetting(this.setting(SETTING_ENTITLEMENT_AT), new Date().toISOString())
  }

  private async request<T>(method: string, path: string, options: { body?: unknown; auth?: boolean; token?: string | null } = {}): Promise<T> {
    if (!this.baseUrl) throw new CloudError(0, 'cloud_unconfigured', 'Carve Cloud is not configured for this build')
    const headers: Record<string, string> = { accept: 'application/json' }
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    if (options.token !== undefined) {
      if (options.token) headers.authorization = `Bearer ${options.token}`
    } else if (options.auth !== false) {
      await this.readyCredentials()
      Object.assign(headers, this.authHeaders())
    }
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      })
    } catch (error) {
      throw new CloudError(0, 'cloud_unreachable', `Carve Cloud could not be reached (${error instanceof Error ? error.name : 'network error'})`)
    }
    const text = await response.text()
    let parsed: unknown = null
    try { parsed = text ? JSON.parse(text) : null } catch { parsed = null }
    if (!response.ok) {
      const body = (parsed ?? {}) as { error?: string; message?: string }
      const extra = Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([key]) => key !== 'error' && key !== 'message'))
      throw new CloudError(response.status, body.error ?? `http_${response.status}`, body.message ?? `Carve Cloud returned HTTP ${response.status}`, extra)
    }
    return parsed as T
  }
}

/** Codes that mean the plan's allowance is used up or needs an account: the
 * person's next step is Settings → Account (plans, packs, sign-in), and trying
 * the same request again cannot help. */
export const cloudAllowanceCodes = new Set(['sign_in_required', 'trial_ineligible', 'trial_budget_exhausted', 'guide_budget_exhausted', 'trial_exhausted', 'trial_expired', 'tasks_exhausted', 'guide_exhausted', 'guide_fair_use', 'task_token_cap', 'continuation_unfunded', 'assured_not_allowed'])

/** Plain-language copy for the codes the gateway returns, for the capsule and Settings. */
export function cloudErrorMessage(error: unknown): string {
  if (!(error instanceof CloudError)) return error instanceof Error ? error.message : String(error)
  switch (error.code) {
    case 'sign_in_required': return 'Sign in in Settings → Account to start your free trial. No card is required.'
    case 'trial_ineligible': return 'A free allowance has already been claimed. Choose a plan or contact support.'
    case 'trial_budget_exhausted': return 'Your trial AI allowance is used up. Choose a plan in Settings → Account to continue.'
    case 'guide_budget_exhausted': return 'Your free question allowance is used up for this month.'
    case 'usage_reconciling': return 'Carve is checking the usage from a previous request. Please contact support if this persists.'
    case 'trial_capacity':
    case 'trial_paused': return 'Free usage is temporarily paused. Please try again later; your saved work is available.'
    case 'trial_exhausted': return 'Your free tasks are used up. Upgrade in Settings → Account to keep delegating work.'
    case 'tasks_exhausted': return 'You have used the tasks included this period. Buy a task pack or upgrade in Settings → Account.'
    case 'guide_exhausted': return 'You have used this month’s free Guide questions. Sign in and upgrade for unlimited questions.'
    case 'guide_fair_use': return 'You have reached the fair-use ceiling for Guide questions this period.'
    case 'task_token_cap': return 'This task used its allowance. Use one more task from your plan to continue.'
    case 'continuation_unfunded': return 'No task allowance was available. Add a task pack or upgrade in Settings → Account, then approve again. Your work is still paused.'
    case 'assured_not_allowed': return 'Assured mode is available on Max.'
    case 'breaker_tripped': return 'Carve Cloud paused inference to stay within its spend limits. Try again later.'
    case 'relay_disabled': return 'Your plan uses your own provider key; choose that provider in Settings.'
    case 'unsupported_relay_field':
    case 'purpose_requires_plan':
    case 'trial_model_policy': return 'Carve could not authorize this request. Install the latest Carve update, or contact support@getcarve.app if it continues.'
    case 'cloud_unconfigured': return 'Carve Cloud is not configured for this build.'
    case 'cloud_unreachable': return 'Carve Cloud could not be reached. Check your connection and try again.'
    default: return error.message
  }
}
