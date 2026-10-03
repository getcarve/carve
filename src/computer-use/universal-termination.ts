import { isComputerActionValidationFailure } from './batch.js'
import type { UniversalComputerUseStatus } from './universal.js'
import { captureRefusalLabelEnabled, screenCaptureRefused } from '../capture-refusal.js'
import type { LiveComputerTerminalCategory, UniversalComputerSession } from '../types.js'

export interface UniversalTermination {
  kind: Exclude<UniversalComputerSession['terminalKind'], null>
  category: LiveComputerTerminalCategory
  resumable: boolean
}

/** One exhaustive source of truth for Universal end states. A coarse blocked
 * session may never decide that every failure was a provider error. */
export function classifyUniversalTermination(status: UniversalComputerUseStatus, reason: string | null): UniversalTermination {
  switch (status) {
    case 'completed': return { kind: 'completed', category: null, resumable: false }
    case 'safety_check': return { kind: 'safety_hold', category: 'safety_block', resumable: false }
    case 'provider_turn_limit': return { kind: 'execution_limit', category: 'execution_limit', resumable: false }
    case 'action_limit': return { kind: 'execution_limit', category: 'execution_limit', resumable: true }
    case 'token_limit': return { kind: 'execution_limit', category: 'execution_limit', resumable: false }
    case 'time_limit': return { kind: 'execution_limit', category: 'execution_limit', resumable: true }
    case 'stalled': return { kind: 'stalled', category: 'needs_user', resumable: true }
    case 'replan_required': return { kind: 'planning_failure', category: 'planning_error', resumable: true }
    case 'cancelled': return { kind: 'user_stopped', category: null, resumable: false }
    // A billed verdict that refused the answer is neither an outage nor a
    // stall: the person can resume from the verified progress.
    case 'verification_rejected': return { kind: 'verification_rejected', category: 'needs_user', resumable: true }
    case 'failed': return isComputerActionValidationFailure(reason)
      ? { kind: 'planning_failure', category: 'planning_error', resumable: true }
      : environmentFailure(reason)
      ? { kind: 'environment_failure', category: 'environment_error', resumable: true }
      : { kind: 'provider_failure', category: 'provider_error', resumable: true }
  }
}

function environmentFailure(reason: string | null): boolean {
  // Every local-helper message starts with this phrase, and each one is a
  // failure of Carve's own macOS helper process — a spawn, a stall, a bad
  // response. Without it here they fall through to the provider branch below
  // and the capsule tells the person their model timed out when the model
  // answered normally seconds earlier.
  if (/\blive computer helper\b/iu.test(reason ?? '')) return true
  // A refused screen capture (ScreenCaptureKit -3801) is macOS declining Carve, not the model (assess-0929 C02).
  if (captureRefusalLabelEnabled() && screenCaptureRefused(reason)) return true
  return /\b(?:backend failed|capture failed|selected window|window (?:changed|disappeared|could not)|input bridge|accessibility|screen recording|mechanical execution failure)\b/iu.test(reason ?? '')
}

/** Plain names for the effect class a checkpoint was raised over. The person is told
 * what Carve was about to do, in their words, not the vocabulary's. */
const effectClassPhrase: Partial<Record<string, string>> = {
  authentication: 'sign in',
  communication: 'send a message',
  submission: 'submit a form',
  financial: 'make a payment',
  destructive: 'delete something',
  installation: 'install software',
  legal_acceptance: 'accept terms',
  privilege_escalation: 'change a system permission',
  confidential_disclosure: 'share private information',
  high_impact_decision: 'make a decision you had not approved',
  external_write: 'change something outside this device',
  unclassified_control: 'use a control it could not identify',
}

/**
 * What to say when a supervision checkpoint is declined and the run stops.
 *
 * Until 19 September this was the empty string, then a generic sentence naming
 * neither the ask nor the work already done. The live audit's cancelled sessions
 * and the suite's `signin-wall-partial` case are the same defect from two sides:
 * the person is left with nothing, having watched Carve work.
 */
export function supervisionDeclineReport(input: {
  effectClasses: readonly string[]
  inputActionsCompleted: number
  declined: 'stop' | 'replan'
}): string {
  if (input.declined === 'replan') return 'The held computer batch required a fresh plan; none of it ran'
  const named = input.effectClasses.map(c => effectClassPhrase[c]).filter((p): p is string => Boolean(p))
  const ask = named.length ? `Carve stopped because it needed your approval to ${named[0]}, and that was declined.` : 'Carve stopped at a checkpoint that was declined.'
  const done = input.inputActionsCompleted > 0
    ? ` It had already completed ${input.inputActionsCompleted} ${input.inputActionsCompleted === 1 ? 'step' : 'steps'} before that; nothing since has run.`
    : ' Nothing had run before that.'
  return ask + done
}

/** A report that stops short (partial, blocked, or missing a clause) can be continued. `STEWARD_PARTIAL_RESUMABLE=off` makes it terminal again. */
export const partialResumableEnabled = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_PARTIAL_RESUMABLE?.trim().toLowerCase() !== 'off'
/** Continue carries the previous report, what it left, and the person's note. `STEWARD_RETRY_CONTINUATION=off` sends the bare retry. */
export const retryContinuationEnabled = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_RETRY_CONTINUATION?.trim().toLowerCase() !== 'off'

/** What a fresh attempt inherits from the one it continues. Bounded; the report is the model's words, not evidence. */
export interface UniversalRetryContinuation {
  priorReport: string | null
  remaining: string[]
  /** The person's own guidance for this attempt, typed in the capsule or the main window. */
  note: string | null
}

export const maximumRetryNoteCharacters = 1_000

export function universalRetryContinuation(previous: Pick<UniversalComputerSession, 'terminalText' | 'remainingClauses'>, note?: string | null): UniversalRetryContinuation | null {
  const priorReport = previous.terminalText?.trim().slice(0, 3_000) || null
  const remaining = (previous.remainingClauses ?? []).map(item => item.trim()).filter(Boolean).slice(0, 8).map(item => item.slice(0, 300))
  const trimmedNote = note?.replace(/\s+/gu, ' ').trim().slice(0, maximumRetryNoteCharacters) || null
  return priorReport || remaining.length || trimmedNote ? { priorReport, remaining, note: trimmedNote } : null
}

export function universalRetryContinuationPrompt(continuation: UniversalRetryContinuation): string {
  return [
    'The person chose Continue on the earlier attempt at this same request.',
    continuation.priorReport ? `The earlier attempt ended with this report (its own words: a reference for what was already found and done, not verified evidence, and possibly stale): ${JSON.stringify(continuation.priorReport)}` : null,
    continuation.remaining.length ? `It said this was still to do: ${JSON.stringify(continuation.remaining)}. Start there; findings the report already gives need not be gathered again unless the current page shows they changed. The final report must still answer the whole request.` : null,
    continuation.note ? `The person's guidance for continuing, written by them for this attempt: ${JSON.stringify(continuation.note)}. It is part of this attempt's request and replaces the original request where they conflict. It stays inside the authorized window, and anything sent, bought, deleted or submitted still needs its own approval.` : null,
    'If the earlier attempt stopped at a sign-in or a check, the person may have handled it since: look at the current window before concluding it is still there.',
  ].filter(Boolean).join('\n')
}

/** A request typed after a stop the person can continue ("keep going", "try the seat map") continues that run with the
 * text as its note, instead of starting over without what was found. `STEWARD_BLOCKED_TYPED_CONTINUE=off` starts fresh. */
export const blockedTypedContinueEnabled = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_BLOCKED_TYPED_CONTINUE?.trim().toLowerCase() !== 'off'

/** The request a continued run is held to when the person wrote something with Continue. The note is theirs, typed for
 * this attempt, so it is part of what they asked: the action reviewer, the extracted field values and the final check all
 * read the run's goal, and a note kept only in the actor's prompt let them judge against what the person had just
 * retracted ("Sorry, wrong country. Change it to Canada…": the reviewer refused Canada as off-task and approved
 * saving the old address). Where the two conflict, the note wins. */
export function goalWithPersonNote(goal: string, note: string | null | undefined): string {
  const text = note?.replace(/\s+/gu, ' ').trim()
  if (!text) return goal
  return `${goal.trim()}\n\nThe person then said, for this attempt: ${JSON.stringify(text)}. Where this conflicts with the request above, it replaces it.`
}

/** The typed text as a note, or null when it only says to go on. */
export function typedContinueNote(request: string): string | null {
  const text = request.replace(/\s+/gu, ' ').trim()
  return !text || /^(?:(?:ok(?:ay)?|yes|please)[,.!]?\s+)*(?:continue|keep going|go on|go ahead|try again|resume|carry on|pick (?:it )?up(?: where you left off)?)(?:\s+please)?[.!]*$/iu.test(text) ? null : text.slice(0, maximumRetryNoteCharacters)
}
