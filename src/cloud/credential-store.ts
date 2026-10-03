import { spawn } from 'node:child_process'

export class CloudCredentialError extends Error {
  readonly code = 'cloud_credentials_unavailable'
  constructor() {
    super('Carve cannot access its saved account in macOS Keychain. Unlock your login keychain and retry. If access is denied, open Keychain Access and check the Carve Cloud account item.')
    this.name = 'CloudCredentialError'
  }
}

/** Store values are private JSON, never a renderer/IPC payload or log field. */
export interface CloudCredentialStore {
  read(account: string): Promise<string | null>
  write(account: string, value: string): Promise<void>
  delete(account: string): Promise<void>
}

/** Only explicitly injected in tests/local development. No on-disk fallback. */
export class MemoryCloudCredentialStore implements CloudCredentialStore {
  private readonly items = new Map<string, string>()
  async read(account: string): Promise<string | null> { return this.items.get(account) ?? null }
  async write(account: string, value: string): Promise<void> { this.items.set(account, value) }
  async delete(account: string): Promise<void> { this.items.delete(account) }
}

/** A dedicated Security.framework helper owns the Keychain item. Secrets travel
 * through private pipes, never argv, environment, files, logs, or the renderer. */
export class MacOSCloudCredentialStore implements CloudCredentialStore {
  constructor(private readonly helperPath: string) {}

  async read(account: string): Promise<string | null> {
    return (await this.request({ action: 'read', account })).value ?? null
  }

  async write(account: string, value: string): Promise<void> {
    await this.request({ action: 'write', account, value })
  }

  async delete(account: string): Promise<void> { await this.request({ action: 'delete', account }) }

  private request(payload: { action: string; account: string; value?: string }): Promise<{ value?: string | null }> {
    if (process.platform !== 'darwin') return Promise.reject(new CloudCredentialError())
    return new Promise((resolve, reject) => {
      const child = spawn(this.helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } })
      const output: Buffer[] = []
      let bytes = 0
      let finished = false
      const finish = (value?: { value?: string | null }) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        if (value) resolve(value)
        else reject(new CloudCredentialError())
      }
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish() }, 10_000)
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > 16_384) { child.kill('SIGKILL'); finish(); return }
        output.push(chunk)
      })
      child.stderr.on('data', () => { /* Never propagate native output that could include a credential. */ })
      child.stdin.on('error', () => finish())
      child.once('error', () => finish())
      child.once('close', code => {
        try {
          const result = JSON.parse(Buffer.concat(output).toString('utf8')) as { ok?: boolean; value?: unknown }
          if (code !== 0 || result.ok !== true || (result.value != null && typeof result.value !== 'string')) return finish()
          finish(typeof result.value === 'string' ? { value: result.value } : {})
        } catch { finish() }
      })
      child.stdin.end(JSON.stringify(payload))
    })
  }
}
