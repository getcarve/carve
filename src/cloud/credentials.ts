import { createHash, randomUUID } from 'node:crypto'
import type { CarveDatabase } from '../db.js'
import { CloudCredentialError, type CloudCredentialStore } from './credential-store.js'

export interface CloudCredentials {
  version: 1
  deviceId: string | null
  deviceToken: string | null
  sessionToken: string | null
}
const empty = (): CloudCredentials => ({ version: 1, deviceId: null, deviceToken: null, sessionToken: null })
const digest = (text: string) => createHash('sha256').update(text).digest('hex')

/** Owns migration and an in-memory credential cache. All I/O is explicit and
 * asynchronous; synchronous status/render paths never open the Keychain. */
export class CloudCredentialsVault {
  readonly scope: string
  readonly settingsPrefix: string
  private cached: CloudCredentials | null = null
  private loading: Promise<void> | null = null
  private writes: Promise<void> = Promise.resolve()
  private unavailable = false

  constructor(private readonly db: CarveDatabase, private readonly store: CloudCredentialStore, readonly origin: string) {
    let profile = db.getSetting('cloud.credentials.profile_id')
    if (!profile) { profile = randomUUID(); db.setSetting('cloud.credentials.profile_id', profile) }
    this.scope = digest(JSON.stringify([origin, profile]))
    this.settingsPrefix = `cloud.${digest(origin)}.`
    const scopes = knownScopes(db)
    if (!scopes.includes(this.scope)) db.setSetting('cloud.credentials.scopes', JSON.stringify([...scopes, this.scope]))
  }

  status(): 'not_loaded' | 'available' | 'unavailable' {
    return this.unavailable ? 'unavailable' : this.cached ? 'available' : 'not_loaded'
  }

  snapshot(): CloudCredentials | null { return this.cached ? { ...this.cached } : null }

  async ready(): Promise<void> {
    if (this.cached) return
    if (!this.loading) this.loading = this.load().finally(() => { this.loading = null })
    return this.loading
  }

  private async load(): Promise<void> {
    try {
      const raw = await this.store.read(this.scope)
      let value = raw === null ? empty() : parseCredentials(raw)
      // A single original endpoint owns migration of the old unscoped settings.
      let legacyOrigin = this.db.getSetting('cloud.credentials.legacy_origin')
      if (!legacyOrigin) {
        legacyOrigin = this.origin
        this.db.setSetting('cloud.credentials.legacy_origin', legacyOrigin)
      }
      if (legacyOrigin === this.origin && this.db.getSetting('cloud.credentials.legacy_cleared') !== '1') {
        const legacyDevice = this.db.getSetting('cloud.device_token') || null
        const legacySession = this.db.getSetting('cloud.session_token') || null
        if (raw === null && (legacyDevice || legacySession)) {
          value = parseCredentials(JSON.stringify({ version: 1, deviceId: this.db.getSetting('cloud.device_id') || null, deviceToken: legacyDevice, sessionToken: legacySession }))
          if (this.sessionBlocked()) value.sessionToken = null
          await this.persist(value)
        }
        // A prior verified Keychain write wins over stale SQLite data after a
        // crash. Erase only once the authoritative record was read successfully.
        this.db.eraseLegacyCloudCredentials()
        this.db.setSetting('cloud.credentials.legacy_cleared', '1')
      }
      if (this.sessionBlocked() && value.sessionToken) {
        value.sessionToken = null
        await this.persist(value)
      }
      this.cached = value
      this.unavailable = false
    } catch {
      this.cached = null
      this.unavailable = true
      throw new CloudCredentialError()
    }
  }

  async update(patch: Partial<Omit<CloudCredentials, 'version'>>): Promise<void> {
    const work = this.writes.then(async () => {
      await this.ready()
      const value = { ...this.cached!, ...patch }
      const changesSession = patch.sessionToken !== undefined
      // A persistent local logout marker wins even if Keychain writes fail or
      // the process exits. A verified new login alone can clear it.
      if (changesSession) this.db.setSetting(`${this.settingsPrefix}session_blocked`, '1')
      try {
        await this.persist(value)
        if (changesSession && patch.sessionToken) this.db.setSetting(`${this.settingsPrefix}session_blocked`, '0')
        this.cached = value
        this.unavailable = false
      } catch {
        this.cached = null
        this.unavailable = true
        throw new CloudCredentialError()
      }
    })
    this.writes = work.catch(() => {})
    return work
  }

  /** Local authority is removed before waiting on any Keychain or network I/O. */
  blockSession(): void {
    this.db.setSetting(`${this.settingsPrefix}session_blocked`, '1')
    if (this.cached) this.cached.sessionToken = null
  }

  private sessionBlocked(): boolean { return this.db.getSetting(`${this.settingsPrefix}session_blocked`) === '1' }

  private async persist(value: CloudCredentials): Promise<void> {
    const serialized = JSON.stringify(parseCredentials(JSON.stringify(value)))
    await this.store.write(this.scope, serialized)
    // Never remove the plaintext source before a successful read-back.
    if (await this.store.read(this.scope) !== serialized) throw new CloudCredentialError()
  }
}

function parseCredentials(raw: string): CloudCredentials {
  const value = JSON.parse(raw) as CloudCredentials
  if (!value || value.version !== 1 || !valid(value.deviceId, 'dev_') || !valid(value.deviceToken, 'sd_') || !valid(value.sessionToken, 'ss_')) throw new CloudCredentialError()
  if (Boolean(value.deviceId) !== Boolean(value.deviceToken)) throw new CloudCredentialError()
  return { version: 1, deviceId: value.deviceId, deviceToken: value.deviceToken, sessionToken: value.sessionToken }
}
function valid(value: unknown, prefix: string): value is string | null {
  return value === null || (typeof value === 'string' && value.startsWith(prefix) && value.length <= 256 && /^[A-Za-z0-9_-]+$/u.test(value))
}


function knownScopes(db: CarveDatabase): string[] {
  const values: unknown = JSON.parse(db.getSetting('cloud.credentials.scopes') || '[]')
  if (!Array.isArray(values) || !values.every(value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value))) throw new CloudCredentialError()
  return values as string[]
}

/** Full local-data deletion includes this profile's Keychain entries for every
 * previously used endpoint. Leave the registry until every delete is verified. */
export async function eraseCloudKeychainItems(db: CarveDatabase, store: CloudCredentialStore): Promise<void> {
  try {
    for (const scope of knownScopes(db)) {
      await store.delete(scope)
      if (await store.read(scope) !== null) throw new CloudCredentialError()
    }
  } catch { throw new CloudCredentialError() }
}
