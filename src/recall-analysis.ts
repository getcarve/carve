/**
 * Intent-aware analysis over a bounded recall scope.
 *
 * Point lookup and analytical recall are different jobs. A lookup should rank a
 * few passages; an overview, comparison, inventory, or frequency question must
 * account for the whole selected scope. This module keeps that distinction
 * explicit and performs every count/set operation deterministically.
 */
import type { RecallMoment } from './recall.js'

export type RecallIntent =
  | 'lookup'
  | 'overview'
  | 'themes'
  | 'compare'
  | 'capture_count'
  | 'frequency'
  | 'inventory'
  | 'timeline'
  | 'trend'
  | 'visual'

export interface RecallQueryPlan {
  intent: RecallIntent
  unit: 'moment' | 'episode' | 'session' | 'tool'
  exhaustive: boolean
  answerStrategy: 'deterministic' | 'synthesis'
  rationale: string
}

export interface RecallSessionDescriptor {
  id: string
  label: string
}

export interface RecallCoverage {
  eligibleMoments: number
  analyzedMoments: number
  truncated: boolean
  selectedSessions: number
  representedSessions: number
}

export interface RecallSessionSummary {
  sessionId: string | null
  label: string
  moments: number
  screenshotCaptures: number
  startedAt: string | null
  endedAt: string | null
  applications: string[]
  topActivities: string[]
}

export interface RecallToolUsage {
  tool: string
  kind: 'application' | 'website'
  observations: number
  visits: number
  sessions: number
  durationMs: number | null
  durationCoverage: number
  evidenceMomentIds: string[]
}

export interface RecallTheme {
  label: string
  observations: number
  sessions: number
  evidenceMomentIds: string[]
}

export interface RecallComparison {
  sessionId: string
  label: string
  moments: number
  applications: string[]
  topActivities: string[]
  uniqueApplications: string[]
}

export interface RecallAnalysis {
  coverage: RecallCoverage
  captures: {
    recordedMoments: number
    screenshotCaptures: number
    textOnlyMoments: number
  }
  sessions: RecallSessionSummary[]
  tools: RecallToolUsage[]
  themes: RecallTheme[]
  comparison: RecallComparison[]
  sharedApplications: string[]
}

const phrase = (value: string, expression: RegExp): boolean => expression.test(value.toLowerCase())

/** Classifies how the requested scope must be read before any content search. */
export function planRecallQuestion(question: string, selectedSessions: number, hasTimeWindow: boolean): RecallQueryPlan {
  const q = question.trim().toLowerCase()
  const compare = phrase(q, /\b(compare|comparison|versus|vs\.?|difference|different|similarities|contrast)\b/u)
  const captureCount = phrase(q, /\b(how many|number of|count)\b.*\b(screenshots?|captures?|frames?|observations?|recorded moments?)\b/u)
    || phrase(q, /\b(screenshots?|captures?|frames?|observations?)\b.*\b(how many|number|count)\b/u)
  const frequency = phrase(q, /\b(how often|frequency|frequently|most used|least used|usage|how many times|time spent|spend.*time)\b/u)
  const inventory = phrase(q, /\b(list|all|every|which|what)\b.*\b(tools?|apps?|applications?|software|websites?|services?|platforms?)\b/u)
    || phrase(q, /\b(tools?|apps?|applications?|software|websites?|services?|platforms?)\b.*\b(use|uses|used|using)\b/u)
  const themes = phrase(q, /\b(theme|themes|thematic|topics?|overarching|patterns?|categories)\b/u)
  const trend = phrase(q, /\b(trend|increase|decrease|changed over time|more often|less often|week over week|month over month)\b/u)
  const visual = phrase(q, /\b(looked like|appearance|colour|color|layout|screenshot|visible|on the (left|right)|icon)\b/u)
  const overview = phrase(q, /\b(what did i do|what did we do|summari[sz]e|summary|overview|recap|key activities|important details|main activities|decisions|follow[- ]?ups?|next steps)\b/u)
  const timeline = phrase(q, /\b(timeline|chronolog|sequence|what happened|walk me through)\b/u)
    || (hasTimeWindow && phrase(q, /\b(what did i do|what was i doing|what happened)\b/u))

  if (captureCount) return { intent: 'capture_count', unit: 'moment', exhaustive: true, answerStrategy: 'deterministic', rationale: 'The question asks for an exact count of recorded captures over the selected scope.' }
  if (frequency) return { intent: 'frequency', unit: 'tool', exhaustive: true, answerStrategy: 'deterministic', rationale: 'The question asks for a count, frequency, or duration over the selected scope.' }
  if (inventory) return { intent: 'inventory', unit: 'tool', exhaustive: true, answerStrategy: 'deterministic', rationale: 'The question asks for a complete observed set, not the most relevant screens.' }
  if (compare && selectedSessions >= 2) return { intent: 'compare', unit: 'session', exhaustive: true, answerStrategy: 'synthesis', rationale: 'The selected sessions must be analyzed independently before they can be compared.' }
  if (trend) return { intent: 'trend', unit: 'session', exhaustive: true, answerStrategy: 'synthesis', rationale: 'A trend requires comparable aggregates across the complete time/session scope.' }
  if (themes) return { intent: 'themes', unit: 'episode', exhaustive: true, answerStrategy: 'synthesis', rationale: 'Themes require representative coverage of the scope rather than keyword matches for “theme”.' }
  if (timeline) return { intent: 'timeline', unit: 'episode', exhaustive: true, answerStrategy: 'deterministic', rationale: 'A timeline is produced from scoped moments in chronological order.' }
  if (overview || (!q && selectedSessions > 0)) return { intent: 'overview', unit: 'session', exhaustive: true, answerStrategy: 'synthesis', rationale: 'A session overview must account for the selected session instead of searching for the word “session”.' }
  if (visual) return { intent: 'visual', unit: 'moment', exhaustive: false, answerStrategy: 'synthesis', rationale: 'The question asks for visual evidence from matching captures.' }
  return { intent: 'lookup', unit: 'moment', exhaustive: false, answerStrategy: 'synthesis', rationale: 'The question names a fact or topic best answered by retrieving matching moments.' }
}

function canonicalApplication(moment: RecallMoment): string {
  const app = moment.app.trim() || 'Unknown application'
  if (/^electron$/iu.test(app) && /\bsteward\b/iu.test(moment.title)) return 'Carve'
  return app
}

function website(moment: RecallMoment): string | null {
  if (!moment.url) return null
  try {
    const host = new URL(moment.url).hostname.toLowerCase().replace(/^www\./u, '')
    if (!host || host === '127.0.0.1' || host === 'localhost') return null
    return host
  } catch {
    return null
  }
}

const genericTitles = new Set(['untitled window', 'new tab', 'steward observing', 'desktop'])
const containerSuffixes = new Set(['wikipedia', 'google search', 'github', 'youtube', 'reddit', 'stack overflow'])

function activityLabel(moment: RecallMoment): string | null {
  let title = moment.title.replace(/^\[|\]$/gu, '').trim()
  if (!title || genericTitles.has(title.toLowerCase())) return null
  const pieces = title.split(/\s+[-—|·]\s+/u).map((part) => part.trim()).filter(Boolean)
  const suffix = pieces.at(-1)?.toLowerCase() ?? ''
  if (pieces.length > 1 && (containerSuffixes.has(suffix) || suffix === canonicalApplication(moment).toLowerCase())) {
    title = pieces.slice(0, -1).join(' — ')
  }
  return title.slice(0, 100)
}

function sessionKey(moment: RecallMoment): string { return moment.sessionId ?? '__ambient__' }

function sessionLabel(id: string, descriptors: RecallSessionDescriptor[]): string {
  if (id === '__ambient__') return 'Ambient history'
  return descriptors.find((session) => session.id === id)?.label ?? 'Recorded session'
}

function topCounts(values: string[], limit: number): string[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value]) => value)
}

export function analyzeRecallScope(
  moments: RecallMoment[],
  descriptors: RecallSessionDescriptor[],
  eligibleMoments = moments.length,
  selectedSessionCount = descriptors.length,
): RecallAnalysis {
  const ordered = [...moments].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || (left.sequence ?? 0) - (right.sequence ?? 0))
  const groups = new Map<string, RecallMoment[]>()
  for (const moment of ordered) {
    const key = sessionKey(moment)
    const group = groups.get(key) ?? []
    group.push(moment)
    groups.set(key, group)
  }

  // Keep empty selected sessions visible: “nothing was captured” is materially
  // different from silently omitting one side of a comparison.
  if (selectedSessionCount > 0) {
    for (const descriptor of descriptors) if (!groups.has(descriptor.id)) groups.set(descriptor.id, [])
  }

  const sessions = [...groups.entries()].map(([key, group]): RecallSessionSummary => {
    const applications = topCounts(group.map(canonicalApplication), 8)
    const activities = group.map(activityLabel).filter((label): label is string => Boolean(label))
    return {
      sessionId: key === '__ambient__' ? null : key,
      label: sessionLabel(key, descriptors),
      moments: group.length,
      screenshotCaptures: group.filter((moment) => Boolean(moment.screenshotRef)).length,
      startedAt: group[0]?.occurredAt ?? null,
      endedAt: group.at(-1)?.occurredAt ?? null,
      applications,
      topActivities: topCounts(activities, 6),
    }
  }).sort((left, right) => (left.startedAt ?? '').localeCompare(right.startedAt ?? ''))

  const toolRows = new Map<string, {
    tool: string
    kind: RecallToolUsage['kind']
    observations: number
    visits: number
    sessionIds: Set<string>
    durationMs: number
    durationCoverage: number
    evidenceMomentIds: string[]
  }>()
  const previousTools = new Map<string, Set<string>>()
  for (const moment of ordered) {
    const tools: Array<{ tool: string; kind: RecallToolUsage['kind'] }> = [{ tool: canonicalApplication(moment), kind: 'application' }]
    const host = website(moment)
    if (host) tools.push({ tool: host, kind: 'website' })
    const key = sessionKey(moment)
    const previous = previousTools.get(key) ?? new Set<string>()
    const current = new Set(tools.map((tool) => `${tool.kind}:${tool.tool.toLowerCase()}`))
    for (const entry of tools) {
      const rowKey = `${entry.kind}:${entry.tool.toLowerCase()}`
      const row = toolRows.get(rowKey) ?? {
        ...entry,
        observations: 0,
        visits: 0,
        sessionIds: new Set<string>(),
        durationMs: 0,
        durationCoverage: 0,
        evidenceMomentIds: [],
      }
      row.observations += 1
      if (!previous.has(rowKey)) row.visits += 1
      row.sessionIds.add(key)
      if (moment.durationMs !== null && moment.durationMs !== undefined) {
        row.durationMs += Math.max(0, moment.durationMs)
        row.durationCoverage += 1
      }
      if (row.evidenceMomentIds.length < 5) row.evidenceMomentIds.push(moment.momentId)
      toolRows.set(rowKey, row)
    }
    previousTools.set(key, current)
  }
  const tools: RecallToolUsage[] = [...toolRows.values()].map((row) => ({
    tool: row.tool,
    kind: row.kind,
    observations: row.observations,
    visits: row.visits,
    sessions: row.sessionIds.size,
    durationMs: row.durationCoverage > 0 ? row.durationMs : null,
    durationCoverage: row.durationCoverage,
    evidenceMomentIds: row.evidenceMomentIds,
  })).sort((left, right) => right.visits - left.visits || right.observations - left.observations || left.tool.localeCompare(right.tool))

  const themeRows = new Map<string, { label: string; observations: number; sessions: Set<string>; evidenceMomentIds: string[] }>()
  for (const moment of ordered) {
    const label = activityLabel(moment)
    if (!label) continue
    const key = label.toLowerCase()
    const row = themeRows.get(key) ?? { label, observations: 0, sessions: new Set<string>(), evidenceMomentIds: [] }
    row.observations += 1
    row.sessions.add(sessionKey(moment))
    if (row.evidenceMomentIds.length < 5) row.evidenceMomentIds.push(moment.momentId)
    themeRows.set(key, row)
  }
  const themes: RecallTheme[] = [...themeRows.values()].map((row) => ({
    label: row.label,
    observations: row.observations,
    sessions: row.sessions.size,
    evidenceMomentIds: row.evidenceMomentIds,
  })).sort((left, right) => right.sessions - left.sessions || right.observations - left.observations || left.label.localeCompare(right.label)).slice(0, 20)

  const allSessionApps = sessions.filter((session) => session.sessionId !== null).map((session) => new Set(session.applications))
  const sharedApplications = allSessionApps.length < 2
    ? []
    : [...(allSessionApps[0] ?? [])].filter((application) => allSessionApps.every((apps) => apps.has(application)))
  const comparison = sessions.filter((session): session is RecallSessionSummary & { sessionId: string } => session.sessionId !== null).map((session) => {
    const others = new Set(sessions.filter((candidate) => candidate.sessionId !== session.sessionId).flatMap((candidate) => candidate.applications))
    return {
      sessionId: session.sessionId,
      label: session.label,
      moments: session.moments,
      applications: session.applications,
      topActivities: session.topActivities,
      uniqueApplications: session.applications.filter((application) => !others.has(application)),
    }
  })

  return {
    coverage: {
      eligibleMoments,
      analyzedMoments: moments.length,
      truncated: moments.length < eligibleMoments,
      selectedSessions: selectedSessionCount,
      representedSessions: sessions.filter((session) => session.moments > 0).length,
    },
    captures: {
      recordedMoments: ordered.length,
      screenshotCaptures: ordered.filter((moment) => Boolean(moment.screenshotRef)).length,
      textOnlyMoments: ordered.filter((moment) => !moment.screenshotRef).length,
    },
    sessions,
    tools,
    themes,
    comparison,
    sharedApplications,
  }
}

function joinNatural(values: string[]): string {
  if (values.length === 0) return 'none'
  if (values.length === 1) return values[0] ?? 'none'
  return `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`
}

function durationLabel(durationMs: number | null): string {
  if (durationMs === null) return ''
  const minutes = Math.round(durationMs / 60_000)
  return minutes < 1 ? 'under a minute of measured foreground time' : `${minutes} min of measured foreground time`
}

/** A useful answer exists without a model for every analytical plan. */
export function composeAnalyticalAnswer(plan: RecallQueryPlan, analysis: RecallAnalysis): string {
  const { coverage } = analysis
  if (coverage.analyzedMoments === 0) return 'Nothing was recorded in the selected scope.'
  const caveat = coverage.truncated
    ? ` Analyzed ${coverage.analyzedMoments.toLocaleString()} of ${coverage.eligibleMoments.toLocaleString()} eligible moments; the result is incomplete.`
    : ` Analyzed all ${coverage.analyzedMoments.toLocaleString()} recorded moments in scope.`

  if (plan.intent === 'capture_count') {
    const perSession = analysis.sessions
      .filter((session) => session.sessionId !== null)
      .map((session) => `${session.label}: ${session.screenshotCaptures.toLocaleString()}`)
    const breakdown = perSession.length > 1 ? ` By session: ${perSession.join('; ')}.` : ''
    const count = analysis.captures.screenshotCaptures
    return `Carve recorded ${count.toLocaleString()} screenshot capture${count === 1 ? '' : 's'} in the selected scope.${breakdown}${caveat}`
  }

  if (plan.intent === 'frequency') {
    const top = analysis.tools.slice(0, 6).map((tool) => {
      const duration = durationLabel(tool.durationMs)
      return `${tool.tool}: ${tool.visits} foreground visit${tool.visits === 1 ? '' : 's'} across ${tool.sessions} session${tool.sessions === 1 ? '' : 's'}${duration ? `, ${duration}` : ''}`
    })
    return `Observed tool usage: ${top.join('; ')}.${caveat} Visits are application transitions; capture count is not treated as usage frequency.`
  }
  if (plan.intent === 'inventory') {
    const applications = analysis.tools.filter((tool) => tool.kind === 'application').map((tool) => tool.tool)
    const websites = analysis.tools.filter((tool) => tool.kind === 'website').map((tool) => tool.tool)
    return `Observed applications: ${joinNatural(applications)}.${websites.length > 0 ? ` Observed websites: ${joinNatural(websites)}.` : ''}${caveat} This is an inventory of what Carve observed, not proof of every tool a company uses.`
  }
  if (plan.intent === 'compare') {
    const sides = analysis.comparison.map((session) => `${session.label}: ${session.topActivities.length > 0 ? joinNatural(session.topActivities.slice(0, 4)) : 'no specific activity title was captured'} (${joinNatural(session.applications.slice(0, 4))})`)
    const shared = analysis.sharedApplications.length > 0 ? ` Shared applications: ${joinNatural(analysis.sharedApplications)}.` : ' No application was observed in every selected session.'
    return `${sides.join(' · ')}.${shared}${caveat}`
  }
  if (plan.intent === 'themes') {
    const themes = analysis.themes.slice(0, 6).map((theme) => `${theme.label}${theme.sessions > 1 ? ` (${theme.sessions} sessions)` : ''}`)
    return `The strongest observed activity themes were ${joinNatural(themes)}.${caveat}`
  }
  if (plan.intent === 'timeline') {
    const sessions = analysis.sessions.map((session) => `${session.label}: ${joinNatural(session.topActivities.slice(0, 4))}`)
    const applications = [...new Set(analysis.sessions.flatMap((session) => session.applications))]
    return `In the selected scope you moved between ${joinNatural(applications)}. ${sessions.join(' · ')}.${caveat}`
  }
  if (plan.intent === 'trend') {
    const sessions = analysis.sessions.map((session) => `${session.label} had ${session.moments} recorded moment${session.moments === 1 ? '' : 's'} across ${joinNatural(session.applications.slice(0, 4))}`)
    return `${sessions.join(' · ')}.${caveat} Capture density is not treated as time spent unless foreground duration was measured.`
  }
  const sessions = analysis.sessions.map((session) => `${session.label}: ${joinNatural(session.topActivities.slice(0, 5))}, mainly in ${joinNatural(session.applications.slice(0, 4))}`)
  return `${sessions.join(' · ')}.${caveat}`
}

/**
 * Balances evidence across sessions and across the beginning/middle/end of each
 * session. This evidence is for synthesis and display; aggregates above always
 * use the complete analyzed scope.
 */
export function selectRepresentativeMoments(moments: RecallMoment[], limit = 30): RecallMoment[] {
  if (moments.length <= limit) return [...moments].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
  const groups = new Map<string, RecallMoment[]>()
  for (const moment of [...moments].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))) {
    const key = sessionKey(moment)
    const group = groups.get(key) ?? []
    group.push(moment)
    groups.set(key, group)
  }
  const buckets = [...groups.values()].map((group) => {
    const byScreen = new Map<string, RecallMoment[]>()
    for (const moment of group) {
      const key = `${canonicalApplication(moment)}\u0000${moment.title}`
      const screens = byScreen.get(key) ?? []
      screens.push(moment)
      byScreen.set(key, screens)
    }
    const distinct = [...byScreen.values()].flatMap((screens) => {
      if (screens.length <= 2) return screens
      return [screens[0], screens.at(-1)].filter((moment): moment is RecallMoment => Boolean(moment))
    }).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    if (distinct.length <= 3) return distinct
    const ordered: RecallMoment[] = []
    let left = 0
    let right = distinct.length - 1
    while (left <= right) {
      const first = distinct[left]
      if (first) ordered.push(first)
      if (right !== left) {
        const last = distinct[right]
        if (last) ordered.push(last)
      }
      left += 1
      right -= 1
    }
    return ordered
  })
  const selected: RecallMoment[] = []
  let index = 0
  while (selected.length < limit && buckets.some((bucket) => index < bucket.length)) {
    for (const bucket of buckets) {
      const moment = bucket[index]
      if (moment) selected.push(moment)
      if (selected.length >= limit) break
    }
    index += 1
  }
  return selected.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
}
