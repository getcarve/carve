import { isBrowserBundleIdentifier } from './effects.js'
/** Time policy for read-only work: how long a run that only reads may keep
 * working before the person gets what it has established.
 *
 * Previously the only bound on a read was a soft reminder at 40 s
 * (compact actor prompt) and the session's hard limits (minutes). In one round
 * (46 valid runs) the slow read runs spent their time on
 * repeated final-check rejections and repairs (a multi-site read: 6 checks
 * and 2 strong-model repairs, then a second engine; 350 s) and on a hand-off
 * that re-found the same limitation (a forecast page: 203 s, nothing
 * useful). Sol checks and repairs were 87% of the campaign's cost.
 *
 * The policy, by task family (budgets are active time: approval waits and
 * human think time are excluded, as they are for the session's own limit):
 *  - page_read: the answer is on the page already open (summarize, explain,
 *    what does this page say). Remind at 20 s, close input at 45 s.
 *  - site_lookup: one site, a few steps (search, a filter or sort, a product
 *    page). Remind at 40 s, close input at 100 s.
 *  - multi_source: two sources or a sequence (then, compare A and B).
 *    Remind at 70 s, close input at 170 s.
 * At the hard budget the controller closes input and asks for the reviewed
 * closing report (what is established, what is missing), which is final: no
 * second engine re-runs a read the person has already waited for. Earlier, a
 * refused answer whose supported part the final check wrote down ends the
 * read with that supported part instead of a hand-off.
 *
 * Only read requests get this policy. A request that asks Carve to change
 * something (fill, type, create, save, send, book, buy, ask another app…) or
 * whose compiled requirements name values to enter keeps the ordinary limits,
 * so a partly finished write is never cut off by a read budget. The budget
 * never widens what Carve may do: approvals, privacy and the selected window
 * are enforced exactly as before.
 */

export type ReadTaskFamily = 'page_read' | 'site_lookup' | 'multi_source'

export interface ReadRecoveryPolicy {
  family: ReadTaskFamily
  /** After this the actor is told, every turn, to report now if the evidence answers the request. */
  softMs: number
  /** After this input closes and the reviewed closing report is the answer. */
  hardMs: number
}

const budgets: Record<ReadTaskFamily, { softMs: number; hardMs: number }> = {
  page_read: { softMs: 20_000, hardMs: 45_000 },
  site_lookup: { softMs: 40_000, hardMs: 100_000 },
  multi_source: { softMs: 70_000, hardMs: 170_000 },
}

/** Clauses that forbid an action ("don't buy anything", "without signing in") name no action to take. */
const negatedClause = /\b(?:don['’]?t|do not|never|without|no need to|not)\s+(?:\w+\s+){0,3}?\w+/giu
/** Requests to change something, in the selected window or anywhere else, as a verb the request gives ("fill
 * in", "then book", "can you send"), not a noun ("proof of purchase", "Store Name"). Sorting or filtering a listing,
 * opening a page and searching are ways of reading. */
const changeVerbs = String.raw`(?:fill(?:\s+(?:in|out))?|type|enter\s+(?:my|the|a|an|this|these|in)|add|mark|check\s+off|tick|toggle|turn\s+(?:on|off)|enable|disable|clear|empty|update|set\s+(?:up|it|this|the|a|my|to)|create|save|send|post|publish|book|reserve|buy|purchase|order|check\s*out|sign\s+(?:in|up|me)|log\s+in|submit|delete|remove|edit|change|rename|move|format|freeze|insert|write|draft|prepare|put|upload|schedule|invite|share|message|reply|email|ask\s+(?!me|for)\w+|play|download|install|apply\s+for|register|subscribe|rsvp|rent|use\s+(?:this|the|that)\s+\w+\s+to|calculate|work\s+out|complete)`
const changeRequest = new RegExp(String.raw`(?:^|[.?!;:,]\s*|\b(?:and|then|please|to|you|also|just|now|first|go|me)\s+)${changeVerbs}\b`, 'iu')
const multiSource = /\b(?:then|and\s+then|compare|comparison|versus|vs\.?|both|as\s+well\s+as)\b/iu
/** Two named places: "at Store A and Store B". */
const twoPlaces = /\bat\s+[A-Z][\w&.'’-]+(?:\s+[A-Z][\w&.'’-]+)?\s+and\s+(?:at\s+)?[A-Z]/u
const currentPage = /\b(?:this|the\s+current|the\s+open)\s+(?:page|article|site|post|story|list|table|document|video|thread|listing|product|recipe)\b|^\s*summari[sz]e(?:\s+(?:it|this|here))?\s*[.?!]?\s*$|\bon\s+(?:this|the)\s+page\b|\bshown\s+here\b/iu
/** A named place other than the open page: "at Store A", "on Site B", "from Site C", a domain. */
const otherSource = /\b(?:at|on|from)\s+(?!this\b|the\b|a\b|an\b)[A-Z][\w&.'’-]+|\b[\w-]+\.(?:com|org|net|co|io|gov|edu)\b/u
const goesElsewhere = /\b(?:go\s+to|open|navigate|search|look\s+up|visit|head\s+to|on\s+[A-Z][\w&.'’-]+(?:['’]s)?\s+(?:site|website))\b/iu

/** A request for information: a question, or a verb that asks to be told, shown or found something. */
const informationCue = /\?|\b(?:what|which|who|whom|whose|when|where|why|how|is|are|was|were|does|do|did|can|could|list|find|show|tell|give|summari[sz]e|explain|compare|look\s+(?:up|at|for|into)|search|check\s+(?:how|what|whether|if|the)|browse|read|describe|recommend|sort|filter)\b/iu

/** The read family of a request, or null when the request asks for a change or is not plainly a request for
 * information. When unsure, no read budget: a write must never be cut off by one (in testing: "Add "buy milk" to
 * this list and mark it as done" was taken for a page read and stopped mid-task). */
export function readTaskFamily(goal: string): ReadTaskFamily | null {
  const affirmative = goal.replace(negatedClause, ' ')
  if (changeRequest.test(affirmative) || !informationCue.test(affirmative)) return null
  if (multiSource.test(goal) || twoPlaces.test(goal)) return 'multi_source'
  // The open page and another named source ("what does this page say …, and how much is it at Store A?").
  if (currentPage.test(goal) && (goesElsewhere.test(goal) || otherSource.test(goal))) return 'multi_source'
  if (currentPage.test(goal)) return 'page_read'
  return 'site_lookup'
}

/** Read budgets apply to browser windows; native apps keep the session's ordinary limits. */
export function readBudgetAppliesToTarget(bundleIdentifier: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.STEWARD_READ_BUDGET_BROWSER_ONLY?.trim().toLowerCase() === 'off') return true
  return isBrowserBundleIdentifier(bundleIdentifier)
}

/** `STEWARD_READ_RECOVERY=off` restores the earlier behaviour: one 40 s reminder, no read budget. */
export function readRecoveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_READ_RECOVERY?.trim() !== 'off'
}

/** The policy for this request, or null for a change request, a request that compiled values to enter, or when the
 * policy is off. `STEWARD_READ_BUDGET_SCALE` (0.25–4) scales every budget for experiments. */
export function readRecoveryPolicy(goal: string, options: { requestedValues?: number; env?: NodeJS.ProcessEnv } = {}): ReadRecoveryPolicy | null {
  const env = options.env ?? process.env
  if (!readRecoveryEnabled(env) || (options.requestedValues ?? 0) > 0) return null
  const family = readTaskFamily(goal)
  if (!family) return null
  const configured = Number(env.STEWARD_READ_BUDGET_SCALE)
  const scale = Number.isFinite(configured) && configured >= 0.25 && configured <= 4 ? configured : 1
  return { family, softMs: Math.round(budgets[family].softMs * scale), hardMs: Math.round(budgets[family].hardMs * scale) }
}

/** Effects after which a run is no longer a pure read: typing into a search box or a calculator
 * (reversible_local_write), opening a page, or accepting a site notice are not; a submitted form, a message, an
 * external write or anything consequential is, and the read budget stops applying. */
const readCompatibleEffects = new Set(['read_only', 'safe_local', 'reversible_local_write', 'legal_acceptance', 'unclassified_control'])
/** A read of the page already open types and toggles nothing: any such input there means the request was not a read. */
const pageReadEffects = new Set(['read_only', 'safe_local', 'legal_acceptance', 'unclassified_control'])
export function stillReading(executedEffectClasses: readonly string[], family: ReadTaskFamily = 'site_lookup'): boolean {
  const allowed = family === 'page_read' ? pageReadEffects : readCompatibleEffects
  return executedEffectClasses.every(effect => allowed.has(effect))
}

/** The reason recorded when the hard budget closes input. It names a budget, so the engine router treats the stop
 * as final (no hand-off). */
export function readBudgetReason(policy: ReadRecoveryPolicy): string {
  return `The read budget for this request (${Math.round(policy.hardMs / 1000)} s, ${policy.family.replace('_', ' ')}) was reached, so Carve closed input and reported what it had established.`
}
