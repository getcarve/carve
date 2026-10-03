import type { WorkBudgetAmendment, WorkBudgetEnvelope, WorkBudgetPreset } from './types.js'

/**
 * Human-facing presets. The labels stay qualitative; these exact numbers are
 * disclosed in the picker and frozen into the plan receipt.
 */
export const workBudgetPresets: Record<WorkBudgetPreset, WorkBudgetEnvelope> = {
  quick: { preset: 'quick', maxActions: 12, maxDurationMinutes: 5, maxModelCalls: 48, maxModelCallsPerAction: 4, maxTotalTokens: 200_000, maxVisionFrames: 24, maxRecoveryEpisodes: 2 },
  balanced: { preset: 'balanced', maxActions: 30, maxDurationMinutes: 15, maxModelCalls: 140, maxModelCallsPerAction: 6, maxTotalTokens: 600_000, maxVisionFrames: 80, maxRecoveryEpisodes: 4 },
  thorough: { preset: 'thorough', maxActions: 75, maxDurationMinutes: 30, maxModelCalls: 360, maxModelCallsPerAction: 10, maxTotalTokens: 2_000_000, maxVisionFrames: 180, maxRecoveryEpisodes: 8 },
}

export const workBudgetPolicy = {
  defaultPreset: 'balanced' as WorkBudgetPreset,
  maxActions: 200,
  maxDurationMinutes: 60,
  maxModelCalls: 720,
  maxTotalTokens: 5_000_000,
  maxVisionFrames: 400,
  maxRecoveryEpisodes: 24,
  durationExtensionMinutes: 5,
} as const

export function resolveWorkBudget(preset: WorkBudgetPreset | undefined): WorkBudgetEnvelope {
  const selected = preset ?? workBudgetPolicy.defaultPreset
  return structuredClone(workBudgetPresets[selected])
}

export function budgetForContract(input: {
  budget?: WorkBudgetEnvelope
  limits: { maxActions: number; maxDurationMinutes: number }
}): WorkBudgetEnvelope {
  if (input.budget) return structuredClone(input.budget)
  return {
    ...workBudgetPresets.balanced,
    maxActions: input.limits.maxActions,
    maxDurationMinutes: input.limits.maxDurationMinutes,
  }
}

/** Applies append-only budget receipts without mutating the frozen base plan.
 * Legacy action/time-only receipts remain valid; newer technical deltas are
 * additive only when they are explicitly present. */
export function effectiveWorkBudget(
  base: WorkBudgetEnvelope,
  amendments: WorkBudgetAmendment[] = [],
): WorkBudgetEnvelope {
  const effective = structuredClone(base)
  for (const amendment of amendments) {
    effective.maxActions += amendment.delta.actions
    effective.maxDurationMinutes += amendment.delta.durationMinutes
    addOptional(effective, 'maxModelCalls', amendment.delta.modelCalls)
    addOptional(effective, 'maxTotalTokens', amendment.delta.totalTokens)
    addOptional(effective, 'maxVisionFrames', amendment.delta.visionFrames)
    addOptional(effective, 'maxRecoveryEpisodes', amendment.delta.recoveryEpisodes)
  }
  return effective
}

/** Conservative goal-shape recommendation used before selected-window work.
 * Simple requests retain Balanced as the familiar default; research plus a
 * structured artifact is promoted to Thorough before the user approves it. */
export function recommendWorkBudget(goal: string): WorkBudgetPreset {
  const normalized = goal.normalize('NFKC').toLocaleLowerCase('en-US')
  const research = /\b(?:research|look up|find|compare|investigate|sources?|wikipedia|web)\b/u.test(normalized)
  const artifact = /\b(?:document|google doc|spreadsheet|google sheet|excel|report|presentation|slides?)\b/u.test(normalized)
  const structured = /\b(?:table|chart|graph|rows?|columns?|comparison|dataset)\b/u.test(normalized)
  const manyItems = /\b(?:each|multiple|several|years?|months?|records?|items?|sources?)\b/u.test(normalized)
  if (research && artifact || artifact && structured && manyItems || research && structured && /\b(?:create|build|make|add)\b/u.test(normalized)) return 'thorough'
  return 'balanced'
}

function addOptional(
  budget: WorkBudgetEnvelope,
  key: 'maxModelCalls' | 'maxTotalTokens' | 'maxVisionFrames' | 'maxRecoveryEpisodes',
  delta: number | undefined,
): void {
  if (delta !== undefined) budget[key] = (budget[key] ?? 0) + delta
}

export class WorkResourceLimitError extends Error {
  constructor(message: string, readonly resource?: 'modelCalls' | 'totalTokens' | 'visionFrames' | 'recoveryEpisodes') {
    super(message)
    this.name = 'WorkResourceLimitError'
  }
}

/** Offer one bounded inference block, including headroom above measured usage.
 * A response may cross a token ceiling before its usage is known. Never reset
 * that usage, or offer an extension that cannot fund even the next turn. */
export function liveResourceBudgetExtension(budget: WorkBudgetEnvelope, usage: {
  modelCalls: number; totalTokens: number; visionFrames: number; recoveryEpisodes: number
}): WorkBudgetAmendment['delta'] | null {
  const resources = [
    ['maxModelCalls', 'modelCalls', 12],
    ['maxTotalTokens', 'totalTokens', 100_000],
    ['maxVisionFrames', 'visionFrames', 12],
    ['maxRecoveryEpisodes', 'recoveryEpisodes', 2],
  ] as const
  const delta: WorkBudgetAmendment['delta'] = { actions: 0, durationMinutes: 0 }
  for (const [key, field, block] of resources) {
    const current = budget[key]
    if (current === undefined) continue
    const next = Math.min(workBudgetPolicy[key], Math.max(current, usage[field]) + block)
    if (next <= usage[field]) return null
    delta[field] = Math.max(0, next - current)
  }
  return Object.values(delta).some((amount) => amount > 0) ? delta : null
}
