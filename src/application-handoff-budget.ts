import type { WorkBudgetEnvelope } from './types.js'
import { workBudgetPolicy, workBudgetPresets } from './work-budget.js'

export interface HandoffUsage { inputs: number; tokens: number; calls: number; frames: number; recoveries: number; elapsedMs: number }
export interface HandoffBudgetDelta { actions: number; durationMinutes: number; modelCalls: number; totalTokens: number; visionFrames: number; recoveryEpisodes: number }
export interface HandoffBudgetRequest {
  id: string
  exhausted: string[]
  delta: HandoffBudgetDelta
  canGrant: boolean
  fundingStatus: 'idle' | 'pending' | 'failed'
  fundingError: string | null
}
const resources = [
  ['maxActions', 'inputs', 'actions', 'actions'],
  ['maxDurationMinutes', 'elapsedMs', 'durationMinutes', 'active time'],
  ['maxModelCalls', 'calls', 'modelCalls', 'model calls'],
  ['maxTotalTokens', 'tokens', 'totalTokens', 'tokens'],
  ['maxVisionFrames', 'frames', 'visionFrames', 'screenshots'],
  ['maxRecoveryEpisodes', 'recoveries', 'recoveryEpisodes', 'recoveries'],
] as const

export function exhaustedHandoffResources(budget: WorkBudgetEnvelope, used: HandoffUsage): string[] {
  return resources.filter(([limit, field]) => {
    const approved = budget[limit]
    if (approved === undefined) return false
    const usage = field === 'elapsedMs' ? used[field] / 60_000 : used[field]
    return limit === 'maxRecoveryEpisodes' ? usage > approved : usage >= approved
  }).map(([, , , label]) => label)
}

/** A bounded work block, not a promise to finish. Measured overruns remain charged. */
export function proposeHandoffBudget(budget: WorkBudgetEnvelope, used: HandoffUsage): Pick<HandoffBudgetRequest, 'delta' | 'canGrant' | 'exhausted'> {
  const delta: HandoffBudgetDelta = { actions: 0, durationMinutes: 0, modelCalls: 0, totalTokens: 0, visionFrames: 0, recoveryEpisodes: 0 }
  const effective = { ...budget }
  for (const [limit, field, key] of resources) {
    const current = budget[limit]
    if (current === undefined) continue
    const usage = field === 'elapsedMs' ? Math.ceil(used[field] / 60_000) : used[field]
    const next = Math.max(current, Math.min(workBudgetPolicy[limit], usage + workBudgetPresets.quick[limit]!))
    delta[key] = next - current
    effective[limit] = next
  }
  return { delta, canGrant: exhaustedHandoffResources(effective, used).length === 0 && Object.values(delta).some(n => n > 0), exhausted: exhaustedHandoffResources(budget, used) }
}

export function addHandoffBudget(budget: WorkBudgetEnvelope, delta: HandoffBudgetDelta): WorkBudgetEnvelope {
  const effective = { ...budget }
  for (const [limit, , key] of resources) if (effective[limit] !== undefined) effective[limit] += delta[key]
  return effective
}

export class HandoffBudgetExhausted extends Error {
  constructor() { super('This task has used its work allowance. Add allowance to continue the remaining stages.'); this.name = 'HandoffBudgetExhausted' }
}

/** Shared by the capsule and expanded app; the displayed button authorizes this exact offer. */
export function handoffBudgetCopy(request: HandoffBudgetRequest, cloud: boolean) {
  const delta = request.delta
  const amounts = [[delta.actions, 'actions'], [delta.durationMinutes, 'active minutes'], [delta.modelCalls, 'model calls'], [delta.totalTokens, 'tokens'], [delta.visionFrames, 'screenshots'], [delta.recoveryEpisodes, 'recoveries']] as const
  return {
    title: request.canGrant ? cloud ? 'Use one more task to continue?' : 'More allowance needed' : 'Work limit reached',
    detail: request.canGrant
      ? `The ${request.exhausted.join(", ")} allowance is used. Completed work is saved. Add up to ${amounts.filter(([n]) => n > 0).map(([n, label]) => `${n.toLocaleString('en-US')} ${label}`).join(', ')} for the remaining work.${cloud ? ' This uses one additional task from your plan’s allowance; Carve checks your account allowance before continuing.' : ''}`
      : 'Completed work is saved. This task reached its maximum work allowance. Start a new task using the saved work to continue.',
    approveLabel: request.fundingStatus === 'pending' ? 'Checking allowance…' : cloud ? 'Use 1 more task' : 'Add allowance and continue',
  }
}
