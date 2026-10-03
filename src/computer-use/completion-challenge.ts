import { liveComputerNamesAuthorityCause } from '../live-computer-planning.js'
import { readComputerOutcome } from './outcome.js'

/**
 * Controller-owned stop authority for the Universal loop.
 *
 * A model's final report that admits unmet work ("partial" or "blocked") is a
 * proposal to stop, not a terminal fact. The controller accepts that proposal
 * only when the stop passed independent evidence review, or one of three
 * other things is true: the unmet work names a genuine
 * authority boundary (sign-in, payment, permission, a lost window...), the
 * approved budget has no meaningful room left, or an explicit challenge cap
 * was reached. Completion corrections consume the shared recovery allowance.
 * Otherwise the controller sends the model back to the same
 * goal with its own report as the receipt and asks for a materially different
 * in-scope route. One ticketing-site run is the reference case: the
 * model picked a listing with no online inventory, reported "partial" with
 * two open listings one click away, and two thirds of every budget unused.
 */

export interface CompletionChallengeBudget {
  remainingInputActions: number
  remainingProviderTurns: number
  remainingElapsedMs: number
  /** Null when the provider reports no usage; treated as room available. */
  remainingTotalTokens: number | null
  remainingRecoveryEpisodes?: number
}

/** Below any of these the run is close enough to its ceiling that a fresh
 * chain would end at a budget checkpoint instead of finishing the work. */
export const completionChallengeBudgetFloor = {
  inputActions: 3,
  providerTurns: 3,
  elapsedMs: 45_000,
  totalTokens: 20_000,
} as const

export type CompletionChallengeAssessment =
  | { challenge: true; reportedStatus: 'partial' | 'blocked'; message: string; remaining: string[] }
  | {
    challenge: false
    reportedStatus: 'completed' | 'partial' | 'blocked' | 'unclassified'
    reason: 'completed' | 'unclassified' | 'authority_boundary' | 'challenge_spent' | 'budget_exhausted' | 'independently_reviewed'
  }

export function assessCompletionChallenge(
  terminalText: string | null,
  state: { challengesUsed: number; maxChallenges: number | null; budget: CompletionChallengeBudget; independentlyVerifiedStop?: boolean },
): CompletionChallengeAssessment {
  const report = readComputerOutcome(terminalText)
  if (report.status === 'completed') return { challenge: false, reportedStatus: report.status, reason: 'completed' }
  // A prose answer with no report is a format failure, not an admission of
  // unmet work; the caller's completion assessment owns that case.
  if (report.status === 'unclassified') return { challenge: false, reportedStatus: report.status, reason: 'unclassified' }
  if (state.independentlyVerifiedStop) return { challenge: false, reportedStatus: report.status, reason: 'independently_reviewed' }
  // The remaining clauses are the model's own statement of why it stopped.
  // Only when it gave none does the message stand in, because a message can
  // legitimately mention purchases or accounts it was told to avoid.
  const boundaryText = report.remaining.length > 0 ? report.remaining.join('\n') : report.message
  if (liveComputerNamesAuthorityCause(boundaryText)) return { challenge: false, reportedStatus: report.status, reason: 'authority_boundary' }
  if (state.maxChallenges !== null && state.challengesUsed >= state.maxChallenges) return { challenge: false, reportedStatus: report.status, reason: 'challenge_spent' }
  if (!completionChallengeHasRoom(state.budget)) return { challenge: false, reportedStatus: report.status, reason: 'budget_exhausted' }
  return { challenge: true, reportedStatus: report.status, message: report.message, remaining: report.remaining }
}

export function completionChallengeHasRoom(budget: CompletionChallengeBudget): boolean {
  return budget.remainingInputActions >= completionChallengeBudgetFloor.inputActions
    && budget.remainingProviderTurns >= completionChallengeBudgetFloor.providerTurns
    && budget.remainingElapsedMs >= completionChallengeBudgetFloor.elapsedMs
    && (budget.remainingTotalTokens === null || budget.remainingTotalTokens >= completionChallengeBudgetFloor.totalTokens)
    && (budget.remainingRecoveryEpisodes ?? 1) >= 1
}

const maximumReceiptCharacters = 1_600

/** The restart prompt for a challenged stop. Mission-agnostic: it carries the
 * model's own report back as the receipt and names the general shape of an
 * acceptable alternative, never a task-specific instruction. */
export function universalCompletionChallengePrompt(
  originalPrompt: string,
  state: {
    reportedStatus: 'partial' | 'blocked'
    message: string
    remaining: string[]
    providerTurns: number
    inputActionsCompleted: number
    maximumInputActions: number
    remainingProviderTurns: number
    remainingElapsedMs: number
  },
): string {
  const remaining = state.remaining.length > 0
    ? state.remaining.slice(0, 8).map((clause) => `  - ${clause.slice(0, 400)}`).join('\n')
    : '  - (the report listed no remaining items; the status alone claimed the work was unfinished)'
  const minutes = Math.max(1, Math.floor(state.remainingElapsedMs / 60_000))
  return [
    originalPrompt,
    '',
    'Carve completion challenge receipt (authoritative controller state):',
    `- The previous provider chain ended with a "${state.reportedStatus}" report while the approved budget still had room. The controller, not the report, decides when this run ends; that chain was closed and this is a fresh one with the same goal, window, permissions, and prohibitions.`,
    '- The prior report, verbatim, so nothing already learned is lost:',
    `<prior_report>${state.message.slice(0, maximumReceiptCharacters)}</prior_report>`,
    '- Work the prior report itself said was still unmet:',
    remaining,
    `- Budget remaining: ${Math.max(0, state.maximumInputActions - state.inputActionsCompleted)} physical inputs of ${state.maximumInputActions}, ${state.remainingProviderTurns} provider turns, about ${minutes} minute${minutes === 1 ? '' : 's'}. Provider turns already used: ${state.providerTurns}.`,
    '- The unmet work is inside the approved outcome. If the route you took cannot produce it, choose a materially different in-scope route that can: another listing, result, source, page, filter, date, or search visible in the same window. Not being able to finish by one route is not a boundary; report the route you tried and what the alternative showed.',
    '- Stop early for an evidence-supported authority boundary — sign-in, an account, a payment, a credential, a permission, a CAPTCHA, a deletion, personal information only the person has, or a lost window — or for established source unavailability after one fresh retry with no observed useful alternative route. Honor an explicitly requested retry policy. Name the boundary or unavailable requirement in the remaining items and preserve supported facts without guessing; independent review decides whether this limited report and stopping point are justified.',
    '- Begin by requesting a fresh screenshot and treat it as authoritative. Correct reversible fields or content identified as wrong by the remaining requirements; an earlier input receipt proves delivery, not correctness. Preserve matching values and the requested final stopping point. Do not repeat submissions, purchases, messages, or other irreversible effects.',
    '- Finish with the same final report format as before. Report completed only when you observed evidence that every requested outcome was achieved.',
  ].join('\n')
}
