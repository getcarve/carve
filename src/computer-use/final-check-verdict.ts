/**
 * The final check's verdict, split into what it actually judges (in testing:
 * 258 final checks, 95 rejections).
 *
 * One boolean carried three different findings, and the controller could not tell them apart:
 *  - a value that is wrong or unsupported (key chains read as "sets", an eyewear retailer's "Featured" read as bestsellers, Node 16's
 *    "Last updated" read as end of life, an npm figure the page never labels as weekly downloads). These rejections
 *    are the check's whole value and stay rejections;
 *  - a correct value read from a secondary place on the requested site (serde and rails figures from the registry's
 *    own search results, Britannica's squid arm count from its search excerpt): 19 correct drafts were rejected for
 *    this alone, and two runs lost the value entirely (one run ended as an honest failure; package-registry runs hedged into
 *    "can't conclude");
 *  - an honest limited report judged premature: 30 rejections across 15 runs, none of which ever reached a full answer
 *    (retailer bot walls, a ticketing site's seat maps, clothing-retailer filters, JSONLint); one run alternated report and one more
 *    step five times.
 *
 * The check now returns each judgment separately, and the controller decides from them:
 *  - value correct, sourcing secondary, nothing requested missing, not premature → accepted, with a one-line note
 *    telling the person where the value came from;
 *  - a premature stop of an honest report is rejected at most once per run (local or paid); the rejection turns its
 *    named steps into explicit next objectives for the actor, and the next honest limited report stands;
 *  - the best draft whose values the check agreed are correct is kept, so a later hedge, or a run that ends on a
 *    rejection, never loses a correct value.
 *
 * Levers, each default on and restoring the earlier behaviour when off: `STEWARD_SPLIT_VERDICT`,
 * `STEWARD_PREMATURE_CAP`, `STEWARD_KEEP_BEST_DRAFT`.
 */
import { claimSpecifics } from '../claim-specifics.js'
import { readComputerOutcome } from './outcome.js'

export const splitVerdictEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_SPLIT_VERDICT?.trim().toLowerCase() !== 'off'
/** `STEWARD_PREMATURE_ATTEMPT_REQUIRED=off` caps after the first premature refusal whether or not anything was tried. */
export const prematureAttemptRequired = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_PREMATURE_ATTEMPT_REQUIRED?.trim().toLowerCase() !== 'off'
const prematureCeiling = 2
export const prematureCapEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_PREMATURE_CAP?.trim().toLowerCase() !== 'off'
export const keepBestDraftEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_KEEP_BEST_DRAFT?.trim().toLowerCase() !== 'off'

export type ValueJudgment = 'correct' | 'wrong' | 'unsupported' | 'no_values'
export type SourcingJudgment = 'direct' | 'secondary' | 'not_applicable'
export type CoverageJudgment = 'complete' | 'incomplete'
export type StoppingJudgment = 'not_limited' | 'grounded' | 'premature'

export interface SplitJudgments { values: ValueJudgment; sourcing: SourcingJudgment; coverage: CoverageJudgment; stopping: StoppingJudgment; sourcingNote: string | null }

/** Schema properties added to the final check's response. */
export const splitVerdictProperties = {
  values: { type: 'string', enum: ['correct', 'wrong', 'unsupported', 'no_values'] },
  sourcing: { type: 'string', enum: ['direct', 'secondary', 'not_applicable'] },
  coverage: { type: 'string', enum: ['complete', 'incomplete'] },
  stopping: { type: 'string', enum: ['not_limited', 'grounded', 'premature'] },
  sourcingNote: { type: ['string', 'null'] },
} as const

export function withSplitVerdict<T extends { name: string; strict: true; schema: { properties: Record<string, unknown>; required: string[] } }>(schema: T): T {
  return { ...schema, schema: { ...schema.schema, properties: { ...schema.schema.properties, ...splitVerdictProperties }, required: [...schema.schema.required, ...Object.keys(splitVerdictProperties)] } }
}

/** The check's instructions for the split judgments. General: no site, registry or task is named. */
export const splitVerdictGuidance = 'Return four separate judgments besides accepted. values: "correct" when every value and factual claim the answer states is shown by the observed evidence as stated, with the meaning the answer gives it, on any observed page of the requested site or source (the item\'s own page, or a search result, listing, results card or excerpt there), or follows exactly from observed values by arithmetic or a deterministic transformation of observed input (for example an encoding or a unit conversion); "wrong" when the evidence contradicts a value or claim, including a figure whose page label says it measures something else (a "Last updated" date is not an end-of-life date), a list item that fails a stated condition, or an order, sort or selection the page does not show; "unsupported" when a stated value, or the meaning the answer gives it, is not shown anywhere in the evidence, or rests only on a site other than the one the request names; "no_values" when the answer states no values (a pure limitation). sourcing: "direct" when the values were read on the item\'s own page or the exact source the request names; "secondary" when a correct value was read from a search result, listing, card, snippet or excerpt on the requested site instead of the item\'s own page, or was computed from observed values; "not_applicable" when there are no values. coverage: "complete" when the answer addresses every requested part, or, for a partial or blocked report, states each part it could not establish; otherwise "incomplete". stopping: "not_limited" for a completion claim; for a partial or blocked report "grounded" when the stated limitation is an established boundary and "premature" when a visibly available in-scope step would likely resolve it. Where a value was read is not by itself a reason to reject: when values is correct, coverage complete and stopping not premature, accept even if sourcing is secondary, and write sourcingNote: one short sentence for the person saying where the value was read (for example "Read from the registry\'s search results; the package page itself was not opened."), adding no new facts or figures. Otherwise sourcingNote is null. Reject only when a value is wrong or unsupported, a requested part is missing, or a limited report stops prematurely.'

/** Parse the split judgments; null when any is missing or unknown (an older verdict, or the lever off). */
export function readSplitJudgments(verdict: Record<string, unknown>): SplitJudgments | null {
  const pick = <T extends string>(key: string, values: readonly T[]): T | null => typeof verdict[key] === 'string' && (values as readonly string[]).includes(verdict[key] as string) ? verdict[key] as T : null
  const values = pick('values', splitVerdictProperties.values.enum), sourcing = pick('sourcing', splitVerdictProperties.sourcing.enum)
  const coverage = pick('coverage', splitVerdictProperties.coverage.enum), stopping = pick('stopping', splitVerdictProperties.stopping.enum)
  if (!values || !sourcing || !coverage || !stopping) return null
  return { values, sourcing, coverage, stopping, sourcingNote: typeof verdict.sourcingNote === 'string' ? verdict.sourcingNote : null }
}

/** The note shown to the person: one short line that adds no figure the answer does not already state. */
export function sanitizeSourcingNote(note: string | null, answer: string): string | null {
  if (!note) return null
  // eslint-disable-next-line no-control-regex
  const text = note.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim()
  if (text.length < 8 || text.length > 240) return null
  const known = new Set(claimSpecifics(answer).map(item => `${item.kind}:${item.value}`))
  if (claimSpecifics(text).some(item => !known.has(`${item.kind}:${item.value}`))) return null
  return /[.!?]$/u.test(text) ? text : `${text}.`
}

/** The report with the note appended to its message; status, remaining and title unchanged. */
export function withSourcingNote(report: string, note: string | null): string {
  if (!note) return report
  const outcome = readComputerOutcome(report)
  if (outcome.status === 'unclassified') return `${report}\n\n${note}`
  if (outcome.message.includes(note)) return report
  return JSON.stringify({ status: outcome.status, message: `${outcome.message}\n\n${note}`, remaining: outcome.remaining, ...(outcome.title ? { title: outcome.title } : {}) })
}

export type FinalCheckDecision =
  | { kind: 'as_checked' }
  | { kind: 'accept_secondary_source'; note: string | null }
  | { kind: 'premature_objectives' }
  | { kind: 'coverage_objectives' }
  | { kind: 'premature_report_stands' }

/**
 * The controller's reading of one verdict. `prematureSoFar` counts premature refusals already made in this run, the
 * local gate's included. Only honest reports are protected: every stated value correct (or none stated) and every
 * unmet part listed.
 */
export function interpretFinalVerdict(input: { accepted: boolean; judgments: SplitJudgments | null; limited: boolean; answer: string; prematureSoFar: number; attemptedSincePremature?: boolean; unmetCount?: number }, env: NodeJS.ProcessEnv = process.env): FinalCheckDecision {
  const j = input.judgments
  if (!j || !splitVerdictEnabled(env)) return { kind: 'as_checked' }
  const honest = (j.values === 'correct' || j.values === 'no_values') && j.coverage === 'complete'
  if (input.limited && j.stopping === 'premature' && honest && !input.accepted && prematureCapEnabled(env)) {
    // The report stands only once the actor has tried something since the last premature refusal: a report sent
    // with no input attempted in between names no boundary it met (an eyewear retailer: a local refusal, two Finds
    // and no click, then the capped check let "Bestsellers isn't selected" stand). A hard ceiling ends any ping-pong.
    const attempted = input.attemptedSincePremature ?? true
    const spent = input.prematureSoFar >= prematureCeiling || (input.prematureSoFar >= 1 && (attempted || !prematureAttemptRequired(env)))
    return spent ? { kind: 'premature_report_stands' } : { kind: 'premature_objectives' }
  }
  // An answer that leaves named items unchecked (a classifieds search: three reports, each after one more
  // ad, three rejections, the run closed with listings from two areas never opened). The unchecked items become
  // the actor's objectives instead of a plain rejection. A wrong value is still named in the reason the actor reads.
  if (!input.accepted && j.coverage === 'incomplete' && (input.unmetCount ?? 0) > 0 && coverageObjectivesEnabled(env)) return { kind: 'coverage_objectives' }
  if (j.values === 'correct' && j.coverage === 'complete' && j.stopping !== 'premature') {
    const note = j.sourcing === 'secondary' ? sanitizeSourcingNote(j.sourcingNote, readComputerOutcome(input.answer).message) : null
    if (!input.accepted && j.sourcing === 'secondary') return { kind: 'accept_secondary_source', note }
    if (input.accepted && note) return { kind: 'accept_secondary_source', note }
  }
  return { kind: 'as_checked' }
}

/** `STEWARD_COVERAGE_OBJECTIVES=off`: an incomplete answer gets a plain rejection again. */
export const coverageObjectivesEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_COVERAGE_OBJECTIVES?.trim().toLowerCase() !== 'off'
/** Objective rounds that do not count against the rejection limit while the actor keeps acting on them. */
export const coverageObjectiveRounds = 4

/** Feedback after a rejection for unchecked items: those items are the actor's objectives, all of them, before it reports. */
export function coverageObjectivesFeedback(reason: string, items: string[]): string {
  return `Final verification: the answer leaves items unchecked (${reason.slice(0, 700)}).\n`
    + `Next objectives, in order: ${items.slice(0, 8).map((item, index) => `${index + 1}. ${item}`).join(' ')}\n`
    + 'Work through every one of these before you write another report: open each, read what it says, go back, and continue with the next. '
    + 'Correct anything the check said was wrong. Keep every finding already made, including items you already opened. Report only when each objective is done or a concrete boundary stops it.'
}

/** Feedback after the one premature rejection: the named steps become the actor's objectives. */
export function prematureObjectivesFeedback(reason: string, steps: string[]): string {
  const objectives = steps.length ? steps : ['The in-scope step the check names in its reason.']
  return `Final verification: your limited report stopped while in-scope work is still available (${reason.slice(0, 600)}).\n`
    + `Next objectives, in order: ${objectives.slice(0, 6).map((step, index) => `${index + 1}. ${step}`).join(' ')}\n`
    + 'Act on these now; do not write another report until you have tried each one or a concrete boundary stops it (a withheld input, a sign-in or verification page, a missing page, an exhausted allowance). '
    + 'Keep every finding already reported. If the same boundary then stops you, report it again with what you tried: that report stands, and no further step will be required of it.'
}

/** The checkable specifics of an answer: figures and dates (claimSpecifics) plus code spans such as an encoded value
 * or a package version. Quoted prose is left out: it often echoes the request ("hello carve"). */
export function answerSpecifics(message: string): string[] {
  const spans = [...message.matchAll(/`([^`]{2,200})`/gu)].map(match => (match[1] ?? '').trim()).filter(Boolean)
  return [...new Set([...claimSpecifics(message).map(item => `${item.kind}:${item.value}`), ...spans.map(span => `span:${span.toLowerCase()}`)])]
}

function carries(message: string, specific: string): boolean {
  if (specific.startsWith('span:')) return message.toLowerCase().includes(specific.slice(5))
  return claimSpecifics(message).some(item => `${item.kind}:${item.value}` === specific)
}

export interface BestDraft { answer: string; note: string | null }

/**
 * A draft whose values the check agreed are correct, kept against a later answer that says less. The later answer is
 * replaced only when it is a limited report that drops a specific the kept draft stated (a hedge such as "I can't
 * conclude"); the result keeps the kept draft's message, marked partial with the later report's remaining items.
 */
export function preferBestDraft(best: BestDraft | null, later: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!best || !keepBestDraftEnabled(env)) return later
  const kept = readComputerOutcome(best.answer), next = readComputerOutcome(later)
  if (!['partial', 'blocked'].includes(next.status)) return later
  const specifics = answerSpecifics(kept.message)
  if (!specifics.length || specifics.every(specific => carries(next.message, specific))) return later
  const message = best.note && !kept.message.includes(best.note) ? `${kept.message}\n\n${best.note}` : kept.message
  return JSON.stringify({ status: 'partial', message, remaining: next.remaining.length ? next.remaining : kept.remaining, ...(kept.title ? { title: kept.title } : {}) })
}

/** The closing answer after the last rejection: the check's supported rewrite unless it drops a value of the kept
 * draft, in which case the kept draft (with its note) is what the person reads. */
export function supportedAfterRejection(best: BestDraft | null, supported: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!best || !keepBestDraftEnabled(env)) return supported
  const kept = readComputerOutcome(best.answer).message
  const specifics = answerSpecifics(kept)
  if (!specifics.length || (supported && specifics.every(specific => carries(supported, specific)))) return supported
  return best.note && !kept.includes(best.note) ? `${kept}\n\n${best.note}` : kept
}

/** `STEWARD_UNCHECKED_FALLBACK=off` lets a final check the model service could not answer fail the task, as before. */
export const uncheckedFallbackEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_UNCHECKED_FALLBACK?.trim().toLowerCase() !== 'off'

/** The draft as the person reads it when its final check could not run: partial, with the reason stated first and
 * checking named as the remaining step, so it is never presented as a checked answer. */
/** `STEWARD_CONTENT_FILTER_FALLBACK=off`: a content-filtered actor call ends the run as a provider failure, as before. */
export const contentFilterFallbackEnabled = () => process.env.STEWARD_CONTENT_FILTER_FALLBACK?.trim().toLowerCase() !== 'off'

/** The model service's content filter stopped the actor twice (quotes.toscrape.com love tag: the person
 * read "OpenAI computer-action text response was not complete (status: incomplete, reason: content_filter)"). The best
 * checked draft stands as a partial answer; with none, the stop is said plainly. */
export function filteredReport(draft: string | null): string {
  const lead = 'The model service stopped reading this page partway (its content filter), so Carve couldn\u2019t finish.'
  if (!draft) return JSON.stringify({ status: 'blocked', message: `${lead} Nothing further was done.`, remaining: ['Finish reading the page yourself; the model service would not continue.'] })
  const outcome = readComputerOutcome(draft)
  return JSON.stringify({ status: 'partial', message: `${lead} This is what was established before that:\n\n${outcome.message}`, remaining: ['Finish reading the page yourself; the model service would not continue.', ...outcome.remaining].slice(0, 12), ...(outcome.title ? { title: outcome.title } : {}) })
}

export function uncheckedReport(draft: string): string {
  const outcome = readComputerOutcome(draft)
  const lead = 'Carve couldn\u2019t finish checking this answer because the model service didn\u2019t respond, so treat it as unconfirmed.'
  return JSON.stringify({ status: 'partial', message: `${lead}\n\n${outcome.message}`, remaining: ['Check this answer against the page; the final check could not run.', ...outcome.remaining].slice(0, 12), ...(outcome.title ? { title: outcome.title } : {}) })
}
