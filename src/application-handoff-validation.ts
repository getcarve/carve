import type { ApplicationHandoffTask } from './application-handoff.js'

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const text = (value: unknown, max = 100_000): value is string => typeof value === 'string' && value.length <= max
const identity = (value: unknown) => text(value, 255) && value.length > 0
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const nullableIdentity = (value: unknown) => value === null || identity(value)
const target = (value: unknown): boolean => object(value) && identity(value.application) && identity(value.bundleIdentifier)
  && Number.isSafeInteger(value.windowId) && Number(value.windowId) > 0 && text(value.title, 1000)
  && object(value.bounds) && ['x', 'y', 'width', 'height'].every(key => number(value.bounds && (value.bounds as Record<string, unknown>)[key]))
  && Number(value.bounds.width) > 0 && Number(value.bounds.height) > 0
const route = (value: unknown): boolean => object(value) && ['observe', 'input'].includes(String(value.authority))
  && ['workspace', 'research', 'destination', 'reference'].includes(String(value.role)) && text(value.purpose, 2000)
  && (value.source === 'existing' ? target(value.target) : value.source === 'fresh' && identity(value.application) && identity(value.bundleIdentifier)
    && (value.url == null || text(value.url, 2000) && /^https:\/\//u.test(value.url)))

/** Treat persisted state as an external boundary, including nested identity and allowance fields. */
export function validateSavedHandoff(value: unknown): asserts value is ApplicationHandoffTask {
  const invalid = () => { throw new Error('Invalid saved handoff') }
  if (!object(value) || value.kind !== 'application_handoff' || value.version !== 1
    || !identity(value.id) || !identity(value.runId) || !text(value.goal) || !identity(value.providerId) || !identity(value.engine)
    || typeof value.remoteVisualsAllowed !== 'boolean' || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || !['awaiting_consent', 'awaiting_budget', 'opening', 'running', 'paused', 'failed', 'completed', 'cancelled'].includes(String(value.status))
    || !Number.isSafeInteger(value.stageIndex) || !Array.isArray(value.stages) || !value.stages.length || value.stages.length > 16
    || Number(value.stageIndex) < 0 || Number(value.stageIndex) >= value.stages.length
    || !(value.reason === null || text(value.reason)) || !(value.result === null || text(value.result)) || !text(value.updatedAt, 100)) return invalid()
  const stages = value.stages
  const ids = new Set<string>()
  for (const [index, stage] of stages.entries()) {
    if (!object(stage) || !identity(stage.id) || ids.has(String(stage.id)) || !route(stage.route)
      || !(stage.target === null || target(stage.target)) || !nullableIdentity(stage.runId) || !nullableIdentity(stage.sessionId)
      || !['pending', 'running', 'completed', 'failed', 'paused'].includes(String(stage.status))
      || !(stage.objective === undefined || text(stage.objective, 16_000))
      || !(stage.question === undefined || text(stage.question, 1000)) || !(stage.result === undefined || text(stage.result, 12_000))) return invalid()
    if (stage.resumesStageId !== undefined && !stages.slice(0, index).some(previous => object(previous) && previous.id === stage.resumesStageId)) return invalid()
    ids.add(String(stage.id))
  }
  if (!Array.isArray(value.evidence) || value.evidence.length > 16 || !value.evidence.every(e => object(e)
    && identity(e.id) && identity(e.stageId) && ids.has(String(e.stageId)) && target(e.source) && text(e.text, 12_000) && e.text.length > 0
    && ['complete', 'partial', 'unknown'].includes(String(e.coverage)) && e.evidence === 'model_reported'
    && Array.isArray(e.provenance) && e.provenance.length <= 100 && e.provenance.every(p => text(p, 300)))) return invalid()
  const budget = value.budget, used = value.used
  if (!object(budget) || !['quick', 'balanced', 'thorough'].includes(String(budget.preset))
    || !['maxActions', 'maxDurationMinutes'].every(k => number(budget[k]) && Number(budget[k]) > 0)
    || !['maxModelCalls', 'maxModelCallsPerAction', 'maxTotalTokens', 'maxVisionFrames', 'maxRecoveryEpisodes'].every(k => budget[k] === undefined || number(budget[k]) && Number(budget[k]) >= 0)
    || !object(used) || !['inputs', 'tokens', 'calls', 'frames', 'recoveries', 'elapsedMs'].every(k => number(used[k]) && Number(used[k]) >= 0)) return invalid()
  const request = value.budgetRequest
  if (value.status === 'awaiting_budget' && !request) return invalid()
  if (request != null && (!object(request) || !identity(request.id) || !Array.isArray(request.exhausted)
    || !request.exhausted.every(item => text(item, 50)) || typeof request.canGrant !== 'boolean'
    || !['idle', 'pending', 'failed'].includes(String(request.fundingStatus))
    || !(request.fundingError === null || text(request.fundingError)) || !object(request.delta)
    || !['actions', 'durationMinutes', 'modelCalls', 'totalTokens', 'visionFrames', 'recoveryEpisodes'].every(k => number((request.delta as Record<string, unknown>)[k]) && Number((request.delta as Record<string, unknown>)[k]) >= 0))) return invalid()
  const prior = value.prior
  if (!(prior === null || object(prior) && identity(prior.runId) && text(prior.goal) && (prior.result === null || text(prior.result)) && text(prior.status, 100) && text(prior.completedAt, 100)
    && (prior.sourceIds === undefined || Array.isArray(prior.sourceIds) && prior.sourceIds.every(identity)))) return invalid()
  try { if (JSON.stringify(value).length > 1_000_000) invalid() } catch { invalid() }
}
