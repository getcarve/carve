import type { ActionRisk, ActionSpec, VerificationSpec } from '../types.js'
import type { PublicLookupEvidence } from '../public-web.js'

export type ToolFamily = 'computer' | 'screenshot' | 'browser' | 'shell' | 'filesystem' | 'application'
export type BackendLocation = 'local' | 'remote' | 'mock'

export interface ToolDefinition {
  name: string
  family: ToolFamily
  description: string
  location: BackendLocation
  available: boolean
  defaultRisk: ActionRisk
}

export interface ToolContext {
  runId: string
  actionId: string
  signal: AbortSignal
}

export interface ToolExecutionResult {
  ok: boolean
  summary: string
  output: Record<string, unknown>
  producedArtifact?: string
  publicLookup?: PublicLookupEvidence
}

export interface ToolAdapter {
  readonly definition: ToolDefinition
  execute(action: ActionSpec, context: ToolContext): Promise<ToolExecutionResult>
  inspect(verification: VerificationSpec, context: ToolContext): Promise<unknown>
  recoveryContext?(): Promise<Record<string, string | number | boolean | null>>
}

export interface ComputerBackend {
  readonly location: BackendLocation
  screenshot(): Promise<{ mediaType: 'image/png'; bytes: Uint8Array; capturedAt: string }>
  activeWindow(): Promise<{ application: string; title: string }>
  click(point: { x: number; y: number }, signal: AbortSignal): Promise<void>
  typeText(text: string, signal: AbortSignal): Promise<void>
}

export interface BrowserBackend {
  readonly location: BackendLocation
  inspect(): Promise<{ url: string; title: string; accessibilitySnapshot?: unknown }>
  navigate(url: string, signal: AbortSignal): Promise<void>
}

export interface ShellBackend {
  readonly location: BackendLocation
  run(argv: string[], workingDirectory: string, signal: AbortSignal): Promise<{ exitCode: number; stdout: string; stderr: string }>
}

export interface FilesystemBackend {
  readonly location: BackendLocation
  read(relativePath: string): Promise<Uint8Array>
  write(relativePath: string, bytes: Uint8Array, signal: AbortSignal): Promise<void>
}

export const toolSurface: ToolDefinition[] = [
  { name: 'computer.click', family: 'computer', description: 'Inject a pointer click through a configured computer backend.', location: 'local', available: false, defaultRisk: 'reversible_write' },
  { name: 'computer.type', family: 'computer', description: 'Inject text through a configured computer backend.', location: 'local', available: false, defaultRisk: 'sensitive' },
  { name: 'computer.screenshot', family: 'screenshot', description: 'Capture current visual state with explicit OS permission.', location: 'local', available: false, defaultRisk: 'read_only' },
  { name: 'browser.click', family: 'browser', description: 'Click an allowlisted semantic element in a configured browser backend.', location: 'local', available: false, defaultRisk: 'reversible_write' },
  { name: 'browser.read', family: 'browser', description: 'Read one allowlisted non-sensitive semantic value in a configured browser backend.', location: 'local', available: false, defaultRisk: 'read_only' },
  { name: 'browser.fill', family: 'browser', description: 'Fill one allowlisted non-secret field in a configured browser backend.', location: 'local', available: false, defaultRisk: 'reversible_write' },
  { name: 'browser.navigate', family: 'browser', description: 'Open a context-grounded URL in an isolated local browser tab.', location: 'local', available: false, defaultRisk: 'reversible_write' },
  { name: 'shell.run', family: 'shell', description: 'Execute an allowlisted argv vector without a shell.', location: 'local', available: false, defaultRisk: 'sensitive' },
  { name: 'filesystem.read', family: 'filesystem', description: 'Read from an allowlisted workspace root.', location: 'local', available: false, defaultRisk: 'read_only' },
  { name: 'application.invoke', family: 'application', description: 'Invoke a typed application-specific action.', location: 'remote', available: false, defaultRisk: 'sensitive' },
]
