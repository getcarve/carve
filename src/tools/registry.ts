import type { ActionSpec, VerificationSpec } from '../types.js'
import type { BrowserSandboxService } from '../browser-sandbox.js'
import type { ResearchBrowserService } from '../research-browser.js'
import { SandboxArtifactTool } from './artifact.js'
import { BrowserNavigateTool } from './browser-navigation.js'
import { BrowserSandboxClickTool, BrowserSandboxFillTool, BrowserSandboxReadTool } from './browser-sandbox.js'
import { DesktopOpenUrlTool, type DesktopComputerBackend } from './desktop-computer.js'
import { toolSurface, type ToolAdapter, type ToolContext, type ToolDefinition, type ToolExecutionResult } from './contracts.js'
import { MockComputerTool } from './mock-computer.js'

export class ToolRegistry {
  readonly mockComputer: MockComputerTool
  private readonly adapters: Map<string, ToolAdapter>

  constructor(artifactRoot: string, browserSandbox?: BrowserSandboxService, researchBrowser?: ResearchBrowserService, desktopComputer?: DesktopComputerBackend, additionalAdapters: ToolAdapter[] = []) {
    this.mockComputer = new MockComputerTool()
    const all: ToolAdapter[] = [
      this.mockComputer,
      new SandboxArtifactTool(artifactRoot),
      ...(browserSandbox ? [new BrowserSandboxClickTool(browserSandbox), new BrowserSandboxReadTool(browserSandbox), new BrowserSandboxFillTool(browserSandbox)] : []),
      ...(researchBrowser ? [new BrowserNavigateTool(researchBrowser)] : []),
      ...(desktopComputer ? [new DesktopOpenUrlTool(desktopComputer)] : []),
      ...additionalAdapters,
    ]
    this.adapters = new Map(all.map((adapter) => [adapter.definition.name, adapter]))
  }

  list(): ToolDefinition[] {
    const implemented = [...this.adapters.values()].map((adapter) => adapter.definition)
    return [...implemented, ...toolSurface.filter((definition) => !this.adapters.has(definition.name))]
  }

  available(toolName: string): boolean {
    return this.adapters.has(toolName)
  }

  async execute(action: ActionSpec, context: ToolContext): Promise<ToolExecutionResult> {
    const adapter = this.adapters.get(action.tool)
    if (!adapter) throw new Error(`Tool ${action.tool} is not implemented or configured`)
    return adapter.execute(action, context)
  }

  async inspect(toolName: string, verification: VerificationSpec, context: ToolContext): Promise<unknown> {
    const adapter = this.adapters.get(toolName)
    if (!adapter) throw new Error(`Tool ${toolName} is not implemented or configured`)
    return adapter.inspect(verification, context)
  }

  async recoveryContext(toolName: string): Promise<Record<string, string | number | boolean | null>> {
    const adapter = this.adapters.get(toolName)
    return adapter?.recoveryContext ? adapter.recoveryContext() : {}
  }
}
