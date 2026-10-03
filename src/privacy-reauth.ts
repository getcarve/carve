import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { CarveCommand } from './desktop-contract.js'

export type PrivacyReauthenticationStatus = 'available' | 'unavailable' | 'not_applicable'

export interface PrivacyAuthenticator {
  authenticate(reason: string): Promise<void>
}

interface HelperResponse {
  ok: boolean
  available?: boolean
  authenticated?: boolean
  error?: string
}

export class MacOSPrivacyReauthentication {
  private statusValue: PrivacyReauthenticationStatus = process.platform === 'darwin' ? 'unavailable' : 'not_applicable'

  constructor(private readonly helperPath: string) {}

  status(): PrivacyReauthenticationStatus { return this.statusValue }

  async refreshStatus(): Promise<PrivacyReauthenticationStatus> {
    if (process.platform !== 'darwin') return this.statusValue = 'not_applicable'
    if (!existsSync(this.helperPath)) return this.statusValue = 'unavailable'
    try {
      const response = await this.request({ action: 'status' }, 10_000)
      return this.statusValue = response.ok && response.available === true ? 'available' : 'unavailable'
    } catch {
      return this.statusValue = 'unavailable'
    }
  }

  async authenticate(reason: string): Promise<void> {
    if (process.platform !== 'darwin') throw new Error('OS user-presence verification is currently implemented only on macOS')
    if (!existsSync(this.helperPath)) throw new Error('Privacy authentication helper is unavailable')
    const response = await this.request({ action: 'authenticate', reason }, 120_000)
    if (!response.ok || response.authenticated !== true) throw new Error(response.error ?? 'OS user-presence verification failed')
  }

  private request(payload: Record<string, string>, timeoutMs: number): Promise<HelperResponse> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(this.helperPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin' },
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let outputBytes = 0
      let settled = false
      const finish = (error?: Error, response?: HelperResponse) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else if (response) resolvePromise(response)
        else reject(new Error('Privacy authentication helper returned no response'))
      }
      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        outputBytes += chunk.length
        if (outputBytes > 32_768) {
          child.kill('SIGKILL')
          finish(new Error('Privacy authentication helper response exceeded 32 KB'))
          return
        }
        target.push(chunk)
      }
      child.stdout.on('data', collect(stdout))
      child.stderr.on('data', collect(stderr))
      child.once('error', (error) => finish(error))
      child.once('close', (code) => {
        try {
          const parsed = JSON.parse(Buffer.concat(stdout).toString('utf8')) as HelperResponse
          const helperError = parsed.error ?? (Buffer.concat(stderr).toString('utf8').trim() || `Privacy authentication helper exited with ${code}`)
          if (code !== 0 || !parsed.ok) return finish(new Error(helperError))
          finish(undefined, parsed)
        } catch {
          finish(new Error(Buffer.concat(stderr).toString('utf8').trim() || 'Privacy authentication helper returned invalid JSON'))
        }
      })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish(new Error('OS user-presence verification timed out'))
      }, timeoutMs)
      timer.unref()
      child.stdin.end(JSON.stringify(payload))
    })
  }
}

export function privacyReauthenticationReason(command: CarveCommand): string | null {
  if (command.kind === 'data.export') return 'Approve exporting your complete Carve history'
  if (command.kind === 'data.purge') return 'Approve permanently deleting all local Carve data'
  if (command.kind === 'evaluation.live_mac.authorize_and_run') return 'Approve the exact live Mac canary run'
  return null
}

/** Every protected command invokes the authenticator anew; this intentionally
 * has no session, grace period, or cached-success state. */
export async function verifyPrivacyReauthentication(command: CarveCommand, authenticator: PrivacyAuthenticator): Promise<boolean> {
  const reason = privacyReauthenticationReason(command)
  if (!reason) return false
  await authenticator.authenticate(reason)
  return true
}
