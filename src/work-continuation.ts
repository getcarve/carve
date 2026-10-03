import type { WorkBudgetPreset } from './types.js'

export type WorkContinuationKind = 'answer_about_result' | 'continue_same_work' | 'new_task' | 'ambiguous'

export type WorkContinuationReasonCode =
  | 'explicit_new_task'
  | 'references_prior_result'
  | 'asks_for_prior_result'
  | 'new_outcome'
  | 'insufficient_context'

export interface WorkContinuationDecision {
  kind: WorkContinuationKind
  reasonCodes: WorkContinuationReasonCode[]
  priorContextNeeded: boolean
  sameWindowRecommended: boolean
  requiresTargetConfirmation: boolean
  requiresContractReview: boolean
  classifier: 'deterministic'
}

const explicitNewTaskPattern = /\b(?:there(?:'|’)s |there is )?(?:another|a new|the next|a different) task\b|\b(?:start|begin) (?:another|a new|the next|a different) (?:task|job|request)\b|\b(?:new|next|different) (?:task|goal|job|request)\b|\bchange (?:the )?goal\b/iu
const priorResultQuestionPattern = /^(?:what (?:exactly )?did you (?:do|change|find)|summari[sz]e (?:what you did|the result)|what (?:was|is) (?:the )?result|tell me what you (?:did|changed|found))(?:\?|[.!])?$/iu
const priorReferencePattern = /\b(?:it|that|this|the same|also|too|instead|again|title|result|answer|document|sheet|page|chart)\b/iu
const vagueContinuationPattern = /^(?:and )?(?:one more thing|one|something|anything|another thing)(?: else| more)?[.!]?$/iu

/**
 * Routes text submitted from a completion surface before it can inherit a
 * prior result or selected window. High-precision deterministic phrases win;
 * uncertain short fragments ask for a choice instead of silently widening
 * authority. Everything else remains a continuation for backward-compatible
 * conversational behavior.
 */
export function classifyWorkContinuation(text: string): WorkContinuationDecision {
  const normalized = normalize(text)
  if (!normalized) return decision('ambiguous', ['insufficient_context'])
  if (explicitNewTaskPattern.test(normalized)) {
    return decision('new_task', ['explicit_new_task', 'new_outcome'])
  }
  if (priorResultQuestionPattern.test(normalized)) {
    return decision('answer_about_result', ['asks_for_prior_result', 'references_prior_result'])
  }
  if (vagueContinuationPattern.test(normalized) || normalized.split(' ').length < 2) {
    return decision('ambiguous', ['insufficient_context'])
  }
  return decision('continue_same_work', priorReferencePattern.test(normalized) ? ['references_prior_result'] : [])
}

/** A conservative planning-time recommendation. It never changes the budget
 * without the person's review; it only preselects the most credible tier for
 * a fresh task routed out of the completion capsule. */
export function recommendContinuationBudget(text: string): WorkBudgetPreset {
  const normalized = normalize(text)
  const research = /\b(?:research|look up|find|compare|investigate|sources?|online|web)\b/u.test(normalized)
  const structuredArtifact = /\b(?:spreadsheet|google sheet|excel|table|chart|graph|report|presentation|slides?)\b/u.test(normalized)
  const manyRecords = /\b(?:years?|months?|records?|rows?|items?|trends?|over the past|history|historical)\b/u.test(normalized)
  if ((research && structuredArtifact) || (structuredArtifact && manyRecords)) return 'thorough'
  if (research || structuredArtifact || manyRecords) return 'balanced'
  return 'quick'
}

/** Removes the conversational handoff phrase from a clearly new task while
 * preserving the person's actual request verbatim. If no concrete remainder
 * exists, keep the original text so the fresh composer can ask for detail. */
export function extractNewTaskGoal(text: string): string {
  const trimmed = text.trim()
  const marker = /\b(?:(?:there(?:'|’)s|there is)\s+)?(?:another|a new|the next|a different|new|next|different)\s+(?:task|goal|job|request)(?:\s+i\s+want\s+you\s+to\s+work\s+on)?(?:\s+is)?(?:\s+to)?\b/iu.exec(trimmed)
    ?? /\b(?:start|begin)\s+(?:another|a new|the next|a different)\s+(?:task|job|request)\b/iu.exec(trimmed)
  if (!marker) return trimmed
  const remainder = trimmed.slice(marker.index + marker[0].length).replace(/^[\s:;,.!?—-]+/u, '').trim()
  return remainder || trimmed
}

function decision(kind: WorkContinuationKind, reasonCodes: WorkContinuationReasonCode[]): WorkContinuationDecision {
  const newTask = kind === 'new_task'
  return {
    kind,
    reasonCodes,
    priorContextNeeded: kind === 'continue_same_work' || kind === 'answer_about_result',
    sameWindowRecommended: kind === 'continue_same_work',
    requiresTargetConfirmation: newTask,
    requiresContractReview: newTask || kind === 'ambiguous',
    classifier: 'deterministic',
  }
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ')
    .trim()
}
