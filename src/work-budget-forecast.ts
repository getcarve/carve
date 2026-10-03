import { createHash } from 'node:crypto'
import type {
  WorkBudgetFinishForecast,
  WorkSurfaceIntent,
  WorkBudgetPreset,
  WorkBudgetProgressAssessment,
  WorkBudgetRecommendation,
} from './types.js'
import { recommendWorkBudget, workBudgetPresets } from './work-budget.js'

export interface UniversalBudgetForecastInput {
  goal: string
  surfaceIntent?: WorkSurfaceIntent | undefined
  artifactRequired?: boolean | undefined
  reason: 'next_batch_does_not_fit' | 'next_provider_turn_does_not_fit' | 'unfinished_at_limit'
  usedInputs: number
  approvedInputs: number
  requestedBatchInputs: number
  providerTurns: number
  approvedProviderTurns: number
  usedTotalTokens: number
  approvedTotalTokens: number
  usedActiveMs: number
  approvedActiveMs: number
  batches: number
  noProgressBatches: number
  repeatedBatchesDetected: number
  batchesSuppressed: number
  actionFailures: number
  visionFrames: number
  approvedVisionFrames: number
  recoveryEpisodes: number
  approvedRecoveryEpisodes: number
}

export interface UniversalBudgetExtensionForecast {
  forecast: WorkBudgetFinishForecast
  additionalInputs: number
  additionalTokens: number
  additionalMinutes: number
  additionalModelCalls: number
  additionalVisionFrames: number
  additionalRecoveryEpisodes: number
}

const estimatorVersion = 'adaptive-finish-v4'

/** Deterministic first-generation finish forecaster. It estimates task shape
 * from the approved goal, then calibrates remaining demand using actual run
 * throughput. A future learned forecaster can replace the priors without
 * changing the checkpoint or amendment contract. */
export function forecastUniversalBudgetExtension(input: UniversalBudgetForecastInput): UniversalBudgetExtensionForecast {
  const shape = analyzeGoal(input.goal, input.surfaceIntent, input.artifactRequired)
  const recentBatchMargin = Math.max(3, Math.min(6, Math.ceil(input.requestedBatchInputs * 0.25)))
  const priorExceeded = input.usedInputs >= shape.estimatedTotalInputs
  const noProgressRatio = input.batches > 0 ? input.noProgressBatches / input.batches : 0
  const progress: WorkBudgetProgressAssessment = input.batchesSuppressed > 0 || input.repeatedBatchesDetected >= 2 || input.actionFailures >= 2
    ? 'stalled'
    : noProgressRatio >= 0.6
      ? 'unclear'
      : 'credible'
  // Spending the prior is evidence that it was too small, not that only one
  // action remains. Progress that is unclear gets a bounded continuation block.
  const continuationBlock = priorExceeded ? Math.max(3, Math.ceil(input.approvedInputs / 4)) : 0
  const estimatedRemainingInputs = Math.max(
    continuationBlock,
    input.reason === 'next_batch_does_not_fit' ? input.requestedBatchInputs : 1,
    shape.estimatedTotalInputs - input.usedInputs,
  )
  const remainingApprovedInputs = Math.max(0, input.approvedInputs - input.usedInputs)
  const minimumInputDelta = Math.max(0, input.requestedBatchInputs - remainingApprovedInputs)
  const forecastInputGap = Math.max(0, estimatedRemainingInputs + recentBatchMargin - remainingApprovedInputs)
  // A run that has been landing its inputs is asked once, not every batch: an
  // approval doubles the room it had, plus a buffer. On 2 October a three-record
  // data-entry task of 68 inputs, started on a 30-input envelope, asked five
  // times at a quarter block and three times at the forecast gap alone.
  // Doubling needs evidence: a run that has not landed five inputs yet gets the gap.
  const credibleBlock = progress === 'credible' && input.usedInputs >= 5 && (minimumInputDelta > 0 || forecastInputGap > 0) ? input.approvedInputs + 10 : 0
  const additionalInputs = roundUp(Math.max(minimumInputDelta, forecastInputGap, credibleBlock), 5)

  const totalTokensPerTurn = input.providerTurns > 0 ? input.usedTotalTokens / input.providerTurns : 8_000
  const inputsPerTurn = input.providerTurns > 0 ? Math.max(0.5, input.usedInputs / input.providerTurns) : 1.5
  const estimatedAdditionalTurns = Math.max(2, Math.ceil((estimatedRemainingInputs + recentBatchMargin) / inputsPerTurn) + 2)
  const estimatedAdditionalTokens = roundUp(Math.ceil(totalTokensPerTurn * estimatedAdditionalTurns * 1.15), 10_000)
  const remainingApprovedTokens = Math.max(0, input.approvedTotalTokens - input.usedTotalTokens)
  const additionalTokens = roundUp(Math.max(0, estimatedAdditionalTokens - remainingApprovedTokens), 50_000)

  const msPerInput = input.usedInputs > 0 ? input.usedActiveMs / input.usedInputs : 7_500
  const estimatedAdditionalMinutes = Math.max(1, Math.ceil(((estimatedRemainingInputs + recentBatchMargin) * msPerInput + 30_000) / 60_000))
  const remainingApprovedMs = Math.max(0, input.approvedActiveMs - input.usedActiveMs)
  const additionalMinutes = roundUp(Math.max(0, estimatedAdditionalMinutes - Math.floor(remainingApprovedMs / 60_000)), 5)
  const remainingApprovedTurns = Math.max(0, input.approvedProviderTurns - input.providerTurns)
  const additionalModelCalls = Math.max(0, estimatedAdditionalTurns - remainingApprovedTurns)
  const additionalVisionFrames = Math.max(0, estimatedAdditionalTurns - Math.max(0, input.approvedVisionFrames - input.visionFrames))
  const additionalRecoveryEpisodes = input.recoveryEpisodes >= input.approvedRecoveryEpisodes ? 2 : 0

  const recommendation: WorkBudgetRecommendation = progress === 'stalled'
    ? 'change_approach'
    : additionalInputs > 0 || additionalTokens > 0 || additionalMinutes > 0 || additionalModelCalls > 0
      ? 'finish'
      : 'current_milestone'
  const confidence = progress === 'credible' && input.providerTurns >= 4 && !priorExceeded ? 'medium' : 'low'
  const remainingSteps = remainingMilestones(shape.milestones)
  const reasonCodes = [
    ...shape.reasonCodes,
    ...(priorExceeded ? ['task_shape_estimate_exceeded'] : []),
    ...(noProgressRatio >= 0.4 ? ['elevated_no_progress'] : []),
    ...(input.batchesSuppressed > 0 ? ['repeated_tactic_suppressed'] : []),
    ...(additionalTokens > 0 ? ['token_headroom_needed'] : []),
    ...(additionalMinutes > 0 ? ['active_time_headroom_needed'] : []),
  ]
  const forecastSeed = JSON.stringify({ input, shape, additionalInputs, additionalTokens, additionalMinutes, estimatorVersion })
  const forecast: WorkBudgetFinishForecast = {
    id: `budget_forecast_${createHash('sha256').update(forecastSeed).digest('hex').slice(0, 24)}`,
    version: estimatorVersion,
    recommendedPreset: shape.recommendedPreset,
    progress,
    recommendation,
    confidence,
    estimatedTotalInputs: Math.max(shape.estimatedTotalInputs, input.usedInputs + estimatedRemainingInputs),
    estimatedRemainingInputs,
    bufferInputs: recentBatchMargin,
    estimatedAdditionalTokens,
    estimatedAdditionalMinutes,
    remainingSteps,
    reasonCodes,
    rationale: progress === 'stalled'
      ? 'Recent controller evidence shows a repeated or ineffective tactic. Review the approach before approving more work.'
      : `The remaining work has not been verified.${priorExceeded ? ' The original estimate was exceeded; this reserves a bounded continuation block, not a prediction that the task is almost done.' : ''} Input, time and model allowances include the same ${recentBatchMargin}-action buffer and final verification.`,
  }
  return { forecast, additionalInputs, additionalTokens, additionalMinutes, additionalModelCalls, additionalVisionFrames, additionalRecoveryEpisodes }
}

/** A verb the request asks for, not one it forbids. Within one sentence, a
 * negation before the verb ("Don't sign in, download anything, or buy
 * tickets") makes it a prohibition: on 23 September that sentence gave a
 * read-only museum comparison an "Export or download" step in its forecast. */
export function requestsUnprohibited(normalized: string, verb: RegExp): boolean {
  return normalized.split(/[.!?;\n]+/u).some(sentence => {
    const flags = verb.flags.includes('g') ? verb.flags : verb.flags + 'g'
    for (const match of sentence.matchAll(new RegExp(verb.source, flags))) {
      const before = sentence.slice(0, match.index)
      if (!/\b(?:do not|don['’]?t|dont|never|without|no|not|avoid|nor|prohibited|forbidden)\b/u.test(before)) return true
    }
    return false
  })
}

export function analyzeGoal(goal: string, surfaceIntent?: WorkSurfaceIntent, artifactRequired?: boolean): {
  recommendedPreset: WorkBudgetPreset
  estimatedTotalInputs: number
  maxModelCalls: number
  milestones: string[]
  reasonCodes: string[]
} {
  const normalized = goal.normalize('NFKC').toLocaleLowerCase('en-US')
  const research = /\b(?:research|look up|find|compare|investigate|sources?|wikipedia|web)\b/u.test(normalized)
  // Resolved route semantics take precedence over lexical priors: reading a
  // document or asking to 'report the reasons' does not create an artifact.
  const artifact = artifactRequired ?? (surfaceIntent?.version === 3
    ? surfaceIntent.requirements.some(requirement => requirement.role === 'destination'
      || requirement.operationConstraints?.some(constraint => /^(?:create_|edit_)/u.test(constraint.operation)))
    : requestsUnprohibited(normalized, /\b(?:create|write|draft|make|build|prepare|edit|update|populate|put|place|save)\b[^.!?]*\b(?:documents?|google docs?|spreadsheets?|google sheets?|excel|reports?|presentations?|slides?)\b/u))
  const structured = /\b(?:table|chart|graph|rows?|columns?|comparison|dataset)\b/u.test(normalized)
  const synthesis = /\b(?:explain|summary|summarize|paragraph|conclusion|difference|analysis)\b/u.test(normalized)
  const sources = /\b(?:sources?|urls?|citations?|references?)\b/u.test(normalized)
  const entityCount = researchEntityCount(normalized)
  const enumerated = enumeratedItemCount(normalized)
  let likely = 8
  const reasonCodes: string[] = []
  const milestones: string[] = []
  if (enumerated > 1) {
    // Each listed item is its own round of fields and a save.
    likely += (enumerated - 1) * 12
    reasonCodes.push('enumerated_items')
    milestones.push('Finish the remaining listed items')
  }
  if (research) {
    likely += 10 + Math.max(0, entityCount - 1) * 4
    reasonCodes.push('research')
    milestones.push(entityCount > 1 ? 'Collect and check the remaining requested subjects' : 'Collect and check the requested information')
  }
  if (artifact) {
    likely += 12
    reasonCodes.push('artifact_creation')
    milestones.push('Create and title the destination artifact')
  }
  if (structured) {
    likely += 10
    reasonCodes.push('structured_content')
    milestones.push('Finish the requested table or chart')
  }
  if (synthesis) {
    likely += 4
    reasonCodes.push('synthesis')
    milestones.push('Add the requested synthesis')
  }
  if (sources) {
    likely += 3
    reasonCodes.push('source_attribution')
    milestones.push('Add the requested source references')
  }
  if (artifactRequired !== false && requestsUnprohibited(normalized, /\b(?:download|export)\b/u)) {
    reasonCodes.push('artifact_delivery')
    milestones.push('Export or download the requested artifact')
  }
  likely += 2
  milestones.push('Verify the finished result')
  const estimatedTotalInputs = roundUp(Math.ceil(likely * 1.15), 5)
  const recommendedPreset = recommendWorkBudget(goal)
  return {
    recommendedPreset,
    estimatedTotalInputs,
    maxModelCalls: workBudgetPresets[recommendedPreset].maxModelCalls ?? 140,
    milestones,
    reasonCodes,
  }
}

/** Items the request lists one by one: "1) … 2) … 3) …", "1. … 2. …", or
 * "these three …" / "these 3 …". The largest count found wins. */
export function enumeratedItemCount(normalized: string): number {
  const numbered = new Set<number>()
  for (const match of normalized.matchAll(/(?:^|[\s(])(\d{1,2})[).:]\s/gu)) numbered.add(Number(match[1]))
  const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
  const spoken = /\b(?:these|those|the|all)\s+(two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+\w+/u.exec(normalized)
  const spokenCount = spoken?.[1] ? (words[spoken[1]] ?? Number(spoken[1])) : 0
  return Math.min(12, Math.max(numbered.size, Number.isFinite(spokenCount) ? spokenCount : 0))
}

function researchEntityCount(goal: string): number {
  const match = /\bresearch\s+(.{1,120}?)(?=\.|\b(?:collect|then|create|build|make)\b)/u.exec(goal)
    ?? /\bcompare\s+(.{1,120}?)(?=\.|\b(?:then|create|build|make)\b)/u.exec(goal)
  if (!match?.[1]) return 1
  const segment = match[1].replace(/\band\b/gu, ',')
  return Math.max(1, Math.min(6, segment.split(',').map((part) => part.trim()).filter(Boolean).length))
}

function remainingMilestones(milestones: string[]): string[] {
  // Input counts measure effort, not completion. Retries can consume the whole
  // prior before the first milestone finishes; never discard steps by ratio.
  return milestones.length === 0 ? ['Check what remains to finish and verify the requested outcome']
    : [...milestones]
}

function roundUp(value: number, increment: number): number {
  if (value <= 0) return 0
  return Math.ceil(value / increment) * increment
}
