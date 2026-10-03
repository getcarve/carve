import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, type WriteFileOptions } from 'node:fs'
import { basename, resolve } from 'node:path'

export interface EvaluationSpendLedgerOptions {
  root: string
  sessionId: string
  maxCostUsd: number
  providerId: string
  model: string
}

export interface EvaluationSpendLedgerSnapshot {
  schemaVersion: 1
  sessionId: string
  maxCostUsd: number
  spentCostUsd: number
  inputTokens: number
  outputTokens: number
  completedCalls: number
  usageUnknown: boolean
  providerId: string
  model: string
  createdAt: string
  updatedAt: string
}

export interface EvaluationSpendDelta {
  inputTokens: number
  outputTokens: number
  costUsd: number
  completedCalls: number
}

function finiteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`)
}

function safeSessionId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/u.test(value) || basename(value) !== value) {
    throw new Error(`Unsafe evaluation budget session id: ${value}`)
  }
  return value
}

function writePrivateJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`
  const options: WriteFileOptions = { encoding: 'utf8', mode: 0o600 }
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, options)
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

/** A durable, process-exclusive ceiling shared by iterative paid campaigns. */
export class EvaluationSpendLedger {
  readonly path: string
  private readonly lockPath: string
  private lockFd: number | null
  private state: EvaluationSpendLedgerSnapshot

  constructor(private readonly options: EvaluationSpendLedgerOptions) {
    const sessionId = safeSessionId(options.sessionId)
    finiteNonNegative(options.maxCostUsd, 'maxCostUsd')
    if (options.maxCostUsd <= 0) throw new Error('maxCostUsd must be greater than zero')
    if (!options.providerId.trim()) throw new Error('providerId is required')
    if (!options.model.trim()) throw new Error('model is required')
    const directory = resolve(options.root, 'budget-sessions')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
    this.path = resolve(directory, `${sessionId}.json`)
    this.lockPath = resolve(directory, `${sessionId}.lock`)
    try {
      this.lockFd = openSync(this.lockPath, 'wx', 0o600)
    } catch (error) {
      throw new Error(`Evaluation budget session is already in use: ${sessionId}`, { cause: error })
    }
    try {
      this.state = existsSync(this.path)
        ? JSON.parse(readFileSync(this.path, 'utf8')) as EvaluationSpendLedgerSnapshot
        : this.newSnapshot(sessionId)
      this.validateState(sessionId)
      if (!existsSync(this.path)) writePrivateJson(this.path, this.state)
    } catch (error) {
      this.close()
      throw error
    }
  }

  snapshot(): EvaluationSpendLedgerSnapshot {
    return structuredClone(this.state)
  }

  remainingCostUsd(): number {
    return this.state.usageUnknown ? 0 : Math.max(0, this.state.maxCostUsd - this.state.spentCostUsd)
  }

  record(delta: EvaluationSpendDelta): EvaluationSpendLedgerSnapshot {
    finiteNonNegative(delta.inputTokens, 'inputTokens')
    finiteNonNegative(delta.outputTokens, 'outputTokens')
    finiteNonNegative(delta.costUsd, 'costUsd')
    finiteNonNegative(delta.completedCalls, 'completedCalls')
    if (!Number.isInteger(delta.inputTokens) || !Number.isInteger(delta.outputTokens) || !Number.isInteger(delta.completedCalls)) {
      throw new Error('Evaluation spend ledger token and call deltas must be integers')
    }
    const next: EvaluationSpendLedgerSnapshot = {
      ...this.state,
      spentCostUsd: this.state.spentCostUsd + delta.costUsd,
      inputTokens: this.state.inputTokens + delta.inputTokens,
      outputTokens: this.state.outputTokens + delta.outputTokens,
      completedCalls: this.state.completedCalls + delta.completedCalls,
      updatedAt: new Date().toISOString(),
    }
    writePrivateJson(this.path, next)
    this.state = next
    if (next.spentCostUsd > next.maxCostUsd) {
      throw new Error(`Evaluation budget session exceeded its $${next.maxCostUsd.toFixed(2)} ceiling`)
    }
    return this.snapshot()
  }

  markUsageUnknown(): EvaluationSpendLedgerSnapshot {
    const next = { ...this.state, usageUnknown: true, updatedAt: new Date().toISOString() }
    writePrivateJson(this.path, next)
    this.state = next
    return this.snapshot()
  }

  close(): void {
    if (this.lockFd === null) return
    closeSync(this.lockFd)
    this.lockFd = null
    rmSync(this.lockPath, { force: true })
  }

  private newSnapshot(sessionId: string): EvaluationSpendLedgerSnapshot {
    const now = new Date().toISOString()
    return {
      schemaVersion: 1,
      sessionId,
      maxCostUsd: this.options.maxCostUsd,
      spentCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      completedCalls: 0,
      usageUnknown: false,
      providerId: this.options.providerId,
      model: this.options.model,
      createdAt: now,
      updatedAt: now,
    }
  }

  private validateState(sessionId: string): void {
    if (this.state.schemaVersion !== 1 || this.state.sessionId !== sessionId) throw new Error('Evaluation budget ledger identity is invalid')
    for (const [name, value] of Object.entries({
      maxCostUsd: this.state.maxCostUsd,
      spentCostUsd: this.state.spentCostUsd,
      inputTokens: this.state.inputTokens,
      outputTokens: this.state.outputTokens,
      completedCalls: this.state.completedCalls,
    })) finiteNonNegative(value, name)
    if (this.state.maxCostUsd !== this.options.maxCostUsd) throw new Error('Evaluation budget ceiling does not match the existing session')
    if (this.state.providerId !== this.options.providerId || this.state.model !== this.options.model) {
      throw new Error('Evaluation budget provider or model does not match the existing session')
    }
    if (this.state.spentCostUsd > this.state.maxCostUsd) throw new Error('Evaluation budget ledger is already exhausted')
    if (typeof this.state.usageUnknown !== 'boolean') throw new Error('Evaluation budget ledger usage state is invalid')
    if (this.state.usageUnknown) throw new Error('Evaluation budget ledger has unknown provider usage and is fail-closed')
  }
}
