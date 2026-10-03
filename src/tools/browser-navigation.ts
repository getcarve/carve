import type { ResearchBrowserService } from '../research-browser.js'
import type { ActionSpec, VerificationSpec } from '../types.js'
import type { ToolAdapter, ToolContext, ToolExecutionResult } from './contracts.js'

/** Typed adapter for the only browser navigation Carve currently permits:
 * an exact URL plus the domain constraint carried by a context receipt. */
export class BrowserNavigateTool implements ToolAdapter {
  readonly definition = {
    name: 'browser.navigate',
    family: 'browser' as const,
    description: 'Open a context-grounded URL in an isolated local browser tab.',
    location: 'local' as const,
    available: true,
    defaultRisk: 'reversible_write' as const,
  }

  constructor(private readonly browser: ResearchBrowserService) {}

  async execute(action: ActionSpec, context: ToolContext): Promise<ToolExecutionResult> {
    const url = action.input.url
    const allowedDomain = action.input.allowedDomain
    if (typeof url !== 'string' || typeof allowedDomain !== 'string') {
      throw new Error('browser.navigate requires string url and allowedDomain receipt fields')
    }
    const navigation = await this.browser.navigate(url, allowedDomain, context.signal)
    return {
      ok: true,
      summary: `Opened ${navigation.title || navigation.finalUrl} in an isolated browser tab`,
      output: { ...navigation },
    }
  }

  inspect(verification: VerificationSpec, _context: ToolContext): Promise<unknown> {
    return Promise.resolve(this.browser.inspect(verification.target))
  }

  recoveryContext(): Promise<Record<string, string | number | boolean | null>> {
    return Promise.resolve(this.browser.recoveryContext())
  }
}
