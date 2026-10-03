/** Which action engine a selected window gets, and when a stopped compact
 * attempt hands the same task to the screenshot loop.
 *
 * Evidence, from comparison runs: on
 * browser windows the ref-based compact engine matches or beats the Thin loop
 * on correctness at a third of the median latency and lower cost; on native
 * windows (Finder, a Fonts panel, window management) it loops or times out
 * where Thin recovers. A router that sends the web to compact and everything
 * else to Thin would have scored above either engine on that run, and the
 * compact failures that remain end in a controller signal the same second the
 * loop detects it, cheaply, so a one-shot fallback to Thin catches them.
 *
 * Nothing here grants authority: the routed engine runs under the same
 * contract, window authorization, supervision and budget as the requested one.
 */
import type { LiveComputerActionEngine, LiveComputerTarget, UniversalComputerSession, WorkBudgetEnvelope } from '../types.js'
import { liveComputerSurfaceKind } from '../live-computer-capabilities.js'
import type { SelectedWindowInputLedgerEntry } from './selected-window-backend.js'

export type RoutedEngine = Extract<LiveComputerActionEngine, 'compact_v1' | 'openai_thin_v1'>

export interface EngineRoute {
  engine: RoutedEngine
  surface: 'browser' | 'native'
  /** Short machine-readable reasons, for the audit and the tests; never page content. */
  reasons: string[]
}

/** Asks that reach past the selected window: other windows, other apps, the
 * desktop. Neither engine can act there, and the Thin loop is the one that
 * says so in words instead of looping. */
const beyondOneWindow = /\b(?:other|all|every|the rest of (?:the|my))\s+(?:windows?|apps?|applications?|tabs?)\b|\bswitch(?:ing)? to\b|\bin (?:another|a different|the other) (?:window|app|application|tab)\b/iu

export function routeEngine(target: Pick<LiveComputerTarget, 'application' | 'bundleIdentifier'>, goal: string): EngineRoute {
  const surface = liveComputerSurfaceKind(target)
  const reasons: string[] = [`surface:${surface}`]
  if (beyondOneWindow.test(goal)) {
    reasons.push('goal:beyond_one_window')
    return { engine: 'openai_thin_v1', surface, reasons }
  }
  if (surface === 'browser') return { engine: 'compact_v1', surface, reasons }
  reasons.push('native:thin')
  return { engine: 'openai_thin_v1', surface, reasons }
}

/** A compact stop the Thin loop can take over from: the controller stopped
 * the attempt for a reason about the attempt, not about money or a decision
 * the person made. A declined checkpoint, an exhausted budget or provider
 * credit, a site's human-verification check and a completed task are final. */
const recoverableStop = /repeated the same ineffective batch|remained identical for|final check rejected the answer|failed \d+ action batches|Compact desktop observation|kept proposing actions beyond|no longer exposes|cannot be used for|obstructed or unstable|not proven focused|remaining program stopped|deadline|changed nothing visible|proposed the same action|decisions the controller could not run|withheld \d+ times for the same reason/iu
// A human-verification check is the person's to complete; another engine must not meet it again.
const finalStop = /credit|ceiling|budget|declined|approval|exhausted|quota|cancel|stopped by|human-verification/iu
// Stops the second engine has never recovered from: across 62 hand-offs in one evaluation, a page
// that stayed identical (0 of 10), decisions the controller could not run (0 of 6) and failing batches (0 of
// 1) all ended blocked again, 30 to 130 s later. The four rescues followed a refused answer or a repeated
// batch. These stops keep the compact attempt's own reviewed closing report instead.
const unrescuedStop = /remained identical for|decisions the controller could not run|failed \d+ action batches/iu

export function engineFallbackEligible(session: Pick<UniversalComputerSession, 'status' | 'reason' | 'actionEngine' | 'routedFrom' | 'engineFallback' | 'reportedOutcome'> & Partial<Pick<UniversalComputerSession, 'terminalSourceStatus'>>): boolean {
  if (session.routedFrom !== 'router_v1' || session.actionEngine !== 'compact_v1' || session.engineFallback) return false
  if (session.status !== 'blocked' || !session.reason) return false
  // A reviewed actor stop is final. A controller-generated partial receipt
  // after a stalled attempt can still benefit from another engine.
  if (session.terminalSourceStatus === 'completed' && (session.reportedOutcome === 'partial' || session.reportedOutcome === 'blocked')) return false
  return recoverableStop.test(session.reason) && !finalStop.test(session.reason) && !unrescuedStop.test(session.reason)
}

/** A provider with no stateful computer-use session can drive the compact engine only: browser windows run on
 * it, and a window the router would have given to the Thin loop is declined before anything starts, with a
 * message that says what would work. */
export function routeForCompactOnlyProvider(route: EngineRoute, providerName: string): EngineRoute {
  if (route.engine === 'compact_v1') return route
  if (route.surface === 'browser') return { engine: 'compact_v1', surface: 'browser', reasons: [...route.reasons, 'provider_without_sessions'] }
  throw new Error(`${providerName} can work in browser windows. Acting in other Mac apps needs a provider with computer-use sessions, such as OpenAI.`)
}

/** Whether a routed compact stop with this reason will start the Thin
 * fallback, judged at the stop with the rules startEngineFallback applies
 * once the session is terminal: eligibility, and enough of the first
 * attempt's envelope left for a second engine. When it will not, the compact
 * attempt writes its own closing report (in testing:
 * such stops ended with the controller's sentence and nothing found). */
export function routedStopWillHandOff(
  session: Pick<UniversalComputerSession, 'actionEngine' | 'routedFrom' | 'engineFallback' | 'inputActionsCompleted' | 'startedAt' | 'semanticRecoveryEpisodes'>,
  budget: WorkBudgetEnvelope,
  reason: string | null,
  used: { modelCalls: number; inputTokens: number; outputTokens: number; visionFrames: number },
  now = Date.now(),
): boolean {
  if (!reason || !engineFallbackEligible({ status: 'blocked', reason, ...(session.actionEngine ? { actionEngine: session.actionEngine } : {}),
    ...(session.routedFrom ? { routedFrom: session.routedFrom } : {}), ...(session.engineFallback ? { engineFallback: session.engineFallback } : {}) })) return false
  // The fallback also pays for its own preparation (a fresh contract and route
  // intent) before it measures what is left. Without that reserve a stop with
  // 36K of 600K tokens left predicted a handoff, the fallback then declined,
  // and the run ended with neither (seen in a retest).
  const reserve = fallbackPreparationReserve
  return remainingFallbackBudget(budget, { actions: session.inputActionsCompleted, minutes: Math.max(0, now - Date.parse(session.startedAt)) / 60_000,
    modelCalls: used.modelCalls + reserve.modelCalls, tokens: used.inputTokens + used.outputTokens + reserve.tokens,
    visionFrames: used.visionFrames + reserve.visionFrames, recoveryEpisodes: session.semanticRecoveryEpisodes }) !== null
}

/** A conservative bound on what preparing the fallback's contract costs. */
export const fallbackPreparationReserve = { modelCalls: 4, tokens: 40_000, visionFrames: 2 }

/** What the compact attempt already delivered, for the Thin loop's note:
 * kinds and control labels only, never typed text or key contents. */
export function summarizeInputLedger(entries: readonly SelectedWindowInputLedgerEntry[]): string[] {
  return entries.slice(-12).map(entry => {
    const where = entry.label ? ` on "${entry.label.slice(0, 40)}"${entry.role ? ` (${entry.role})` : ''}` : entry.role ? ` on a ${entry.role}` : ''
    if (entry.kind === 'type') return `typed ${entry.characters ?? '?'} characters${where}`
    if (entry.kind === 'keypress') return `pressed a key${where}`
    if (entry.kind === 'scroll') return 'scrolled'
    return `${entry.kind}${where}`
  })
}

/** The note the Thin loop reads when it takes over. It is controller state,
 * not a new request, and it says so. */
export function engineFallbackNote(fallback: { reason: string; ledger: string[]; uncertainInputs?: string[]; executedEffectClasses: string[] }): string {
  const uncertain = fallback.uncertainInputs ?? []
  return [
    'Controller handoff (authoritative controller state, not a new user request): a first attempt on this same task, in this same window, stopped with the reason: ' + JSON.stringify(fallback.reason.slice(0, 300)) + '.',
    fallback.ledger.length
      ? 'Inputs that attempt already delivered, in order (labels only): ' + fallback.ledger.join('; ') + '. These receipts prove input delivery, not the intended outcome. Inspect the current screen, preserve correct values, and correct only unfinished reversible work. Do not repeat a consequential action unless observed evidence establishes that it did not take effect and the existing authorization still covers retrying it.'
      : uncertain.length ? 'That attempt has no confirmed input deliveries.' : 'That attempt delivered no input.',
    uncertain.length ? 'Inputs whose delivery was not confirmed: ' + uncertain.join('; ') + '. These attempts prove neither success nor inaction. Inspect the current outcome before proceeding; never blindly replay an uncertain mutation.' : null,
    fallback.executedEffectClasses.length ? 'Effect classes already executed: ' + fallback.executedEffectClasses.join(', ') + '.' : null,
    'Continue only the unfinished part of the request from the current screen. If the earlier attempt already achieved the request, verify and report it rather than redoing it.',
  ].filter(Boolean).join(' ')
}

/** What the fallback attempt may still spend: the first attempt's envelope
 * less what it used. A fresh envelope at the same preset (the earlier
 * spike) let one task cost two budgets and, in the harness, run past a
 * deadline the single engine would have met. Null when too little is left
 * for a second engine to do anything: three actions or half a minute. */
export function remainingFallbackBudget(budget: WorkBudgetEnvelope, used: { actions: number; minutes: number; modelCalls: number; tokens: number; visionFrames?: number; recoveryEpisodes?: number }): WorkBudgetEnvelope | null {
  if (Object.values(used).some(value => value !== undefined && (!Number.isFinite(value) || value < 0))) return null
  const maxActions = budget.maxActions - Math.max(0, used.actions)
  const maxDurationMinutes = budget.maxDurationMinutes - Math.max(0, used.minutes)
  if (maxActions < 3 || maxDurationMinutes < 0.5) return null
  const remaining: WorkBudgetEnvelope = { ...budget, maxActions, maxDurationMinutes: Math.round(maxDurationMinutes * 100) / 100 }
  if (budget.maxModelCalls !== undefined) {
    remaining.maxModelCalls = budget.maxModelCalls - Math.max(0, used.modelCalls)
    if (remaining.maxModelCalls < 2) return null
  }
  if (budget.maxTotalTokens !== undefined) {
    remaining.maxTotalTokens = budget.maxTotalTokens - Math.max(0, used.tokens)
    if (remaining.maxTotalTokens < 4_000) return null
  }
  if (budget.maxVisionFrames !== undefined) {
    if (used.visionFrames === undefined) return null
    remaining.maxVisionFrames = budget.maxVisionFrames - used.visionFrames
    if (remaining.maxVisionFrames < 2) return null
  }
  if (budget.maxRecoveryEpisodes !== undefined) {
    if (used.recoveryEpisodes === undefined) return null
    remaining.maxRecoveryEpisodes = budget.maxRecoveryEpisodes - used.recoveryEpisodes
    if (remaining.maxRecoveryEpisodes < 1) return null
  }
  return remaining
}
