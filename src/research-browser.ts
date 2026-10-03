import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Browser, BrowserContext, Page, Route } from 'playwright-core'

export interface ResearchBrowserNavigation {
  requestedUrl: string
  finalUrl: string
  title: string
  allowedDomain: string
  openedAt: string
}

/**
 * A deliberately small browser boundary for context-grounded research.
 *
 * The planner may only bind a URL from a context receipt. The adapter repeats
 * that receipt's host constraint here, at the final I/O boundary, and rejects
 * cross-domain redirects. Each approved action opens a separate tab so a user
 * can inspect the selected set and stop the run at any point.
 */
export class ResearchBrowserService {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private current: ResearchBrowserNavigation | null = null
  private readonly pages = new Set<Page>()

  constructor(private readonly enabled: boolean) {}

  summary(): { enabled: boolean; available: boolean; current: ResearchBrowserNavigation | null } {
    return { enabled: this.enabled, available: this.enabled && chromeExecutable() !== null, current: this.current }
  }

  async navigate(rawUrl: string, rawAllowedDomain: string, signal: AbortSignal): Promise<ResearchBrowserNavigation> {
    if (!this.enabled) throw new Error('Research browser capability is disabled')
    if (signal.aborted) throw new Error('Browser navigation was stopped before it began')
    const requested = validatedUrl(rawUrl)
    const allowedDomain = normalizedDomain(rawAllowedDomain)
    requireAllowedHost(requested.hostname, allowedDomain, 'Requested URL')

    const context = await this.ensureReady()
    const page = await context.newPage()
    this.pages.add(page)
    page.once('close', () => this.pages.delete(page))
    await page.route('**/*', (route) => enforceRoute(route, allowedDomain))

    const stop = () => { void page.close().catch(() => undefined) }
    signal.addEventListener('abort', stop, { once: true })
    try {
      await page.goto(requested.href, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      if (signal.aborted) throw new Error('Browser navigation was stopped')
      const finalUrl = validatedUrl(page.url())
      requireAllowedHost(finalUrl.hostname, allowedDomain, 'Final URL')
      const navigation: ResearchBrowserNavigation = {
        requestedUrl: requested.href,
        finalUrl: finalUrl.href,
        title: await page.title(),
        allowedDomain,
        openedAt: new Date().toISOString(),
      }
      this.current = navigation
      await page.bringToFront()
      return navigation
    } catch (error) {
      await page.close().catch(() => undefined)
      throw error
    } finally {
      signal.removeEventListener('abort', stop)
    }
  }

  inspect(target: string): string | null {
    if (target === 'url') return this.current?.finalUrl ?? null
    if (target === 'title') return this.current?.title ?? null
    return null
  }

  recoveryContext(): Record<string, string | number | boolean | null> {
    return {
      browser: 'isolated_context_grounded_research',
      openTabs: this.pages.size,
      url: this.current?.finalUrl ?? null,
      title: this.current?.title ?? null,
      allowedDomain: this.current?.allowedDomain ?? null,
    }
  }

  async close(): Promise<void> {
    const pages = [...this.pages]
    const context = this.context
    const browser = this.browser
    this.pages.clear()
    this.context = null
    this.browser = null
    this.current = null
    await Promise.all(pages.map((page) => page.close().catch(() => undefined)))
    await context?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
  }

  private async ensureReady(): Promise<BrowserContext> {
    if (this.context) return this.context
    const executablePath = chromeExecutable()
    if (!executablePath) throw new Error('No supported local Chrome or Chromium executable is available')
    const { chromium } = await import('playwright-core')
    this.browser = await chromium.launch({
      executablePath,
      headless: process.env.NODE_ENV === 'test' || process.env.STEWARD_RESEARCH_BROWSER_HEADLESS === 'true',
      args: ['--disable-background-networking', '--disable-sync', '--no-first-run', '--no-default-browser-check'],
    })
    this.context = await this.browser.newContext({
      acceptDownloads: false,
      serviceWorkers: 'block',
      viewport: { width: 1280, height: 900 },
    })
    return this.context
  }
}

function validatedUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('browser.navigate requires an absolute URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('browser.navigate only supports HTTP(S) URLs')
  url.hash = ''
  return url
}

function normalizedDomain(rawDomain: string): string {
  const domain = rawDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, '')
  if (!domain || !/^[a-z0-9.-]+$/.test(domain) || domain.includes('..')) throw new Error('browser.navigate requires a valid allowedDomain')
  return domain
}

function requireAllowedHost(rawHost: string, allowedDomain: string, label: string): void {
  const host = rawHost.toLowerCase().replace(/\.$/, '')
  if (host !== allowedDomain && !host.endsWith(`.${allowedDomain}`)) {
    throw new Error(`${label} is outside the context-approved domain ${allowedDomain}`)
  }
}

async function enforceRoute(route: Route, allowedDomain: string): Promise<void> {
  try {
    const url = new URL(route.request().url())
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue()
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return route.abort('blockedbyclient')
    requireAllowedHost(url.hostname, allowedDomain, 'Browser request')
    await route.continue()
  } catch {
    await route.abort('blockedbyclient').catch(() => undefined)
  }
}

function chromeExecutable(): string | null {
  const candidates = [
    process.env.STEWARD_CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find((candidate) => existsSync(resolve(candidate))) ?? null
}
