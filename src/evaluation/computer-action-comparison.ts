import type { ComputerActionProposal, ComputerActionResponse } from '../providers/types.js'
import type { LiveComputerAction } from '../types.js'

export type ComparableComputerActionFamily =
  | 'pointer'
  | 'scroll'
  | 'text'
  | 'keyboard'
  | 'wait'
  | 'window'
  | 'terminal'
  | 'handoff'

export interface ComputerActionComparisonFrame {
  evidenceId: string
  width: number
  height: number
}

export interface ComputerActionComparisonTarget {
  bounds: { x: number; y: number; width: number; height: number }
  /** Optional frame-scoped semantic identity. Native pixel proposals cannot
   * satisfy this field; it is reported separately from geometric grounding. */
  elementId: string | null
}

export interface ComputerActionComparisonGroundTruth {
  scenarioId: string
  frame: ComputerActionComparisonFrame
  target: ComputerActionComparisonTarget | null
  expectedFamilies: ComparableComputerActionFamily[]
  expectedText: string | null
}

export interface StructuredComputerActionCandidate {
  action: LiveComputerAction
  frame: ComputerActionComparisonFrame
  /** The ordinary structured-output path normally consumes one request, but
   * the evaluator records rather than assumes that implementation detail. */
  providerRequestCount: number
  usage: { inputTokens: number | null; outputTokens: number | null }
}

export type ComputerActionComparisonGuard =
  | 'controller_validation_required'
  | 'uncompiled_provider_proposal'
  | 'frame_binding_mismatch'
  | 'provider_safety_check_pending'
  | 'fresh_observation_required_for_batch'

export interface ComputerActionModeScore {
  mode: 'steward_structured' | 'provider_native'
  /** This record is comparison evidence only, never execution authority. */
  executionDisposition: 'comparison_only'
  frameBound: boolean
  providerRequestCount: number
  usage: { inputTokens: number | null; outputTokens: number | null }
  actionKinds: string[]
  actionCount: number
  effectfulActionCount: number
  firstComparableFamily: ComparableComputerActionFamily | null
  expectedFamilyMatch: boolean
  /** Geometric score for the first effectful pointer action. It is null when
   * there is no target, no such action, or the proposal is bound to a stale
   * frame. It is not an outcome or task-completion score. */
  firstEffectfulPointerHit: boolean | null
  semanticElementMatch: boolean | null
  exactTextMatch: boolean | null
  pendingSafetyCheckCount: number
  requiresConfirmation: boolean | null
  guards: ComputerActionComparisonGuard[]
}

export interface ComputerActionComparisonRecord {
  scenarioId: string
  evidenceId: string
  structured: ComputerActionModeScore
  native: ComputerActionModeScore
}

export interface ComputerActionModeSummary {
  trials: number
  frameBoundRate: number
  expectedFamilyMatchRate: number
  scorablePointerTrials: number
  firstEffectfulPointerHitRate: number | null
  scorableTextTrials: number
  exactTextMatchRate: number | null
  averageActionCount: number
  averageEffectfulActionCount: number
  totalProviderRequests: number
  totalTokens: number | null
}

export interface ComputerActionComparisonSummary {
  trials: number
  structured: ComputerActionModeSummary
  native: ComputerActionModeSummary
  nativeSafetyCheckTrials: number
  nativeBatchedEffectTrials: number
}

/**
 * Scores two inert proposals against the same synthetic-frame ground truth.
 * The function accepts no screenshot bytes, provider, or execution callback,
 * so it cannot transmit pixels or produce native input as a side effect.
 */
export function compareComputerActionProposals(
  groundTruth: ComputerActionComparisonGroundTruth,
  structured: StructuredComputerActionCandidate,
  native: ComputerActionResponse,
): ComputerActionComparisonRecord {
  validateGroundTruth(groundTruth)
  validateCandidate('structured.providerRequestCount', structured.providerRequestCount, structured.usage)
  validateCandidate('native.providerRequestCount', native.providerRequestCount, native.usage)

  const structuredFrameBound = sameFrame(groundTruth.frame, structured.frame)
  const nativeFrameBound = native.evidenceId === groundTruth.frame.evidenceId
    && native.frame.width === groundTruth.frame.width
    && native.frame.height === groundTruth.frame.height
  const structuredFamily = structuredActionFamily(structured.action)
  const nativeFamily = native.actions.map(nativeActionFamily).find((family) => family !== null) ?? null
  const structuredEffectfulActions = structuredActionIsEffectful(structured.action) ? 1 : 0
  const nativeEffectfulActions = native.actions.filter(nativeActionIsEffectful).length

  const structuredGuards: ComputerActionComparisonGuard[] = ['controller_validation_required']
  if (!structuredFrameBound) structuredGuards.push('frame_binding_mismatch')
  const nativeGuards: ComputerActionComparisonGuard[] = ['uncompiled_provider_proposal']
  if (!nativeFrameBound) nativeGuards.push('frame_binding_mismatch')
  if (native.pendingSafetyChecks.length > 0) nativeGuards.push('provider_safety_check_pending')
  if (nativeEffectfulActions > 1) nativeGuards.push('fresh_observation_required_for_batch')

  return {
    scenarioId: groundTruth.scenarioId,
    evidenceId: groundTruth.frame.evidenceId,
    structured: {
      mode: 'steward_structured',
      executionDisposition: 'comparison_only',
      frameBound: structuredFrameBound,
      providerRequestCount: structured.providerRequestCount,
      usage: { ...structured.usage },
      actionKinds: [structured.action.kind],
      actionCount: 1,
      effectfulActionCount: structuredEffectfulActions,
      firstComparableFamily: structuredFamily,
      expectedFamilyMatch: structuredFamily !== null && groundTruth.expectedFamilies.includes(structuredFamily),
      firstEffectfulPointerHit: scorePoint(
        structuredFrameBound,
        groundTruth.target,
        structuredEffectfulPoint(structured.action),
      ),
      semanticElementMatch: scoreSemanticElement(groundTruth.target, structured.action.targetElementId ?? null),
      exactTextMatch: scoreText(groundTruth.expectedText, structuredActionText(structured.action)),
      pendingSafetyCheckCount: 0,
      requiresConfirmation: structured.action.requiresConfirmation,
      guards: structuredGuards,
    },
    native: {
      mode: 'provider_native',
      executionDisposition: 'comparison_only',
      frameBound: nativeFrameBound,
      providerRequestCount: native.providerRequestCount,
      usage: { ...native.usage },
      actionKinds: native.actions.map((action) => action.kind),
      actionCount: native.actions.length,
      effectfulActionCount: nativeEffectfulActions,
      firstComparableFamily: nativeFamily,
      expectedFamilyMatch: nativeFamily !== null && groundTruth.expectedFamilies.includes(nativeFamily),
      firstEffectfulPointerHit: scorePoint(nativeFrameBound, groundTruth.target, firstNativeEffectfulPoint(native.actions)),
      semanticElementMatch: groundTruth.target?.elementId ? false : null,
      exactTextMatch: scoreText(groundTruth.expectedText, firstNativeText(native.actions)),
      pendingSafetyCheckCount: native.pendingSafetyChecks.length,
      requiresConfirmation: null,
      guards: nativeGuards,
    },
  }
}

/** Aggregates descriptive measurements only; it deliberately emits no winner. */
export function summarizeComputerActionComparisons(records: ComputerActionComparisonRecord[]): ComputerActionComparisonSummary {
  if (records.length === 0) throw new Error('At least one computer-action comparison record is required')
  return {
    trials: records.length,
    structured: summarizeMode(records.map((record) => record.structured)),
    native: summarizeMode(records.map((record) => record.native)),
    nativeSafetyCheckTrials: records.filter((record) => record.native.pendingSafetyCheckCount > 0).length,
    nativeBatchedEffectTrials: records.filter((record) => record.native.effectfulActionCount > 1).length,
  }
}

function summarizeMode(scores: ComputerActionModeScore[]): ComputerActionModeSummary {
  const pointerScores = scores
    .map((score) => score.firstEffectfulPointerHit)
    .filter((score): score is boolean => score !== null)
  const textScores = scores
    .map((score) => score.exactTextMatch)
    .filter((score): score is boolean => score !== null)
  const tokenValues = scores.map((score) => {
    const { inputTokens, outputTokens } = score.usage
    return inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens
  })
  return {
    trials: scores.length,
    frameBoundRate: ratio(scores.filter((score) => score.frameBound).length, scores.length),
    expectedFamilyMatchRate: ratio(scores.filter((score) => score.expectedFamilyMatch).length, scores.length),
    scorablePointerTrials: pointerScores.length,
    firstEffectfulPointerHitRate: pointerScores.length === 0 ? null : ratio(pointerScores.filter(Boolean).length, pointerScores.length),
    scorableTextTrials: textScores.length,
    exactTextMatchRate: textScores.length === 0 ? null : ratio(textScores.filter(Boolean).length, textScores.length),
    averageActionCount: average(scores.map((score) => score.actionCount)),
    averageEffectfulActionCount: average(scores.map((score) => score.effectfulActionCount)),
    totalProviderRequests: scores.reduce((total, score) => total + score.providerRequestCount, 0),
    totalTokens: tokenValues.some((value) => value === null)
      ? null
      : (tokenValues as number[]).reduce((total, value) => total + value, 0),
  }
}

function validateGroundTruth(groundTruth: ComputerActionComparisonGroundTruth): void {
  if (!groundTruth.scenarioId.trim()) throw new Error('A non-empty comparison scenario id is required')
  if (!groundTruth.frame.evidenceId.trim()) throw new Error('A non-empty comparison evidence id is required')
  positiveInteger(groundTruth.frame.width, 'groundTruth.frame.width')
  positiveInteger(groundTruth.frame.height, 'groundTruth.frame.height')
  if (groundTruth.expectedFamilies.length === 0 || new Set(groundTruth.expectedFamilies).size !== groundTruth.expectedFamilies.length) {
    throw new Error('Comparison ground truth requires unique expected action families')
  }
  if (groundTruth.target) {
    const { x, y, width, height } = groundTruth.target.bounds
    for (const [name, value] of Object.entries({ x, y, width, height })) {
      if (!Number.isFinite(value)) throw new Error(`groundTruth.target.bounds.${name} must be finite`)
    }
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > groundTruth.frame.width || y + height > groundTruth.frame.height) {
      throw new Error('Comparison target bounds must be positive and contained by the ground-truth frame')
    }
  }
}

function validateCandidate(name: string, providerRequestCount: number, usage: { inputTokens: number | null; outputTokens: number | null }): void {
  positiveInteger(providerRequestCount, name)
  for (const [tokenName, value] of Object.entries(usage)) {
    if (value !== null && (!Number.isInteger(value) || value < 0)) throw new Error(`${tokenName} must be null or a non-negative integer`)
  }
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
}

function sameFrame(expected: ComputerActionComparisonFrame, actual: ComputerActionComparisonFrame): boolean {
  return actual.evidenceId === expected.evidenceId && actual.width === expected.width && actual.height === expected.height
}

function structuredActionFamily(action: LiveComputerAction): ComparableComputerActionFamily | null {
  switch (action.kind) {
    case 'move':
    case 'click':
    case 'drag':
    case 'element_action': return 'pointer'
    case 'invoke_safe_command': return 'keyboard'
    case 'scroll': return 'scroll'
    case 'type':
    case 'type_into':
    case 'enter_sequence':
    case 'apply_artifact': return 'text'
    case 'keypress':
    case 'new_tab':
    case 'cycle_tab': return 'keyboard'
    case 'wait': return 'wait'
    case 'switch_window': return 'window'
    case 'conclude':
    case 'done': return 'terminal'
    case 'request_window':
    case 'ask_user':
    case 'handoff': return 'handoff'
  }
}

function nativeActionFamily(action: ComputerActionProposal): ComparableComputerActionFamily | null {
  switch (action.kind) {
    case 'click':
    case 'double_click':
    case 'move':
    case 'drag': return 'pointer'
    case 'scroll': return 'scroll'
    case 'type': return 'text'
    case 'keypress': return 'keyboard'
    case 'wait': return 'wait'
    case 'screenshot': return null
  }
}

function structuredActionIsEffectful(action: LiveComputerAction): boolean {
  return !['move', 'wait', 'ask_user', 'handoff', 'done', 'conclude'].includes(action.kind)
}

function nativeActionIsEffectful(action: ComputerActionProposal): boolean {
  return !['move', 'wait', 'screenshot'].includes(action.kind)
}

function structuredEffectfulPoint(action: LiveComputerAction): { x: number; y: number } | null {
  return ['click', 'drag', 'element_action', 'scroll', 'type_into'].includes(action.kind) ? action.point : null
}

function firstNativeEffectfulPoint(actions: ComputerActionProposal[]): { x: number; y: number } | null {
  for (const action of actions) {
    switch (action.kind) {
      case 'click':
      case 'double_click':
      case 'scroll': return action.point
      case 'drag': return action.path[0] ?? null
      default: break
    }
  }
  return null
}

function structuredActionText(action: LiveComputerAction): string | null {
  return action.kind === 'type' || action.kind === 'type_into' ? action.text : null
}

function firstNativeText(actions: ComputerActionProposal[]): string | null {
  return actions.find((action): action is Extract<ComputerActionProposal, { kind: 'type' }> => action.kind === 'type')?.text ?? null
}

function scorePoint(
  frameBound: boolean,
  target: ComputerActionComparisonTarget | null,
  point: { x: number; y: number } | null,
): boolean | null {
  if (!frameBound || !target || !point) return null
  const { x, y, width, height } = target.bounds
  return point.x >= x && point.x < x + width && point.y >= y && point.y < y + height
}

function scoreSemanticElement(target: ComputerActionComparisonTarget | null, actualElementId: string | null): boolean | null {
  return target?.elementId ? actualElementId === target.elementId : null
}

function scoreText(expected: string | null, actual: string | null): boolean | null {
  return expected === null ? null : actual === expected
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}
