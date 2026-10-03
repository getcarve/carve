import type {
  BrowserSandboxFillTarget,
  BrowserSandboxReadTarget,
  BrowserSandboxService,
  BrowserSandboxTarget,
} from '../browser-sandbox.js'
import type { ActionSpec, VerificationSpec } from '../types.js'
import type { ToolAdapter, ToolContext, ToolExecutionResult } from './contracts.js'

const allowedTargets = new Set<BrowserSandboxTarget>(['open-request', 'urgent-review', 'standard-review', 'save-handoff'])
const allowedReadTargets = new Set<BrowserSandboxReadTarget>(['account-tier'])
const allowedFillTargets = new Set<BrowserSandboxFillTarget>(['follow-up-note'])

export class BrowserSandboxClickTool implements ToolAdapter {
  readonly definition = {
    name: 'browser.click',
    family: 'browser' as const,
    description: 'Click one allowlisted semantic control in the isolated local browser sandbox.',
    location: 'local' as const,
    available: true,
    defaultRisk: 'reversible_write' as const,
  }

  constructor(private readonly sandbox: BrowserSandboxService) {}

  async execute(action: ActionSpec, context: ToolContext): Promise<ToolExecutionResult> {
    const target = action.input.target
    if (typeof target !== 'string' || !allowedTargets.has(target as BrowserSandboxTarget)) {
      throw new Error('browser.click target is outside the validated local sandbox allowlist')
    }
    const result = await this.sandbox.click(target as BrowserSandboxTarget, context.signal)
    const trace = await this.sandbox.checkpointTrace(`${context.runId}-${context.actionId}-click`)
    return {
      ok: true,
      summary: `Clicked ${target} in the isolated browser sandbox`,
      output: { target, before: result.before, after: result.after, trace },
    }
  }

  async inspect(verification: VerificationSpec, _context: ToolContext): Promise<unknown> {
    return this.sandbox.inspect(verification.target)
  }

  recoveryContext() {
    return this.sandbox.recoveryContext()
  }
}

export class BrowserSandboxReadTool implements ToolAdapter {
  readonly definition = {
    name: 'browser.read', family: 'browser' as const,
    description: 'Read one allowlisted non-sensitive value in the isolated local browser sandbox.',
    location: 'local' as const, available: true, defaultRisk: 'read_only' as const,
  }

  constructor(private readonly sandbox: BrowserSandboxService) {}

  async execute(action: ActionSpec, context: ToolContext): Promise<ToolExecutionResult> {
    const target = action.input.target
    if (typeof target !== 'string' || !allowedReadTargets.has(target as BrowserSandboxReadTarget)) throw new Error('browser.read target is outside the non-sensitive allowlist')
    const value = await this.sandbox.read(target as BrowserSandboxReadTarget, context.signal)
    const trace = await this.sandbox.checkpointTrace(`${context.runId}-${context.actionId}-read`)
    return { ok: true, summary: `Read ${target} from the isolated browser sandbox`, output: { target, value, trace } }
  }

  inspect(verification: VerificationSpec, _context: ToolContext): Promise<unknown> {
    return this.sandbox.inspect(verification.target)
  }

  recoveryContext() {
    return this.sandbox.recoveryContext()
  }
}

export class BrowserSandboxFillTool implements ToolAdapter {
  readonly definition = {
    name: 'browser.fill', family: 'browser' as const,
    description: 'Fill the single allowlisted non-secret note field in the isolated local browser sandbox.',
    location: 'local' as const, available: true, defaultRisk: 'reversible_write' as const,
  }

  constructor(private readonly sandbox: BrowserSandboxService) {}

  async execute(action: ActionSpec, context: ToolContext): Promise<ToolExecutionResult> {
    const target = action.input.target
    const value = action.input.value
    if (typeof target !== 'string' || !allowedFillTargets.has(target as BrowserSandboxFillTarget)) throw new Error('browser.fill target is outside the safe-field allowlist')
    if (typeof value !== 'string') throw new Error('browser.fill requires a string value')
    const result = await this.sandbox.fill(target as BrowserSandboxFillTarget, value, context.signal)
    const trace = await this.sandbox.checkpointTrace(`${context.runId}-${context.actionId}-fill`)
    return { ok: true, summary: `Filled ${target} in the isolated browser sandbox`, output: { target, before: result.before, after: result.after, trace } }
  }

  inspect(verification: VerificationSpec, _context: ToolContext): Promise<unknown> {
    return this.sandbox.inspect(verification.target)
  }

  recoveryContext() {
    return this.sandbox.recoveryContext()
  }
}
