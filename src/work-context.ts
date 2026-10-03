import type { AuditLog } from './audit.js'
import type { CarveDatabase } from './db.js'
import { parseRecallQuery, recall, type RecallResult } from './recall.js'
import { ADAPTIVE_RETRIEVAL_MARGIN, ADAPTIVE_RETRIEVAL_THRESHOLD, EXECUTABLE_RETRIEVAL_THRESHOLD, type ProcedureRetriever, type RetrievalHit } from './retrieval.js'
import type {
  WorkContextInterpretation,
  WorkContextMemoryReceipt,
  WorkContextResource,
  WorkContextSelection,
  WorkContextSession,
  WorkContextSummary,
  WorkMemoryScope,
} from './types.js'
import { sha256, tokenize } from './util.js'

export interface WorkContextAssembly {
  summary: WorkContextSummary
  retrieval: RetrievalHit | null
  match: 'reviewed' | 'adapted' | null
  bestScore: number
}

export const DEFAULT_MEMORY_SCOPE: WorkMemoryScope = { mode: 'auto', sessionIds: [] }

interface AssembleHistoryOptions {
  /** When false, no recall search runs at all; only procedure evidence remains. */
  search: boolean
  /** Non-empty restricts every history search to these recorded sessions. */
  sessionIds: string[]
}

/**
 * Builds the inspectable context envelope for a work request.
 *
 * Recall matches may help a person understand why Carve associated a goal
 * with earlier work, but they never create actions. Actions must come from a
 * reviewed procedure or the separate typed capability catalog; either source
 * is bound into a fresh contract before it can reach policy or execution.
 */
export class WorkContextAssembler {
  constructor(
    private readonly database: CarveDatabase,
    private readonly retriever: ProcedureRetriever,
    private readonly audit: AuditLog,
    private readonly historySearch?: (question: string, sessionIds?: string[]) => Promise<RecallResult>,
    private readonly semanticAvailable: () => boolean = () => false,
  ) {}

  /**
   * Full Work retrieval uses the same asynchronous history engine as Recall,
   * then tests whether an explicit constraint caused a false zero. The legacy
   * synchronous method remains for direct deterministic plan creation.
   *
   * `memory` bounds what recorded history the request may draw on. The scope is
   * enforced here — before any search runs — never applied as a display filter,
   * so an out-of-scope moment can not influence retrieval, clarification, or
   * planning. The decision is disclosed on the receipt and in the audit log.
   */
  async assembleRich(goal: string, selection?: WorkContextSelection, memory: WorkMemoryScope = DEFAULT_MEMORY_SCOPE, now = Date.now()): Promise<WorkContextAssembly> {
    const requestedSessionIds = memory.mode === 'selected' ? [...new Set(memory.sessionIds)] : []
    const recordedIds = new Set(this.database.listSessions().map((session) => session.id))
    const resolvedSessionIds = requestedSessionIds.filter((sessionId) => recordedIds.has(sessionId))
    // A selected scope with no surviving session must fail closed: searching
    // everything because the selection was stale would silently widen scope.
    const searchable = memory.mode !== 'none' && (memory.mode !== 'selected' || resolvedSessionIds.length > 0)
    if (!searchable) {
      const base = this.assemble(goal, now, { search: false, sessionIds: [] })
      const receipt = this.applyMemoryReceipt(base.summary, {
        mode: memory.mode,
        requestedSessionIds,
        resolvedSessionIds,
        searched: false,
        used: false,
        reason: memory.mode === 'none' ? 'memory_off' : 'selected_sessions',
      })
      return { ...base, summary: receipt }
    }
    const scopeSessionIds = memory.mode === 'selected' ? resolvedSessionIds : []
    const base = this.assemble(goal, now, { search: true, sessionIds: scopeSessionIds })
    const historySearch = this.historySearch
    if (!historySearch) {
      return { ...base, summary: this.applyMemoryReceipt(base.summary, this.searchedReceipt(memory.mode, requestedSessionIds, resolvedSessionIds, true)) }
    }
    const parsed = parseRecallQuery(goal, now)
    const scopedSearch = (question: string) => historySearch(question, scopeSessionIds.length > 0 ? scopeSessionIds : undefined)
    const exact = await scopedSearch(goal)
    const referential = referentialRequest(goal)
    const topic = contextTopic(parsed.terms || goal)
    const shouldTestRelaxed = Boolean(parsed.window.label) && (exact.hits.length === 0 || referential)
    const relaxed = shouldTestRelaxed ? await scopedSearch(topic || parsed.terms || goal) : null
    const exactSelection = resourcesForResult(this.database, exact, topic)
    const relaxedSelection = relaxed ? resourcesForResult(this.database, relaxed, topic) : emptyResourceSelection(topic)
    const exactResources = exactSelection.resources
    const relaxedResources = relaxedSelection.resources
    const interpretations = buildInterpretations(this.database, parsed.window, exactResources, relaxedResources)
    const selected = selection
      ? interpretations.find((interpretation) => interpretation.id === selection.interpretationId) ?? null
      : interpretations.find((interpretation) => interpretation.exact) ?? (interpretations.length === 1 ? interpretations[0] ?? null : null)
    const needsClarification = !selected && interpretations.length > 1
    const activeIds = new Set(selected?.resourceIds ?? (exactResources.length > 0 ? exactResources.map((resource) => resource.id) : relaxedResources.map((resource) => resource.id)))
    const activeResources = [...exactResources, ...relaxedResources]
      .filter((resource, index, all) => activeIds.has(resource.id) && all.findIndex((candidate) => candidate.id === resource.id) === index)
      .slice(0, 12)
    const activeMomentIds = new Set(activeResources.flatMap((resource) => resource.provenanceMomentIds))
    const sourceResult = selected?.exact || !relaxed ? exact : relaxed
    const moments = sourceResult.hits
      .filter((hit) => activeMomentIds.has(hit.momentId))
      .slice(0, 12)
      .map((hit) => ({ id: hit.momentId, app: hit.app, title: hit.title, occurredAt: hit.occurredAt, score: hit.score, sessionId: hit.sessionId }))
    const sessions = mergeSessions(base.summary.sessions, this.database, activeResources, sourceResult, selected?.timeWindow ?? sourceResult.window)
    const constraints = [
      ...(parsed.window.label ? [{
        id: `constraint_${sha256(`time:${parsed.window.label}`).slice(0, 16)}`,
        kind: 'time' as const,
        label: `Time: ${parsed.window.label}`,
        value: parsed.window.label,
        source: 'explicit' as const,
        required: !referential,
      }] : []),
      ...(referential ? [{
        id: `constraint_${sha256('reference:prior-context').slice(0, 16)}`,
        kind: 'reference' as const,
        label: 'Use prior matching context',
        value: 'prior_matching_context',
        source: 'inferred' as const,
        required: true,
      }] : []),
    ]
    const resolution = {
      status: needsClarification ? 'needs_clarification' as const : selected ? 'resolved' as const : 'empty' as const,
      intent: revisitIntent(goal) ? 'revisit_resources' as const : goal.trim() ? 'operate' as const : 'unknown' as const,
      referential,
      constraints,
      exactMatchCount: exactResources.length,
      selectedInterpretationId: selected?.id ?? null,
      interpretations,
      diagnostics: {
        searchedMoments: exact.searchedMoments + (relaxed?.searchedMoments ?? 0),
        lexicalAvailable: true,
        semanticAvailable: this.semanticAvailable(),
        relaxedSearchUsed: relaxed !== null,
        topicTerms: exactSelection.topicTerms,
        candidateResourceCount: exactSelection.candidates + relaxedSelection.candidates,
        rejectedResourceCount: exactSelection.rejected + relaxedSelection.rejected,
      },
    }
    // Auto mode searches everything, then includes memory in the receipt only
    // when the request actually depends on it: it points back at prior context,
    // names a time window, or a resource passed the strict topic gate. A
    // self-contained request keeps a clean receipt instead of weak matches.
    const memoryNeeded = referential
      || revisitIntent(goal)
      || Boolean(parsed.window.label)
      || activeResources.length > 0
      || needsClarification
    const summary = this.applyMemoryReceipt({
      ...base.summary,
      readiness: needsClarification ? 'needs_clarification' : base.summary.readiness,
      sessions,
      moments,
      resources: activeResources,
      resolution,
    }, this.searchedReceipt(memory.mode, requestedSessionIds, resolvedSessionIds, memoryNeeded))
    this.audit.append('agent.context_resolved', 'system', selected?.id ?? null, {
      exactMatches: exactResources.length,
      relaxedMatches: relaxedResources.length,
      topicTerms: resolution.diagnostics.topicTerms,
      candidateResourceCount: resolution.diagnostics.candidateResourceCount,
      rejectedResourceCount: resolution.diagnostics.rejectedResourceCount,
      interpretations: interpretations.map((interpretation) => ({ id: interpretation.id, exact: interpretation.exact, resourceCount: interpretation.resourceIds.length })),
      selectedInterpretationId: selected?.id ?? null,
      needsClarification,
      semanticAvailable: resolution.diagnostics.semanticAvailable,
      constraintRelaxationDisclosed: relaxed !== null,
      historyGrantedExecutionAuthority: false,
    })
    return { ...base, summary }
  }

  /** The receipt shape for a scope whose history search actually ran. */
  private searchedReceipt(mode: WorkMemoryScope['mode'], requestedSessionIds: string[], resolvedSessionIds: string[], memoryNeeded: boolean): WorkContextMemoryReceipt {
    return {
      mode,
      requestedSessionIds,
      resolvedSessionIds,
      searched: true,
      used: mode === 'auto' ? memoryNeeded : true,
      reason: mode === 'selected' ? 'selected_sessions' : mode === 'all' ? 'all_memory' : memoryNeeded ? 'auto_used' : 'auto_not_needed',
    }
  }

  /**
   * Binds the memory decision to the receipt and enforces it on the summary.
   * When memory is not used, history matches are removed while procedure
   * provenance stays: the procedure is the plan's authority basis, not
   * retrieved context, and hiding where it came from would weaken the receipt.
   */
  private applyMemoryReceipt(summary: WorkContextSummary, receipt: WorkContextMemoryReceipt): WorkContextSummary {
    const applied: WorkContextSummary = receipt.used ? { ...summary, memory: receipt } : {
      ...summary,
      memory: receipt,
      sessions: summary.sessions
        .filter((session) => session.relation !== 'history_match')
        .map((session) => session.relation === 'procedure_and_history' ? { ...session, relation: 'procedure_evidence' as const, matchingMomentCount: 0 } : session),
      moments: [],
      ...(summary.resources ? { resources: [] } : {}),
    }
    this.audit.append('agent.memory_scope_applied', 'system', null, {
      mode: receipt.mode,
      requestedSessionCount: receipt.requestedSessionIds.length,
      resolvedSessionCount: receipt.resolvedSessionIds.length,
      searched: receipt.searched,
      used: receipt.used,
      reason: receipt.reason,
    })
    return applied
  }

  assemble(goal: string, now = Date.now(), history: AssembleHistoryOptions = { search: true, sessionIds: [] }): WorkContextAssembly {
    const parsed = parseRecallQuery(goal, now)
    const normalizedGoal = parsed.terms || goal.trim()
    const candidates = this.retriever.rank(normalizedGoal)
    const best = candidates[0] ?? null
    const runnerUp = candidates[1] ?? null
    const reviewed = Boolean(best && best.score >= EXECUTABLE_RETRIEVAL_THRESHOLD)
    const adapted = Boolean(best
      && best.score >= ADAPTIVE_RETRIEVAL_THRESHOLD
      && (!runnerUp || best.score - runnerUp.score >= ADAPTIVE_RETRIEVAL_MARGIN))
    const retrieval = reviewed || adapted ? best : null
    const match: WorkContextAssembly['match'] = reviewed ? 'reviewed' : adapted ? 'adapted' : null
    const recalled = !history.search ? { hits: [] as RecallResult['hits'] } : recall({
      searchMomentIds: (match, limit) => this.database.searchRecallMomentIds(match, limit),
      rankMomentIdsByBm25: (match, limit) => this.database.rankRecallMomentIdsByBm25(match, limit),
      rankMomentIdsByBm25InScope: (match, limit, fromIso, toIso, sessionIds) => this.database.rankRecallMomentIdsByBm25InScope(match, limit, fromIso, toIso, sessionIds),
      momentIdsForEntityTerms: (terms, limit) => this.database.listMomentIdsForEntityTerms(terms, limit),
      momentIdsForEntityTermsInScope: (terms, limit, fromIso, toIso, sessionIds) => this.database.listMomentIdsForEntityTermsInScope(terms, limit, fromIso, toIso, sessionIds),
      listMoments: (fromIso, toIso, limit, sessionIds) => this.database.listRecallMoments(fromIso, toIso, limit, sessionIds),
      countMoments: () => this.database.countRecallMoments(),
      countMomentsInScope: (fromIso, toIso, sessionIds) => this.database.countRecallMomentsInWindow(fromIso, toIso, sessionIds),
      entitiesForMoments: (momentIds) => this.database.listRecallEntitiesForMoments(momentIds),
    }, goal, {
      now,
      limit: 5,
      scanLimit: 2_000,
      perSignatureLimit: 2,
      sessionDescriptors: this.database.listSessions().map((session) => ({ id: session.id, label: session.name })),
      ...(history.sessionIds.length > 0 ? { scope: { fromIso: null, toIso: null, label: null, sessionIds: history.sessionIds } } : {}),
    })

    const procedureSessionIds = new Set<string>()
    if (retrieval) {
      for (const observationId of retrieval.procedure.provenanceObservationIds) {
        const observation = this.database.getObservation(observationId)
        if (observation) procedureSessionIds.add(observation.sessionId)
      }
    }

    const momentCounts = new Map<string, number>()
    for (const hit of recalled.hits) {
      if (hit.sessionId) momentCounts.set(hit.sessionId, (momentCounts.get(hit.sessionId) ?? 0) + 1)
    }
    const relatedSessionIds = new Set([...procedureSessionIds, ...momentCounts.keys()])
    const sessions = this.database.listSessions()
      .filter((session) => relatedSessionIds.has(session.id))
      .map((session): WorkContextSession => {
        const procedureEvidence = procedureSessionIds.has(session.id)
        const historyMatch = momentCounts.has(session.id)
        return {
          id: session.id,
          name: session.name,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          relation: procedureEvidence && historyMatch ? 'procedure_and_history' : procedureEvidence ? 'procedure_evidence' : 'history_match',
          matchingMomentCount: momentCounts.get(session.id) ?? 0,
          matchesTimeWindow: overlapsWindow(session.startedAt, session.endedAt, parsed.window.fromIso, parsed.window.toIso),
        }
      })
      .sort((left, right) => Number(right.matchesTimeWindow) - Number(left.matchesTimeWindow) || right.startedAt.localeCompare(left.startedAt))
      .slice(0, 6)

    const summary: WorkContextSummary = {
      originalGoal: goal.trim(),
      normalizedGoal,
      assembledAt: new Date(now).toISOString(),
      timeWindow: parsed.window,
      readiness: match === 'reviewed' ? 'ready' : match === 'adapted' ? 'adaptive' : 'needs_capability',
      procedure: retrieval ? {
        procedureId: retrieval.procedure.procedureId,
        version: retrieval.procedure.version,
        name: retrieval.procedure.name,
        goal: retrieval.procedure.goal,
        confidence: retrieval.procedure.confidence,
        retrievalScore: retrieval.score,
        components: retrieval.components,
        evidenceObservationCount: retrieval.procedure.provenanceObservationIds.length,
      } : null,
      sessions,
      moments: recalled.hits.slice(0, 5).map((hit) => ({
        id: hit.momentId,
        app: hit.app,
        title: hit.title,
        occurredAt: hit.occurredAt,
        score: hit.score,
        sessionId: hit.sessionId,
      })),
      boundary: 'history_is_context_only_procedure_authorizes_actions',
    }

    this.audit.append('agent.context_assembled', 'system', retrieval?.procedure.procedureId ?? null, {
      timeWindow: parsed.window.label,
      procedureId: retrieval?.procedure.procedureId ?? null,
      procedureVersion: retrieval?.procedure.version ?? null,
      retrievalScore: retrieval?.score ?? best?.score ?? 0,
      supportingSessions: sessions.length,
      matchingMoments: summary.moments.length,
      historyGrantedExecutionAuthority: false,
    })
    return { summary, retrieval, match, bestScore: best?.score ?? 0 }
  }
}

const referenceWords = new Set(['same', 'again', 'those', 'them', 'previous', 'before', 'continue', 'continued', 'were'])
/**
 * These words describe how to act on a remembered resource, or what container
 * it came from. They are useful constraints, but they must never be treated as
 * the subject of a Work retrieval: otherwise `Olympics wiki` matches every
 * title that happens to end in `- Wikipedia`.
 */
const genericResourceWords = new Set([
  'page', 'pages', 'site', 'sites', 'thing', 'things', 'resource', 'resources',
  'wiki', 'wikipedia', 'web', 'website', 'browser', 'tab', 'tabs', 'article', 'articles',
  'look', 'looking', 'take', 'go', 'back', 'open', 'reopen', 'visit', 'revisit',
  'browse', 'return', 'want', 'lets', 'let', 'were', 'was', 'are', 'the', 'and', 'for', 'from',
])

interface ResourceSelection {
  resources: WorkContextResource[]
  topicTerms: string[]
  candidates: number
  rejected: number
}

interface ResourceCandidate {
  resource: WorkContextResource
  titleText: string
  evidenceText: string
}

function referentialRequest(goal: string): boolean {
  return /\b(?:same|again|those|them|previous|before|continue|pick up|where we left off)\b/iu.test(goal)
}

function revisitIntent(goal: string): boolean {
  return /\b(?:open|reopen|visit|revisit|browse|look at|return to|continue|go\s+back|back\s+to)\b/iu.test(goal)
}

function contextTopic(value: string): string {
  return topicTerms(value).join(' ')
}

function topicTerms(value: string): string[] {
  return [...new Set(tokenize(value)
    .filter((token) => token.length > 2)
    .filter((token) => !referenceWords.has(token) && !genericResourceWords.has(token)))]
}

function emptyResourceSelection(topic: string): ResourceSelection {
  return { resources: [], topicTerms: topicTerms(topic), candidates: 0, rejected: 0 }
}

/**
 * Resource-level reranking for execution context.
 *
 * Recall is intentionally permissive: a shared domain or a related moment can
 * be useful when a person is exploring history. Work is different: a resource
 * is about to become an action target. Here we require coverage of the actual
 * subject terms, boost an exact title match, and preserve the decision on the
 * receipt. This deterministic gate is also the correct place to add a future
 * consented cross-encoder; it prevents a provider outage from widening scope.
 */
function resourcesForResult(database: CarveDatabase, result: RecallResult, topic: string): ResourceSelection {
  const hitsById = new Map(result.hits.map((hit, index) => [hit.momentId, { hit, rank: index + 1 }]))
  const projections = database.listRecallResourcesForMoments(result.hits.map((hit) => hit.momentId))
  const byResource = new Map<string, ResourceCandidate>()
  for (const { resource, occurrence } of projections) {
    const ranked = hitsById.get(occurrence.momentId)
    if (!ranked) continue
    const current = byResource.get(resource.id)
    const candidate: ResourceCandidate = current ?? {
      resource: {
        ...resource,
        score: ranked.hit.score,
        provenanceMomentIds: [],
        sessionIds: [],
        retrievalSignals: {
          lexicalRank: ranked.hit.components.lexical || null,
          semanticRank: ranked.hit.components.semantic || null,
          semanticScore: ranked.hit.components.semanticSimilarity ?? null,
          episodeRank: null,
          recencyRank: ranked.rank,
          topicTerms: [],
          matchedTopicTerms: [],
          topicCoverage: 0,
          titleCoverage: 0,
          rerankScore: 0,
        },
      },
      // Keep title/identity separate from captured body. A host or domain is
      // never evidence of a topic; a page title or its observed contents is.
      titleText: [resource.title, ...resource.aliases].join(' '),
      evidenceText: '',
    }
    candidate.resource.score = Math.max(candidate.resource.score, ranked.hit.score)
    if (!candidate.resource.provenanceMomentIds.includes(occurrence.momentId)) candidate.resource.provenanceMomentIds.push(occurrence.momentId)
    if (occurrence.sessionId && !candidate.resource.sessionIds.includes(occurrence.sessionId)) candidate.resource.sessionIds.push(occurrence.sessionId)
    candidate.evidenceText += ` ${ranked.hit.title} ${ranked.hit.body}`
    byResource.set(resource.id, candidate)
  }
  const all = [...byResource.values()]
  const terms = topicTerms(topic)
  if (terms.length === 0) {
    return {
      resources: all
        .map((candidate) => candidate.resource)
        .sort((left, right) => right.score - left.score || right.lastSeenAt.localeCompare(left.lastSeenAt)),
      topicTerms: terms,
      candidates: all.length,
      rejected: 0,
    }
  }

  const requiredTerms = terms.length === 1 ? 1 : Math.ceil(terms.length * 0.67)
  const ranked = all.map((candidate) => rerankResource(candidate, terms, requiredTerms))
  const accepted = ranked
    .filter((candidate) => candidate.accepted)
    .sort((left, right) => right.resource.retrievalSignals.rerankScore - left.resource.retrievalSignals.rerankScore
      || right.resource.score - left.resource.score
      || right.resource.lastSeenAt.localeCompare(left.resource.lastSeenAt))
    .map((candidate) => candidate.resource)

  return {
    resources: accepted,
    topicTerms: terms,
    candidates: all.length,
    rejected: all.length - accepted.length,
  }
}

function rerankResource(candidate: ResourceCandidate, terms: string[], requiredTerms: number): ResourceCandidate & { accepted: boolean } {
  const titleMatches = matchedTerms(candidate.titleText, terms)
  const evidenceMatches = matchedTerms(candidate.evidenceText, terms)
  const matched = [...new Set([...titleMatches, ...evidenceMatches])]
  const coverage = matched.length / terms.length
  const titleCoverage = titleMatches.length / terms.length
  // A title is a stable resource identity and much less prone to screen-chrome
  // contamination than OCR, so it receives the larger share of the score.
  const rerankScore = Math.min(1, coverage * 0.7 + titleCoverage * 0.25 + (titleMatches.length > 0 ? 0.05 : 0))
  candidate.resource.retrievalSignals = {
    ...candidate.resource.retrievalSignals,
    topicTerms: terms,
    matchedTopicTerms: matched,
    topicCoverage: coverage,
    titleCoverage,
    rerankScore,
  }
  return {
    ...candidate,
    // A single subject must be found. For a multi-term subject, one generic
    // overlap ("construction" in a commercial skyscraper page) cannot pass.
    accepted: matched.length >= requiredTerms && rerankScore >= 0.7,
  }
}

function matchedTerms(value: string, terms: string[]): string[] {
  const candidates = tokenize(value).filter((token) => token.length > 2)
  return terms.filter((query) => candidates.some((candidate) => candidate === query
    || (query.length >= 4 && candidate.startsWith(query))
    || (candidate.length >= 4 && query.startsWith(candidate))))
}

function buildInterpretations(
  database: CarveDatabase,
  requestedWindow: WorkContextSummary['timeWindow'],
  exact: WorkContextResource[],
  relaxed: WorkContextResource[],
): WorkContextInterpretation[] {
  if (exact.length > 0) {
    return [interpretationFor('Exact requested context', 'Matches the requested constraints.', exact, requestedWindow, true, 0.98, [])]
  }
  if (relaxed.length === 0) return []
  const sessions = new Map(database.listSessions().map((session) => [session.id, session]))
  const grouped = new Map<string, WorkContextResource[]>()
  for (const resource of relaxed) {
    const keys = resource.sessionIds.length > 0 ? resource.sessionIds : [`day:${resource.lastSeenAt.slice(0, 10)}`]
    for (const key of keys) {
      const group = grouped.get(key) ?? []
      if (!group.some((candidate) => candidate.id === resource.id)) group.push(resource)
      grouped.set(key, group)
    }
  }
  return [...grouped.entries()]
    .map(([key, resources], index) => {
      const session = sessions.get(key)
      const fromIso = session?.startedAt ?? `${resources[0]?.lastSeenAt.slice(0, 10)}T00:00:00.000Z`
      const toIso = session?.endedAt ?? resources[0]?.lastSeenAt ?? null
      const label = session?.name || new Date(resources[0]?.lastSeenAt ?? Date.now()).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
      const timeWindow = { fromIso, toIso, label }
      const timeConstraintId = `constraint_${sha256(`time:${requestedWindow.label ?? 'unspecified'}`).slice(0, 16)}`
      return interpretationFor(
        label,
        `${resources.length} matching resource${resources.length === 1 ? '' : 's'} from ${label}.`,
        resources,
        timeWindow,
        false,
        Math.max(0.55, 0.9 - index * 0.1),
        requestedWindow.label ? [{
          constraintId: timeConstraintId,
          reason: 'no_exact_matches' as const,
          originalValue: requestedWindow.label,
          relaxedValue: label,
        }] : [],
      )
    })
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 4)
}

function interpretationFor(
  label: string,
  summary: string,
  resources: WorkContextResource[],
  timeWindow: WorkContextInterpretation['timeWindow'],
  exact: boolean,
  confidence: number,
  relaxations: WorkContextInterpretation['relaxations'],
): WorkContextInterpretation {
  const resourceIds = [...new Set(resources.map((resource) => resource.id))]
  const sessionIds = [...new Set(resources.flatMap((resource) => resource.sessionIds))]
  return {
    id: `interpretation_${sha256(JSON.stringify({ label, resourceIds, timeWindow, exact })).slice(0, 20)}`,
    label,
    summary,
    confidence,
    exact,
    timeWindow,
    resourceIds,
    sessionIds,
    relaxations,
  }
}

function mergeSessions(
  procedureSessions: WorkContextSession[],
  database: CarveDatabase,
  resources: WorkContextResource[],
  result: RecallResult,
  activeWindow: WorkContextSummary['timeWindow'],
): WorkContextSession[] {
  const historyIds = new Set(resources.flatMap((resource) => resource.sessionIds))
  const counts = new Map<string, number>()
  for (const hit of result.hits) if (hit.sessionId && historyIds.has(hit.sessionId)) counts.set(hit.sessionId, (counts.get(hit.sessionId) ?? 0) + 1)
  const byId = new Map(procedureSessions.map((session) => [session.id, session]))
  for (const session of database.listSessions()) {
    if (!historyIds.has(session.id)) continue
    const prior = byId.get(session.id)
    byId.set(session.id, {
      id: session.id,
      name: session.name,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      relation: prior ? 'procedure_and_history' : 'history_match',
      matchingMomentCount: counts.get(session.id) ?? 0,
      matchesTimeWindow: overlapsWindow(session.startedAt, session.endedAt, activeWindow.fromIso, activeWindow.toIso),
    })
  }
  return [...byId.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, 8)
}

function overlapsWindow(startedAt: string, endedAt: string | null, fromIso: string | null, toIso: string | null): boolean {
  if (!fromIso && !toIso) return true
  const start = new Date(startedAt).getTime()
  const end = new Date(endedAt ?? startedAt).getTime()
  const from = fromIso ? new Date(fromIso).getTime() : Number.NEGATIVE_INFINITY
  const to = toIso ? new Date(toIso).getTime() : Number.POSITIVE_INFINITY
  return end >= from && start <= to
}
