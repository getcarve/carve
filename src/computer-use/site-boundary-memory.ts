import type { SiteBoundaryKind } from './site-boundaries.js'
import type { NamedDestination } from './named-destinations.js'

/**
 * Which sites recently stopped Carve at a boundary (a human-verification check,
 * a rate limit, an access-denied page), by site label only: no address, path,
 * page text or time of day beyond the day. A multi-site request visits the
 * sites with no such history first, so a bot wall on one site no longer costs
 * the run before the others are read (a product comparison across two
 * retailers: the first hit "Press & hold", the second was never visited).
 *
 * Advice for ordering only: it never skips a site the person named, and it
 * never grants or withholds input. Entries fade after `retentionDays`.
 * `STEWARD_BOUNDARY_ORDERING=off` keeps the request's own order.
 */
export const boundaryOrderingEnabled = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_BOUNDARY_ORDERING?.trim().toLowerCase() !== 'off'
export const siteBoundaryMemorySetting = 'site_boundary_memory_v1'

export interface SiteBoundaryRecord { kind: SiteBoundaryKind; day: string; count: number }
export type SiteBoundaryMemory = Record<string, SiteBoundaryRecord>

const retentionDays = 14
const maximumSites = 200
const kinds: readonly SiteBoundaryKind[] = ['human_verification', 'verification_mentioned', 'authentication', 'access_denied', 'rate_limited', 'page_missing']

/** Only boundaries that a later visit is likely to meet again; a missing page is about one address, not the site. */
const remembered = (kind: SiteBoundaryKind) => kind !== 'page_missing' && kind !== 'verification_mentioned'

export function parseSiteBoundaryMemory(raw: string | null | undefined): SiteBoundaryMemory {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const memory: SiteBoundaryMemory = {}
    for (const [label, record] of Object.entries(value as Record<string, unknown>)) {
      const r = record as Partial<SiteBoundaryRecord> | null
      if (!/^[a-z0-9]{2,40}$/u.test(label) || !r || !kinds.includes(r.kind as SiteBoundaryKind) || typeof r.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(r.day)
        || typeof r.count !== 'number' || !Number.isFinite(r.count)) continue
      memory[label] = { kind: r.kind as SiteBoundaryKind, day: r.day, count: Math.max(1, Math.min(99, Math.floor(r.count))) }
    }
    return memory
  } catch { return {} }
}

const day = (now: Date) => now.toISOString().slice(0, 10)
const ageDays = (record: SiteBoundaryRecord, now: Date) => (Date.parse(`${day(now)}T00:00:00Z`) - Date.parse(`${record.day}T00:00:00Z`)) / 86_400_000

/** Remember a boundary on a site; returns a new, bounded memory without expired entries. */
export function recordSiteBoundary(memory: SiteBoundaryMemory, label: string | null, kind: SiteBoundaryKind, now = new Date()): SiteBoundaryMemory {
  const current = pruneSiteBoundaryMemory(memory, now)
  if (!label || !/^[a-z0-9]{2,40}$/u.test(label) || !remembered(kind)) return current
  const previous = current[label]
  const next: SiteBoundaryMemory = { ...current, [label]: { kind, day: day(now), count: Math.min(99, (previous?.count ?? 0) + 1) } }
  const labels = Object.keys(next).sort((a, b) => next[b]!.day.localeCompare(next[a]!.day))
  return Object.fromEntries(labels.slice(0, maximumSites).map(key => [key, next[key]!]))
}

export function pruneSiteBoundaryMemory(memory: SiteBoundaryMemory, now = new Date()): SiteBoundaryMemory {
  return Object.fromEntries(Object.entries(memory).filter(([, record]) => ageDays(record, now) <= retentionDays))
}

/** Sites with no recent boundary first, in the request's order; then the rest, least troublesome first. Nothing is dropped. */
export function orderDestinationsByBoundaryHistory<T extends NamedDestination>(destinations: readonly T[], memory: SiteBoundaryMemory, now = new Date()): Array<T & { boundary: SiteBoundaryRecord | null }> {
  const current = pruneSiteBoundaryMemory(memory, now)
  const annotated = destinations.map((destination, index) => ({ ...destination, boundary: current[destination.label] ?? null, index }))
  if (!boundaryOrderingEnabled()) return annotated.map(({ index: _index, ...rest }) => rest as T & { boundary: SiteBoundaryRecord | null })
  const severity = (record: SiteBoundaryRecord | null) => record === null ? 0 : record.kind === 'human_verification' ? 3 : record.kind === 'access_denied' ? 2 : 1
  return annotated.sort((a, b) => severity(a.boundary) - severity(b.boundary) || (a.boundary?.count ?? 0) - (b.boundary?.count ?? 0) || a.index - b.index)
    .map(({ index: _index, ...rest }) => rest as T & { boundary: SiteBoundaryRecord | null })
}
