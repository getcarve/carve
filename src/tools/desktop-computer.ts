import { spawn } from 'node:child_process'
import type { ActionSpec, VerificationSpec } from '../types.js'
import type { ToolAdapter, ToolContext, ToolExecutionResult } from './contracts.js'

/**
 * The small, deliberately bounded desktop-control seam used by Work.  It is
 * not a shell and it never accepts an argv vector from a plan: the only
 * operation is opening one already-bound HTTP(S) location in the person's
 * default browser.  This lets Recall resume a remembered page even when the
 * original capture did not retain its address.
 */
export interface DesktopComputerBackend {
  openUrl(url: string, signal: AbortSignal): Promise<void>
}

/** macOS implementation used only by the Electron desktop host. */
export class MacOSDesktopComputerBackend implements DesktopComputerBackend {
  async openUrl(url: string, signal: AbortSignal): Promise<void> {
    if (process.platform !== 'darwin') throw new Error('Desktop computer use requires macOS')
    if (signal.aborted) throw new Error('Computer action was stopped before it began')
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn('/usr/bin/open', [url], { stdio: 'ignore' })
      const stop = () => { child.kill('SIGTERM') }
      signal.addEventListener('abort', stop, { once: true })
      child.once('error', (error) => {
        signal.removeEventListener('abort', stop)
        reject(error)
      })
      child.once('close', (code) => {
        signal.removeEventListener('abort', stop)
        if (signal.aborted) return reject(new Error('Computer action was stopped'))
        if (code !== 0) return reject(new Error(`macOS could not open the requested page (exit ${code ?? 'unknown'})`))
        resolvePromise()
      })
    })
  }
}

export class DesktopOpenUrlTool implements ToolAdapter {
  readonly definition = {
    name: 'computer.open_url',
    family: 'computer' as const,
    description: 'Open an exact recalled URL or a disclosed recall search in the default browser.',
    location: 'local' as const,
    available: true,
    defaultRisk: 'reversible_write' as const,
  }

  private lastOpenedUrl: string | null = null

  constructor(private readonly computer: DesktopComputerBackend) {}

  async execute(action: ActionSpec, context: ToolContext): Promise<ToolExecutionResult> {
    const url = validateUrl(action.input.url)
    const mode = action.input.mode
    if (mode !== 'exact' && mode !== 'search') throw new Error('computer.open_url requires exact or search mode')
    await this.computer.openUrl(url, context.signal)
    this.lastOpenedUrl = url
    return {
      ok: true,
      summary: mode === 'exact' ? 'Opened the exact recalled page in the default browser' : 'Opened a disclosed search for the recalled page in the default browser',
      output: { url, mode },
    }
  }

  inspect(verification: VerificationSpec, _context: ToolContext): Promise<unknown> {
    return Promise.resolve(verification.target === 'last_opened_url' ? this.lastOpenedUrl : null)
  }

  recoveryContext(): Promise<Record<string, string | number | boolean | null>> {
    return Promise.resolve({ desktop: 'default_browser', lastOpenedUrl: this.lastOpenedUrl })
  }
}

function validateUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4_096) throw new Error('computer.open_url requires a bounded URL')
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('computer.open_url requires an absolute HTTP(S) URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('computer.open_url only supports HTTP(S) URLs')
  return parsed.href
}
