import { isIP } from 'node:net'
import type { LiveComputerNavigationBinding, LiveComputerTaskLedger, LiveComputerObjective } from './types.js'

function explicitUrls(goal: string): Set<string> {
  return new Set((goal.match(/https:\/\/[^\s<>"“”`]+/giu) ?? []).flatMap(raw => {
    // Strip prose/Markdown delimiters, but retain balanced punctuation inside
    // the actual resource identity (for example /Article_(edition)).
    let candidate = raw.replace(/[.,;!?]+$/u, '')
    for (const [opening, closing] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      while (candidate.endsWith(closing!)
        && candidate.split(closing!).length > candidate.split(opening!).length) candidate = candidate.slice(0, -1)
    }
    try { return [new URL(candidate).href] } catch { return [] }
  }))
}

export function navigationUrlExplicitlyRequested(url: URL, goal: string): boolean {
  if (url.protocol !== 'https:' || url.username || url.password) return false
  if (explicitUrls(goal).has(url.href)) return true
  const prose = goal.replace(/https?:\/\/[^\s<>"“”`]+/giu, ' ')
    .replace(/[^\s@]+@[^\s@]+/gu, ' ')
  const hosts = prose.match(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/giu) ?? []
  return !url.search && !url.hash && !url.port && url.pathname === '/'
    && hosts.some(host => host.toLowerCase() === url.hostname)
}

export function parseNavigationBindings(raw: unknown, goal: string, ledger: Pick<LiveComputerTaskLedger, 'entities' | 'objectives'>): LiveComputerNavigationBinding[] {
  if (raw === undefined) return [] // Older stored/scripted plans have no inferred grants.
  if (!Array.isArray(raw) || raw.length > 16) throw new Error('Navigation bindings must be a bounded array')
  const seen = new Set<string>()
  const supplied = explicitUrls(goal)
  return raw.map(value => {
    if (!value || typeof value !== 'object') throw new Error('Invalid navigation binding')
    const item = value as Record<string, unknown>
    const entity = ledger.entities.find(e => e.id === item.entityId)
    if (!entity || !['site', 'application', 'resource', 'content'].includes(entity.kind)) throw new Error('Navigation binding references an unknown destination entity')
    // A route hint belongs to a task entity, not to one particular stage
    // classification. Creating an artifact also requires navigating to its
    // destination. The binding grants only its exact URL, never a write.
    if (typeof item.url !== 'string' || item.url.length > 2000 || typeof item.purpose !== 'string' || !item.purpose.trim() || item.purpose.length > 300) throw new Error('Navigation binding requires a bounded URL and purpose')
    let url: URL
    try { url = new URL(item.url) } catch { throw new Error('Navigation binding requires an absolute HTTPS URL') }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Navigation binding cannot contain credentials or non-HTTPS navigation')
    const provenance = supplied.has(url.href) ? 'user_url' : 'inferred_launch'
    if (item.provenance !== provenance) throw new Error('Navigation provenance must match the actual user request')
    if (provenance === 'inferred_launch') {
      const host = url.hostname
      if (url.pathname !== '/' || url.search || url.hash || url.port || host.endsWith('.')
        || isIP(host.replace(/^\[|\]$/gu, '')) || !host.includes('.')
        || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/iu.test(host)) {
        throw new Error('An inferred launch must be a public HTTPS origin without a path, payload, credentials, or port; discover resource pages through visible links')
      }
    }
    if (seen.has(entity.id)) throw new Error('Conflicting navigation bindings for one entity')
    seen.add(entity.id)
    return { entityId: entity.id, clauseId: entity.sourceClauseId, url: url.href, purpose: item.purpose.trim(), provenance, origin: url.origin }
  })
}

/** Bounded query strings carry navigation state; long or dense ones carry
 * payloads and are the exfiltration channel the injection literature warns
 * about. Fragments are never part of a destination's identity. */
export const navigationQueryLimit = 256

export type NavigationScopeDecision =
  | { allowed: true; scope: 'exact' | 'origin' | 'explicit'; bindingEntityId: string | null }
  | { allowed: false; scope: 'none'; reason: 'not_https' | 'credentials' | 'fragment' | 'query_too_long' | 'outside_origins' | 'payload_requires_exact' }

/**
 * Origin is the unit of authority. A bound launch origin covers every https
 * path on that exact origin; the plan's own deep link to a game
 * page is as authorized as the home page it came from. A user-supplied URL
 * with a payload (a non-root path or query) stays exact: the person named a
 * resource, not a site. Cross-origin destinations are never implied.
 */
export function navigationScopeDecision(url: URL, bindings: readonly LiveComputerNavigationBinding[]): NavigationScopeDecision {
  if (url.protocol !== 'https:') return { allowed: false, scope: 'none', reason: 'not_https' }
  if (url.username || url.password) return { allowed: false, scope: 'none', reason: 'credentials' }
  const exact = bindings.find(binding => binding.url === url.href)
  if (exact) return { allowed: true, scope: 'exact', bindingEntityId: exact.entityId }
  if (url.hash) return { allowed: false, scope: 'none', reason: 'fragment' }
  if (url.search.length > navigationQueryLimit) return { allowed: false, scope: 'none', reason: 'query_too_long' }
  let sawPayloadOnly = false
  for (const binding of bindings) {
    let bound: URL
    try { bound = new URL(binding.url) } catch { continue }
    if (url.origin !== bound.origin) continue
    // A person's exact resource does not authorize its neighbors.
    const payload = binding.provenance === 'user_url' && (bound.pathname !== '/' || bound.search)
    if (payload) { sawPayloadOnly = true; continue }
    return { allowed: true, scope: 'origin', bindingEntityId: binding.entityId }
  }
  return { allowed: false, scope: 'none', reason: sawPayloadOnly ? 'payload_requires_exact' : 'outside_origins' }
}

/** Compare the full observed origin, including scheme and port. A redirect
 * cannot silently broaden the reviewed site's authority. Paths remain native. */
export function navigationOriginAuthorized(origin: string, bindings: readonly LiveComputerNavigationBinding[], goal: string): boolean {
  let observed: URL
  try { observed = new URL(origin) } catch { return false }
  if (observed.protocol !== 'https:' || observed.username || observed.password || observed.origin !== origin) return false
  if (bindings.some(binding => { try { return new URL(binding.url).origin === origin } catch { return false } })) return true
  return [...explicitUrls(goal)].some(url => new URL(url).origin === origin)
    || navigationUrlExplicitlyRequested(observed, goal)
}

/** Only the frozen reviewed bindings count; action text never supplies grants. */
export function boundNavigationDestinations(
  bindings: readonly LiveComputerNavigationBinding[],
  ledger: Pick<LiveComputerTaskLedger, 'entities'>,
  objective: Pick<LiveComputerObjective, 'kind' | 'entityRefs' | 'clauseIds'>,
): LiveComputerNavigationBinding[] {
  const connected = new Set(objective.entityRefs)
  for (let pass = 0; pass < ledger.entities.length; pass += 1) {
    for (const entity of ledger.entities) {
      if (!entity.relatedTo) continue
      if (connected.has(entity.id)) connected.add(entity.relatedTo)
      if (connected.has(entity.relatedTo)) connected.add(entity.id)
    }
  }
  // A later clause can explicitly reuse the same site (e.g. reopen the
  // source during recovery). Mere graph proximity still needs clause scope.
  return bindings.filter(b => connected.has(b.entityId)
    && (objective.entityRefs.includes(b.entityId) || objective.clauseIds.includes(b.clauseId)))
}

export function navigationUrlIsBound(url: URL, bindings: readonly LiveComputerNavigationBinding[]): boolean {
  return navigationScopeDecision(url, bindings).allowed
}

/** Resolve a requested web application from the same reviewed entity bindings
 * as direct address entry. Names are exact normalized identities, not fuzzy
 * matches that could turn a similarly named native app into a web destination. */
export function requestedBoundNavigationDestination(
  label: string,
  bindings: readonly LiveComputerNavigationBinding[],
  ledger: Pick<LiveComputerTaskLedger, 'entities'>,
  objective: Pick<LiveComputerObjective, 'kind' | 'entityRefs' | 'clauseIds'>,
): { name: string; url: string } | null {
  const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
  const wanted = normalize(label)
  if (!wanted) return null
  const matches = boundNavigationDestinations(bindings, ledger, objective).flatMap(binding => {
    const entity = ledger.entities.find(candidate => candidate.id === binding.entityId)
    if (!entity) return []
    const url = new URL(binding.url)
    const identities = [entity.label, entity.id, url.href, url.hostname]
    return identities.some(identity => normalize(identity) === wanted) ? [{ name: entity.label, url: binding.url }] : []
  })
  if (new Set(matches.map(match => match.url)).size > 1) throw new Error('The requested destination matches multiple reviewed URLs; choose the exact bound entity or URL.')
  return matches[0] ?? null
}

/** A trusted native adapter classifies an actual editor path. This is not a
 * general domain alias: login, other products and arbitrary origins do not qualify. */
export function trustedTableServiceContinuity(service: 'google_sheets' | 'google_docs', bindings: readonly LiveComputerNavigationBinding[]): boolean {
  const launch = service === 'google_sheets' ? 'https://sheets.google.com/' : 'https://docs.google.com/'
  return bindings.some(b => b.url === launch && b.provenance === 'inferred_launch')
}
