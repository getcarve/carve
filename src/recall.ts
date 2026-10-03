/**
 * Natural-language recall over observation history.
 *
 * Every observation and ambient transition becomes a "moment": a timestamped
 * row carrying the application, the raw window title, and whatever text that
 * capture path recorded. Moments are searchable; they are not evidence. Recall
 * reads history, never writes it, and its results cannot enter induction,
 * planning, or execution.
 *
 * A question usually carries two things — when, and about what. "What was that
 * customer two days ago who wrote in about a missing payment" is a time window
 * plus a topic, so the parser lifts the window out and searches the remainder.
 */
import type { RecallEntity } from './entities.js'
import type { MemoryModel } from './memory.js'
import {
  analyzeRecallScope,
  composeAnalyticalAnswer,
  planRecallQuestion,
  selectRepresentativeMoments,
  type RecallAnalysis,
  type RecallQueryPlan,
  type RecallSessionDescriptor,
} from './recall-analysis.js'
import { baseLevelActivation } from './memory.js'
import { tokenize } from './util.js'

export type MomentSource = 'observation' | 'ambient'

export interface RecallMoment {
  momentId: string
  source: MomentSource
  occurredAt: string
  app: string
  title: string
  body: string
  sessionId: string | null
  screenshotRef: string | null
  /** Richer capture metadata retained for scoped analysis when available. */
  url?: string | null
  sequence?: number | null
  durationMs?: number | null
}

export interface RecallHit extends RecallMoment {
  score: number
  /** Rank contributed by each retriever, 0 when that retriever did not find it. */
  components: { lexical: number; semantic: number; semanticSimilarity?: number; graph: number; associative: number; strength: number }
}

export interface RecallWindow {
  fromIso: string | null
  toIso: string | null
  /** How the window was understood, echoed back so the user can correct it. */
  label: string | null
}

export interface RecallSessionScope {
  sessionIds: string[]
  /** Human-readable names resolved by the control plane, never trusted as ids. */
  label: string
  sessions?: RecallSessionDescriptor[]
}

export interface RecallScope extends RecallWindow {
  /** Empty means every session plus ambient history. */
  sessionIds?: string[]
  /** Filled by the control plane after resolving the selected ids. */
  sessionLabel?: string | null
  /** Filled by the control plane so comparison evidence names each side. */
  sessions?: RecallSessionDescriptor[]
}

export interface RecallQuery {
  original: string
  terms: string
  window: RecallWindow
  /** Session selection is always a clamp, even when the question names a time. */
  sessionScope?: RecallSessionScope | null
  /** Optional on hand-authored test queries; always present on a RecallResult. */
  plan?: RecallQueryPlan
  /** Names available for evidence labeling even when every session is in scope. */
  sessionDescriptors?: RecallSessionDescriptor[]
}

export interface RecallResult extends RecallQuery {
  plan: RecallQueryPlan
  /** Where the searched window came from, so the UI can explain an override. */
  windowSource: 'question' | 'scope' | 'none'
  hits: RecallHit[]
  searchedMoments: number
  entities: RecallEntity[]
  /** Whole-scope deterministic analysis for non-lookup questions. */
  analysis: RecallAnalysis | null
  /** A plain-language reading of the hits. Inference, not evidence. */
  answer: string
}

function scopeDescription(query: RecallQuery): string {
  const session = query.sessionScope?.label
  const time = query.window.label
  if (session && time) return `${session}, ${time}`
  return session ?? time ?? 'the recorded history'
}

/**
 * Composes an answer from what was actually found, deterministically and with
 * no model. Every clause is traceable to a hit or an extracted entity, so the
 * answer can never assert something the evidence does not contain.
 */
export function composeAnswer(query: RecallQuery, hits: RecallHit[], entities: RecallEntity[]): string {
  if (hits.length === 0) {
    return `Nothing in ${scopeDescription(query)} matches that. Only window names and any recognised text are searchable.`
  }
  const when = scopeDescription(query)
  const people = entities.filter((entity) => entity.kind === 'person')
  const organizations = entities.filter((entity) => entity.kind === 'organization')
  const documents = entities.filter((entity) => entity.kind === 'document')
  const identifiers = entities.filter((entity) => entity.kind === 'identifier')
  const top = hits[0]
  const day = top ? new Date(top.occurredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''

  const sentences: string[] = []
  const lead = people[0] ?? organizations[0]
  if (lead) {
    sentences.push(`Most likely ${lead.name}, seen in ${top?.app ?? 'an application'} on ${day}.`)
  } else if (top) {
    sentences.push(`The closest match is "${top.title}" in ${top.app} on ${day}.`)
  }
  const references = [...identifiers, ...documents].slice(0, 3).map((entity) => entity.name)
  if (references.length > 0) sentences.push(`Referenced: ${references.join(', ')}.`)
  const others = [...people.slice(1), ...organizations.slice(lead && lead.kind === 'organization' ? 1 : 0)].slice(0, 3).map((entity) => entity.name)
  if (others.length > 0) sentences.push(`Also present: ${others.join(', ')}.`)
  sentences.push(`Based on ${hits.length} matching moment${hits.length === 1 ? '' : 's'} from ${when}.`)
  return sentences.join(' ')
}

/** Describes a stretch of time when the question named no topic. */
function composeTimeline(query: RecallQuery, hits: RecallHit[]): string {
  if (hits.length === 0) return `Nothing was recorded in ${scopeDescription(query)}.`
  const apps = [...new Set(hits.map((hit) => hit.app))]
  const first = hits[hits.length - 1]
  const last = hits[0]
  const span = first && last
    ? `${new Date(first.occurredAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} to ${new Date(last.occurredAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : ''
  const shown = apps.slice(0, 4)
  const listed = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0] ?? 'one application'
  const more = apps.length > 4 ? ` and ${apps.length - 4} more` : ''
  const scope = scopeDescription(query)
  const when = query.sessionScope
    ? `In ${scope}`
    : scope.replace(/^\w/u, (character) => character.toUpperCase())
  return `${when} you moved between ${listed}${more}${span ? `, from ${span}` : ''}. Showing each distinct screen rather than every moment.`
}

const DAY = 86_400_000

/** Words that carry no retrieval signal but are common in spoken questions. */
const stopWords = new Set([
  'what', 'was', 'that', 'who', 'when', 'where', 'which', 'the', 'a', 'an', 'about', 'for', 'with',
  'did', 'do', 'i', 'me', 'my', 'we', 'it', 'is', 'are', 'on', 'in', 'at', 'of', 'to', 'and', 'or',
  'show', 'find', 'tell', 'say', 'says', 'again', 'there', 'this', 'those', 'these', 'wrote', 'write',
  'doing', 'done', 'working', 'work', 'happened', 'looking', 'look', 'see', 'seen', 'up',
])

function startOfDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Lifts a time window out of a question. Returns the window and the question
 * with the time phrase removed, so "two days ago" narrows the search instead of
 * competing with it for relevance.
 */
export function parseRecallQuery(question: string, now = Date.now()): RecallQuery {
  const original = question.trim()
  // Punctuation is flattened before the time phrases are matched. They are
  // anchored on whitespace, so "what was I doing this morning?" used to miss
  // the window entirely, drop "morning" into the search terms, and return
  // nothing — the one shape of question most likely to be typed with a
  // question mark.
  let text = ` ${original.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `
  let window: RecallWindow = { fromIso: null, toIso: null, label: null }

  const setDayWindow = (daysAgo: number, label: string) => {
    const from = startOfDay(now - daysAgo * DAY)
    window = { fromIso: new Date(from).toISOString(), toIso: new Date(from + DAY).toISOString(), label }
  }
  const setSpanWindow = (days: number, label: string) => {
    window = { fromIso: new Date(now - days * DAY).toISOString(), toIso: new Date(now).toISOString(), label }
  }

  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
  const numeric = /\s(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|days|week|weeks|month|months)\s+ago\s/u.exec(text)

  const partOfDay = /\s(this\s+morning|this\s+afternoon|this\s+evening|tonight|last\s+night)\s/u.exec(text)
  if (partOfDay?.[1]) {
    const phrase = partOfDay[1].replace(/\s+/gu, ' ')
    const midnight = startOfDay(now)
    const spans: Record<string, [number, number]> = {
      'this morning': [midnight, midnight + 12 * 3_600_000],
      'this afternoon': [midnight + 12 * 3_600_000, midnight + 18 * 3_600_000],
      'this evening': [midnight + 18 * 3_600_000, midnight + 24 * 3_600_000],
      'tonight': [midnight + 18 * 3_600_000, midnight + 24 * 3_600_000],
      'last night': [midnight - 6 * 3_600_000, midnight + 6 * 3_600_000],
    }
    const [from, to] = spans[phrase] ?? [midnight, midnight + DAY]
    window = { fromIso: new Date(from).toISOString(), toIso: new Date(to).toISOString(), label: phrase }
    text = text.replace(partOfDay[0], ' ')
  } else if (/\syesterday\s/u.test(text)) {
    setDayWindow(1, 'yesterday')
    text = text.replace(/\syesterday\s/u, ' ')
  } else if (/\stoday\s/u.test(text)) {
    setDayWindow(0, 'today')
    text = text.replace(/\stoday\s/u, ' ')
  } else if (numeric) {
    const rawCount = numeric[1] ?? '1'
    const count = words[rawCount] ?? Number(rawCount)
    const unit = numeric[2] ?? 'day'
    if (unit.startsWith('day')) setDayWindow(count, `${count} day${count === 1 ? '' : 's'} ago`)
    else if (unit.startsWith('week')) setSpanWindow(count * 7, `the last ${count} week${count === 1 ? '' : 's'}`)
    else setSpanWindow(count * 30, `the last ${count} month${count === 1 ? '' : 's'}`)
    text = text.replace(numeric[0], ' ')
  } else if (/\s(last|past|previous)\s+week\s/u.test(text)) {
    setSpanWindow(7, 'the last week')
    text = text.replace(/\s(last|past|previous)\s+week\s/u, ' ')
  } else if (/\s(last|past|previous)\s+month\s/u.test(text)) {
    setSpanWindow(30, 'the last month')
    text = text.replace(/\s(last|past|previous)\s+month\s/u, ' ')
  } else if (/\sthis\s+week\s/u.test(text)) {
    setSpanWindow(7, 'this week')
    text = text.replace(/\sthis\s+week\s/u, ' ')
  }

  const terms = tokenize(text).filter((token) => !stopWords.has(token) && token.length > 1).join(' ')
  // Falling back to the raw question when every word was filler used to be the
  // safest option. With a time window present it is actively wrong: it matches
  // arbitrary moments on words like "doing" and hides the timeline answer that
  // the question was actually asking for.
  return { original, terms: terms || (window.label ? '' : tokenize(original).join(' ')), window }
}

/** Builds the FTS5 MATCH expression, tolerating an empty or all-stopword question. */
export function matchExpression(terms: string): string | null {
  const tokens = terms.split(/\s+/u).filter((token) => /^[a-z0-9]+$/u.test(token))
  if (tokens.length === 0) return null
  return tokens.map((token) => `${token}*`).join(' OR ')
}

export interface RecallStore {
  searchMomentIds(match: string, limit: number): string[]
  /** Moment ids ranked by BM25, best first. Falls back to searchMomentIds order. */
  rankMomentIdsByBm25?(match: string, limit: number): string[]
  /** Scope-aware candidate generation prevents unrelated history consuming K. */
  rankMomentIdsByBm25InScope?(match: string, limit: number, fromIso: string | null, toIso: string | null, sessionIds: string[]): string[]
  /** Moment ids that mention an entity whose name matches a query term. */
  momentIdsForEntityTerms?(terms: string[], limit: number): string[]
  momentIdsForEntityTermsInScope?(terms: string[], limit: number, fromIso: string | null, toIso: string | null, sessionIds: string[]): string[]
  listMoments(fromIso: string | null, toIso: string | null, limit: number, sessionIds?: string[]): RecallMoment[]
  countMoments(): number
  countMomentsInScope?(fromIso: string | null, toIso: string | null, sessionIds?: string[]): number
  entitiesForMoments(momentIds: string[]): RecallEntity[]
}

export interface RecallOptions {
  limit?: number
  /** Moments considered before ranking; bounds work on a long history. */
  scanLimit?: number
  /** Complete-scope analytical scan cap. Truncation is always reported. */
  analysisLimit?: number
  sessionDescriptors?: RecallSessionDescriptor[]
  now?: number
  /**
   * Associative memory. When absent, ranking degrades to lexical match plus a
   * plain recency curve, so recall works on day one with no learned model.
   */
  memory?: MemoryModel
  /** Extra presentation times per moment, from prior retrievals. */
  presentations?: Map<string, number[]>
  /** Signatures of the moments that matched, used to seed spreading activation. */
  signatureOf?: (moment: RecallMoment) => string
  /**
   * Identity used to collapse repeats of one screen. Deliberately separate from
   * `signatureOf`: that key indexes the associative model and is coarse on
   * purpose, so reusing it here silently drops distinct documents that happen to
   * share a workflow shape. Defaults to app and title when not supplied.
   */
  diversifyBy?: (moment: RecallMoment) => string
  /** Instances kept per recurring screen before moving on to the next kind. */
  perSignatureLimit?: number
  /** Moment ids ranked by semantic similarity, best first. */
  semanticOrder?: string[]
  /** Raw cosine-like similarity retained for confidence-aware second-stage use. */
  semanticScores?: Map<string, number>
  /** Extra lexical terms drawn from the corpus, widening the BM25 query. */
  expansion?: string[]
  /** Moment ids matching entities named in the query. */
  graphMomentIds?: string[]
  /**
   * A window chosen in the interface rather than spoken in the question.
   *
   * It is a default, not a clamp: a question that names its own time is more
   * specific than a control someone set earlier and forgot, so "what did I do
   * yesterday" still searches yesterday even while the scope says today. The
   * result reports which one applied.
   */
  scope?: RecallScope
}

/**
 * Ranks moments by lexical match, embedding similarity, and recency. Recency is
 * a mild tie-breaker rather than a sort key: "that customer two days ago" is
 * answered by the time window, not by preferring whatever happened last.
 */
/**
 * Reciprocal Rank Fusion. Each retriever contributes 1/(k + rank), so lists
 * whose scores are not comparable — BM25 in log-odds, cosine in [-1,1], graph
 * activation unbounded — can be combined without inventing weights to balance
 * them. A document found mid-pack by several retrievers beats one found first
 * by a single retriever, which is the behaviour we want from a memory.
 */
const RRF_K = 60

function rankOf(ordered: string[]): Map<string, number> {
  const ranks = new Map<string, number>()
  ordered.forEach((id, index) => { if (!ranks.has(id)) ranks.set(id, index + 1) })
  return ranks
}

export function rankMoments(query: RecallQuery, moments: RecallMoment[], ftsHits: Set<string>, options: RecallOptions = {}): RecallHit[] {
  const now = options.now ?? Date.now()
  const limit = options.limit ?? 20
  const { memory, presentations, signatureOf, semanticOrder, semanticScores, graphMomentIds } = options
  const present = new Set(moments.map((moment) => moment.momentId))
  const queryTokens = new Set(tokenize(query.terms))

  // Retriever 1 — lexical. The store supplies BM25 order when it can; otherwise
  // fall back to token overlap so the retriever still contributes something.
  const lexicalOrder = [...ftsHits].filter((id) => present.has(id))
  if (lexicalOrder.length === 0 && queryTokens.size > 0) {
    lexicalOrder.push(...moments
      .map((moment) => ({
        id: moment.momentId,
        overlap: tokenize(`${moment.app} ${moment.title} ${moment.body}`).filter((token) => queryTokens.has(token)).length,
      }))
      .filter((entry) => entry.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .map((entry) => entry.id))
  }
  const lexical = rankOf(lexicalOrder)

  // Retriever 2 — semantic. Real distributional vectors over the corpus, so a
  // paraphrase can match text that shares no words with the question.
  const semanticRanks = rankOf((semanticOrder ?? []).filter((id) => present.has(id)))

  // Retriever 3 — entity graph. Query terms naming a person, organisation, or
  // document pull in the moments that mention them.
  const graph = rankOf((graphMomentIds ?? []).filter((id) => present.has(id)))

  // Retriever 4 — association. Seeds are the moments the other retrievers
  // already found, so activation spreads from what the question actually hit.
  const seeds = new Set<string>()
  if (memory && signatureOf) {
    for (const moment of moments) {
      if (!lexical.has(moment.momentId) && !semanticRanks.has(moment.momentId)) continue
      const signature = signatureOf(moment)
      if (signature) seeds.add(signature)
    }
  }
  const activation = memory && seeds.size > 0 ? memory.spread([...seeds]) : new Map<string, number>()
  const associativeOrder = memory && signatureOf
    ? moments
        .map((moment) => ({ id: moment.momentId, value: activation.get(signatureOf(moment)) ?? 0 }))
        .filter((entry) => entry.value > 0.02)
        .sort((a, b) => b.value - a.value)
        .map((entry) => entry.id)
    : []
  const associative = rankOf(associativeOrder)

  const scored = moments.map((moment) => {
    const contributions = [lexical, semanticRanks, graph, associative]
      .map((ranks) => { const rank = ranks.get(moment.momentId); return rank ? 1 / (RRF_K + rank) : 0 })
    const fused = contributions.reduce((sum, value) => sum + value, 0)

    // ACT-R base-level activation is a prior on the memory itself rather than a
    // retriever. It is deliberately a tiny tie-breaker: an observation that
    // two retrievers rank first must not lose to a newer observation ranked
    // fourth by both. The old 0.85–1.15 multiplier was large enough to do just
    // that on real hosted-embedding evaluation.
    const times = [Date.parse(moment.occurredAt), ...(presentations?.get(moment.momentId) ?? [])]
    const raw = baseLevelActivation(times, now)
    const strength = Number.isFinite(raw) ? 1 / (1 + Math.exp(-raw)) : 0
    const semanticSimilarity = semanticScores?.get(moment.momentId)

    return {
      ...moment,
      score: fused * (1 + 0.005 * strength),
      components: {
        lexical: lexical.get(moment.momentId) ?? 0,
        semantic: semanticRanks.get(moment.momentId) ?? 0,
        ...(semanticSimilarity !== undefined ? { semanticSimilarity } : {}),
        graph: graph.get(moment.momentId) ?? 0,
        associative: associative.get(moment.momentId) ?? 0,
        strength,
      },
    }
  })

  const ranked = scored
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.occurredAt.localeCompare(a.occurredAt))

  // Nobody remembers twenty-seven copies of the same morning. Collapsing to the
  // strongest instance of each recurring screen is what leaves room for a
  // different, associated memory to appear at all.
  const perSignature = new Map<string, number>()
  const diversified: RecallHit[] = []
  for (const hit of ranked) {
    const key = options.diversifyBy?.(hit) || `${hit.app}\u0000${hit.title}`
    const seen = perSignature.get(key) ?? 0
    if (seen >= (options.perSignatureLimit ?? 1)) continue
    perSignature.set(key, seen + 1)
    diversified.push(hit)
    if (diversified.length >= limit) break
  }
  return diversified
}

export function recall(store: RecallStore, question: string, options: RecallOptions = {}): RecallResult {
  const now = options.now ?? Date.now()
  const asked = parseRecallQuery(question, now)
  const scoped = options.scope && asked.window.fromIso === null && asked.window.toIso === null
  const sessionIds = [...new Set(options.scope?.sessionIds ?? [])]
  const sessionScope: RecallSessionScope | null = sessionIds.length > 0
    ? {
        sessionIds,
        label: options.scope?.sessionLabel?.trim() || `${sessionIds.length} selected session${sessionIds.length === 1 ? '' : 's'}`,
        ...(options.scope?.sessions ? { sessions: options.scope.sessions.filter((session) => sessionIds.includes(session.id)) } : {}),
      }
    : null
  const hasWindow = asked.window.fromIso !== null || asked.window.toIso !== null || Boolean(scoped && options.scope && (options.scope.fromIso !== null || options.scope.toIso !== null))
  let plan = planRecallQuestion(question, sessionIds.length, hasWindow)
  if (asked.terms.length === 0 && hasWindow && plan.intent === 'lookup') {
    plan = { intent: 'timeline', unit: 'episode', exhaustive: true, answerStrategy: 'deterministic', rationale: 'The question names a time window without a topic, so the window itself is the requested timeline.' }
  }
  const query: RecallQuery = {
    ...asked,
    ...(scoped ? { window: options.scope as RecallWindow } : {}),
    ...(sessionScope ? { sessionScope } : {}),
    plan,
    ...(options.sessionDescriptors ? { sessionDescriptors: options.sessionDescriptors } : {}),
  }
  const windowSource: RecallResult['windowSource'] = asked.window.label !== null
    ? 'question'
    : scoped && (query.window.fromIso !== null || query.window.toIso !== null) ? 'scope' : 'none'
  if (plan.exhaustive) {
    const analysisLimit = Math.max(1, options.analysisLimit ?? 100_000)
    const moments = store.listMoments(query.window.fromIso, query.window.toIso, analysisLimit, sessionIds)
    const eligibleMoments = store.countMomentsInScope?.(query.window.fromIso, query.window.toIso, sessionIds) ?? moments.length
    const descriptors = sessionScope?.sessions
      ?? options.sessionDescriptors
      ?? sessionIds.map((id, index) => ({ id, label: sessionIds.length === 1 ? sessionScope?.label ?? 'Selected session' : `Selected session ${index + 1}` }))
    const analysis = analyzeRecallScope(moments, descriptors, eligibleMoments, sessionIds.length)
    const representatives = selectRepresentativeMoments(moments, options.limit ?? 30)
    const hits: RecallHit[] = representatives.map((moment, index) => ({
      ...moment,
      score: 1 / (index + 1),
      components: { lexical: 0, semantic: 0, graph: 0, associative: 0, strength: 0 },
    }))
    const entities = store.entitiesForMoments(hits.map((hit) => hit.momentId))
    return {
      ...query,
      plan,
      windowSource,
      hits,
      searchedMoments: moments.length,
      entities,
      analysis,
      answer: composeAnalyticalAnswer(plan, analysis),
    }
  }

  const scanLimit = options.scanLimit ?? 4_000
  // Widen the lexical query with terms the corpus says are used alike, so BM25
  // stops depending on the asker happening to choose the stored wording.
  const match = matchExpression([query.terms, ...(options.expansion ?? [])].join(' '))
  const ordered = match
    ? (store.rankMomentIdsByBm25InScope?.(match, scanLimit, query.window.fromIso, query.window.toIso, sessionIds)
      ?? store.rankMomentIdsByBm25?.(match, scanLimit)
      ?? store.searchMomentIds(match, scanLimit))
    : []
  const graphMomentIds = store.momentIdsForEntityTermsInScope?.([...tokenize(query.terms)], scanLimit, query.window.fromIso, query.window.toIso, sessionIds)
    ?? store.momentIdsForEntityTerms?.([...tokenize(query.terms)], scanLimit)
    ?? []
  const moments = store.listMoments(query.window.fromIso, query.window.toIso, scanLimit, sessionIds)
  let hits = rankMoments(query, moments, new Set(ordered), { ...options, now, graphMomentIds })

  // "What was I doing this morning" carries a when but no what. Answering
  // nothing is wrong: the window itself is the question, so return what
  // happened in it, most recent first.
  const timeline = hits.length === 0 && (query.window.fromIso !== null || sessionScope !== null) && moments.length > 0
  if (timeline) {
    hits = rankMoments({ ...query, terms: '' }, moments, new Set(moments.map((moment) => moment.momentId)), { ...options, now })
  }

  const entities = store.entitiesForMoments(hits.map((hit) => hit.momentId))
  return {
    ...query,
    plan,
    windowSource,
    hits,
    searchedMoments: moments.length,
    entities,
    analysis: null,
    answer: timeline ? composeTimeline(query, hits) : composeAnswer(query, hits, entities),
  }
}
