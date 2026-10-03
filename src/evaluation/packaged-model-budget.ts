import { readFileSync, writeFileSync, renameSync, existsSync, openSync, closeSync, rmSync, fsyncSync, appendFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { BudgetedEvaluationModelProvider, EvaluationModelBudgetExceededError, type EvaluationModelBudgetOptions } from './model-budget.js'
import type { ModelProvider } from '../providers/types.js'

export interface PackagedEvaluationBudgetConfig {
  providerId: string
  budget: Omit<EvaluationModelBudgetOptions, 'onUsage' | 'onUsageUnknown' | 'onDispatch'>
}
interface UsageState { attemptedCalls: number; completedCalls: number; inputTokens: number; outputTokens: number; costUsd: number; pendingCalls: number; usageUnknown: boolean }

/** Explicit evaluation-only boundary. One ledger belongs to one app process;
 * a process restart with unfinished dispatches fails closed. Files contain
 * aggregate usage only, never prompts, screen content, credentials or replies. */
export function packagedEvaluationProvider(inner: ModelProvider, configPath: string): ModelProvider {
  const path = resolve(configPath)
  const config = JSON.parse(readFileSync(path, 'utf8')) as PackagedEvaluationBudgetConfig
  if (config.providerId !== inner.summary.id) {
    // Registry lookups also support startup/settings/capability discovery.
    // Refuse transport, not inspection of an otherwise available provider.
    const refuse = async (): Promise<never> => { throw new Error('This provider is outside the packaged evaluation campaign') }
    return { summary: inner.summary, supportsGoalPlanning: inner.supportsGoalPlanning === true, complete: refuse, embed: refuse, health: () => inner.health(),
      ...(inner.setModel ? { setModel: (model: string) => inner.setModel!(model) } : {}),
      ...(inner.listModels ? { listModels: () => inner.listModels!() } : {}) }
  }
  const statePath = `${path}.usage.json`
  const state: UsageState = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) as UsageState
    : { attemptedCalls: 0, completedCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, pendingCalls: 0, usageUnknown: false }
  for (const [key, value] of Object.entries(state)) if (key !== 'usageUnknown' && (!Number.isFinite(value) || Number(value) < 0)) throw new Error('Invalid evaluation usage ledger')
  if (state.usageUnknown !== false || state.pendingCalls !== 0) throw new Error('The prior evaluation has unreconciled usage; no further paid dispatch is allowed')
  const save = () => { const temporary = `${statePath}.${process.pid}.tmp`; writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600, flush: true }); renameSync(temporary, statePath); const directory = openSync(dirname(statePath), 'r'); try { fsyncSync(directory) } finally { closeSync(directory) } }
  const lockPath = `${statePath}.lock`
  const lock = openSync(lockPath, 'wx', 0o600)
  const close = () => { closeSync(lock); rmSync(lockPath, { force: true }) }
  try {
  const provider = new BudgetedEvaluationModelProvider(inner, { ...config.budget,
    maxCalls: config.budget.maxCalls - state.attemptedCalls,
    maxTokens: config.budget.maxTokens - state.inputTokens - state.outputTokens,
    maxCostUsd: config.budget.maxCostUsd - state.costUsd,
    onDispatch: calls => { state.attemptedCalls += calls; state.pendingCalls += calls; save() },
    onUsage: delta => { state.completedCalls += delta.completedCalls; state.pendingCalls -= delta.completedCalls + (delta.failedCalls ?? 0); state.inputTokens += delta.inputTokens; state.outputTokens += delta.outputTokens; state.costUsd += delta.costUsd; save() },
    onUsageUnknown: () => { state.usageUnknown = true; save() },
  })
  save()
  process.once('exit', close)
  // Evaluation controls belong to the harness. Keep its amounts and limits
  // in a local sidecar, never in product errors, approval dialogs or audit UI.
  return new Proxy(provider, { get(target, property) {
    const value: unknown = Reflect.get(target, property, target)
    if (typeof value !== 'function') return value
    if (!['complete', 'proposeComputerActions', 'startComputerUseSession', 'continueComputerUseSession', 'searchPublicWeb', 'embed'].includes(String(property))) return value.bind(target)
    return async (...args: unknown[]) => {
      try { return await Reflect.apply(value, target, args) }
      catch (error) {
        if (!(error instanceof EvaluationModelBudgetExceededError)) throw error
        appendFileSync(`${path}.stops.jsonl`, JSON.stringify({ occurredAt: new Date().toISOString(), reason: error.message }) + '\n', { mode: 0o600, flush: true })
        throw new Error('Carve stopped before finishing this task. Your completed work has been preserved.')
      }
    }
  } })
  } catch (error) { close(); throw error }
}
