import type { ActionSpec, VerificationSpec } from '../types.js'
import type { ToolAdapter, ToolContext, ToolExecutionResult } from './contracts.js'

export class MockComputerTool implements ToolAdapter {
  readonly definition = {
    name: 'mock.set_state',
    family: 'application' as const,
    description: 'Set one key in an isolated, in-memory demo computer state.',
    location: 'mock' as const,
    available: true,
    defaultRisk: 'safe' as const,
  }

  private readonly state = new Map<string, string | number | boolean>()

  async execute(action: ActionSpec, context: ToolContext): Promise<ToolExecutionResult> {
    if (context.signal.aborted) throw new Error('Execution cancelled')
    const key = action.input.key
    const value = action.input.value
    if (typeof key !== 'string' || !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error('mock.set_state requires a string key and scalar value')
    }
    this.state.set(key, value as string | number | boolean)
    return { ok: true, summary: `Mock state ${key} updated`, output: { key, value } }
  }

  async inspect(verification: VerificationSpec, _context: ToolContext): Promise<unknown> {
    return this.state.get(verification.target) ?? null
  }

  forceState(key: string, value: string | number | boolean): void {
    this.state.set(key, value)
  }
}
