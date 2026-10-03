import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { Browser, BrowserContext, Download, Page } from 'playwright-core'
import { chromium } from 'playwright-core'
import type { ComputerActionModifier, ComputerActionProposal, ComputerActionScreenshot } from '../providers/types.js'
import type { UniversalComputerUseBackend, UniversalComputerUseSettleRequest, UniversalComputerUseSettleResult } from './universal.js'
import { compareVisibleState } from './visual-stability.js'

export interface PlaywrightComputerUseBackendOptions {
  initialUrl: string
  allowedHosts?: string[]
  executablePath?: string
  headless?: boolean
  width?: number
  height?: number
  settleMs?: number
  settleStableFrames?: number
  settleMaxMs?: number
  /** Explicit artifact receiver. Caller owns destination, file limits and
   * validation. Without a receiver, downloads remain disabled. */
  onDownload?: (download: Download) => Promise<void>
}

/** Disposable browser target for the Universal-mode proof harness. */
export class PlaywrightComputerUseBackend implements UniversalComputerUseBackend {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private lastObservation: ComputerActionScreenshot | null = null
  private captureSequence = 0
  private downloads = { pending: new Set<Promise<void>>(), completed: 0, failed: 0, failure: null as Error | null }
  private readonly width: number
  private readonly height: number
  private readonly allowedHosts: Set<string>

  constructor(private readonly options: PlaywrightComputerUseBackendOptions) {
    const initial = validatedUrl(options.initialUrl)
    this.width = boundedViewport(options.width ?? 1280, 'width')
    this.height = boundedViewport(options.height ?? 800, 'height')
    this.allowedHosts = new Set([initial.hostname, ...(options.allowedHosts ?? []).map((host) => validatedHost(host))])
  }

  async start(): Promise<void> {
    if (this.browser) throw new Error('The disposable computer-use browser is already running')
    this.downloads = { pending: new Set(), completed: 0, failed: 0, failure: null }
    const executablePath = this.options.executablePath ?? process.env.STEWARD_CHROME_PATH ?? findChromiumExecutable()
    if (!executablePath) throw new Error('No Chromium browser was found. Set STEWARD_CHROME_PATH to a Chrome or Chromium executable.')
    this.browser = await chromium.launch({
      executablePath,
      headless: this.options.headless ?? true,
      env: {},
      args: [
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-file-system',
        // This surface cannot observe native pickers. Let sites detect that
        // local-file access is unavailable and use ordinary download controls.
        // Origin-private storage remains available for web application data.
        '--disable-blink-features=FileSystemAccessLocal',
        '--disable-sync',
        '--no-first-run',
      ],
    })
    this.context = await this.browser.newContext({
      viewport: { width: this.width, height: this.height },
      deviceScaleFactor: 1,
      locale: 'en-US',
      acceptDownloads: !!this.options.onDownload,
      serviceWorkers: 'block',
    })
    await this.context.route('**/*', async (route) => {
      if (this.urlAllowed(route.request().url())) await route.continue()
      else await route.abort('blockedbyclient')
    })
    this.page = await this.context.newPage()
    this.context.on('page', (page) => {
      if (page !== this.page) void page.close().catch(() => undefined)
    })
    this.page.on('dialog', (dialog) => { void dialog.dismiss() })
    const downloads = this.downloads
    this.page.on('download', (download) => {
      const task = Promise.resolve().then(async () => {
        if (this.options.onDownload) {
          await this.options.onDownload(download)
          downloads.completed++
        } else {
          await download.cancel()
          downloads.failed++
        }
      }).catch(error => {
        downloads.failed++
        downloads.failure ??= error instanceof Error ? error : new Error(String(error))
      })
      downloads.pending.add(task)
      void task.then(() => downloads.pending.delete(task))
    })
    await this.page.goto(this.options.initialUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await this.settlePage()
  }

  async capture(signal: AbortSignal): Promise<ComputerActionScreenshot> {
    return this.capturePage(signal)
  }

  private async capturePage(signal: AbortSignal): Promise<ComputerActionScreenshot> {
    this.assertReady(signal)
    const page = this.requirePage()
    this.assertCurrentUrl()
    const png = await page.screenshot({ type: 'png' })
    if (signal.aborted) throw new Error('Computer-use capture was cancelled')
    this.captureSequence += 1
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`
    const observation: ComputerActionScreenshot = {
      dataUrl,
      evidenceId: `universal-${randomUUID()}-${this.captureSequence}`,
      width: this.width,
      height: this.height,
      sha256: createHash('sha256').update(png).digest('hex'),
      visualSample: null,
    }
    this.lastObservation = observation
    return observation
  }

  async execute(action: ComputerActionProposal, signal: AbortSignal): Promise<void> {
    this.assertReady(signal)
    const page = this.requirePage()
    this.assertCurrentUrl()
    switch (action.kind) {
      case 'click':
      case 'double_click':
        if (action.button === 'back' || action.button === 'forward') throw new Error(`The Playwright backend does not support ${action.button} mouse buttons`)
        await this.withModifiers(action.modifiers, async () => {
          await page.mouse.click(action.point.x, action.point.y, {
            button: playwrightButton(action.button),
            clickCount: action.kind === 'double_click' ? 2 : 1,
          })
        })
        break
      case 'move':
        await this.withModifiers(action.modifiers, async () => { await page.mouse.move(action.point.x, action.point.y) })
        break
      case 'scroll':
        await this.withModifiers(action.modifiers, async () => {
          await page.mouse.move(action.point.x, action.point.y)
          await page.mouse.wheel(action.deltaX, action.deltaY)
        })
        break
      case 'type':
        await page.keyboard.insertText(action.text)
        break
      case 'keypress':
        await page.keyboard.press(playwrightChord(action.keys))
        break
      case 'drag':
        await this.withModifiers(action.modifiers, async () => {
          const first = action.path[0]!
          await page.mouse.move(first.x, first.y)
          await page.mouse.down()
          try {
            for (const point of action.path.slice(1)) await page.mouse.move(point.x, point.y, { steps: 2 })
          } finally {
            await page.mouse.up()
          }
        })
        break
      case 'wait':
        await page.waitForTimeout(1_000)
        break
      case 'screenshot':
        break
    }
    if (signal.aborted) throw new Error('Computer-use input was cancelled')
    this.assertCurrentUrl()
  }

  async settle(_request: UniversalComputerUseSettleRequest, signal: AbortSignal): Promise<UniversalComputerUseSettleResult> {
    this.assertReady(signal)
    const startedAt = Date.now()
    const pollMs = boundedTiming(this.options.settleMs ?? 200, 1, 1_000)
    const maximumMs = boundedTiming(this.options.settleMaxMs ?? 3_000, pollMs, 10_000)
    const stableTarget = boundedTiming(this.options.settleStableFrames ?? 2, 1, 10)
    await this.requirePage().waitForLoadState('domcontentloaded', { timeout: Math.min(maximumMs, 1_000) }).catch(() => undefined)
    let previous: ComputerActionScreenshot | null = this.lastObservation
    let latest: ComputerActionScreenshot | null = null
    let stableFrames = 0
    let probes = 0
    while (Date.now() - startedAt < maximumMs && stableFrames < stableTarget) {
      await this.requirePage().waitForTimeout(pollMs)
      latest = await this.capturePage(signal)
      probes += 1
      const change = previous
        ? compareVisibleState(previous.sha256, previous.visualSample, latest)
        : 'unknown'
      stableFrames = change === 'unchanged' ? stableFrames + 1 : 0
      previous = latest
    }
    this.assertCurrentUrl()
    const stabilized = stableFrames >= stableTarget
    return {
      observation: latest,
      durationMs: Math.max(0, Date.now() - startedAt),
      probes,
      stabilized,
      timedOut: !stabilized,
    }
  }

  /** Await artifact delivery before declaring an export saved. Receiver
   * failures stay visible; an emitted download event is not a save receipt. */
  async waitForDownloads(): Promise<void> {
    const downloads = this.downloads
    while (downloads.pending.size) await Promise.all([...downloads.pending])
    if (downloads.failure) throw downloads.failure
  }

  downloadStatus(): { completed: number; pending: number; failed: number } {
    return { completed: this.downloads.completed, pending: this.downloads.pending.size, failed: this.downloads.failed }
  }

  async close(): Promise<void> {
    const context = this.context
    const browser = this.browser
    this.page = null
    this.context = null
    this.browser = null
    this.lastObservation = null
    if (context) await context.close().catch(() => undefined)
    if (browser) await browser.close().catch(() => undefined)
  }

  private async withModifiers(modifiers: ComputerActionModifier[], action: () => Promise<void>): Promise<void> {
    const keyboard = this.requirePage().keyboard
    const keys = modifiers.map(playwrightModifier)
    for (const key of keys) await keyboard.down(key)
    try {
      await action()
    } finally {
      for (const key of [...keys].reverse()) await keyboard.up(key)
    }
  }

  private async settlePage(): Promise<void> {
    const page = this.requirePage()
    await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined)
    await page.waitForTimeout(this.options.settleMs ?? 300)
    this.assertCurrentUrl()
  }

  private assertReady(signal: AbortSignal): void {
    if (!this.page || !this.context || !this.browser) throw new Error('The disposable computer-use browser has not started')
    if (signal.aborted) throw new Error('Computer use was cancelled before browser input')
  }

  private requirePage(): Page {
    if (!this.page) throw new Error('The disposable computer-use browser has not started')
    return this.page
  }

  private assertCurrentUrl(): void {
    const url = this.requirePage().url()
    if (!this.urlAllowed(url)) throw new Error('The browser navigated outside its approved host boundary')
  }

  private urlAllowed(raw: string): boolean {
    try {
      const url = new URL(raw)
      return (url.protocol === 'https:' || url.protocol === 'http:') && this.allowedHosts.has(url.hostname)
    } catch {
      return false
    }
  }
}

function boundedTiming(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.max(minimum, Math.min(maximum, Math.round(value)))
}

export function findChromiumExecutable(): string | null {
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
    : process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function playwrightChord(keys: string[]): string {
  return keys.map((key) => {
    const upper = key.trim().toUpperCase().replace(/[ _-]+/gu, '')
    if (upper === 'CTRL' || upper === 'CONTROL') return 'Control'
    if (upper === 'META' || upper === 'CMD' || upper === 'COMMAND') return 'Meta'
    if (upper === 'ALT' || upper === 'OPTION') return 'Alt'
    if (upper === 'SHIFT') return 'Shift'
    if (upper === 'RETURN' || upper === 'ENTER') return 'Enter'
    if (upper === 'ESC' || upper === 'ESCAPE') return 'Escape'
    if (upper === 'SPACE') return 'Space'
    if (upper.startsWith('ARROW')) return `Arrow${upper.slice(5).toLowerCase().replace(/^./u, (value) => value.toUpperCase())}`
    if (upper === 'PAGEUP') return 'PageUp'
    if (upper === 'PAGEDOWN') return 'PageDown'
    if (upper === 'BACKSPACE') return 'Backspace'
    if (upper === 'DELETE') return 'Delete'
    if (upper === 'HOME') return 'Home'
    if (upper === 'END') return 'End'
    if (key.length === 1) return key.toUpperCase()
    return key
  }).join('+')
}

function playwrightModifier(modifier: ComputerActionModifier): string {
  if (modifier === 'CTRL') return 'Control'
  if (modifier === 'META') return 'Meta'
  if (modifier === 'ALT') return 'Alt'
  return 'Shift'
}

function playwrightButton(button: 'left' | 'right' | 'wheel' | 'back' | 'forward'): 'left' | 'right' | 'middle' {
  if (button === 'wheel') return 'middle'
  if (button === 'left' || button === 'right') return button
  throw new Error(`The Playwright backend does not support ${button} mouse buttons`)
}

function validatedUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The initial browser URL must use HTTP or HTTPS')
  return url
}

function validatedHost(raw: string): string {
  const host = raw.trim().toLowerCase()
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/u.test(host)) throw new Error(`Invalid allowed browser host: ${raw}`)
  return host
}

function boundedViewport(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 320 || value > 8_192) throw new Error(`Browser viewport ${label} must be an integer between 320 and 8192`)
  return value
}
