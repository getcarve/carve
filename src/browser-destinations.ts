import { namedSiteDestinationCovered } from './computer-use/named-destinations.js'
import { navigationUrlExplicitlyRequested } from './navigation-authority.js'
import type { WorkSurfaceIntent } from './types.js'

/** Launch destinations from the task's resolved browser requirements. Only
 * payload-free HTTPS roots qualify; this grants neither arbitrary paths nor
 * an entire origin. Callers must bind the intent into the reviewed plan. */
export function browserLaunchDestinationsForIntent(intent?: WorkSurfaceIntent): Array<{ name: string; url: string }> {
  if (intent?.version !== 3) return []
  const resources = new Set(intent.requirements.filter(requirement => requirement.capability === 'web_browser')
    .flatMap(requirement => requirement.resourceIds ?? []))
  const seen = new Set<string>()
  return (intent.resources ?? []).flatMap(resource => {
    if (!resources.has(resource.id) || resource.binding !== 'required' || !resource.url) return []
    try {
      const url = new URL(resource.url)
      if (!isPayloadFreeLaunch(url) || seen.has(url.href)) return []
      seen.add(url.href)
      return [{ name: resource.destination, url: url.href }]
    } catch { return [] }
  }).slice(0, 16)
}

function isPayloadFreeLaunch(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash && url.pathname === '/'
}

/** Launch addresses plus the sites the request names (named-destinations.ts). A bare list is launch addresses only. */
export interface BrowserLaunchScope { urls: readonly string[]; namedSites?: readonly string[] }
export type BrowserLaunch = readonly string[] | BrowserLaunchScope

export function browserLaunchDestinationCovered(url: URL, launch: BrowserLaunch = []): boolean {
  const scope: BrowserLaunchScope = Array.isArray(launch) ? { urls: launch as readonly string[] } : launch as BrowserLaunchScope
  if (scope.namedSites?.length && namedSiteDestinationCovered(url, scope.namedSites)) return true
  const launchUrls = scope.urls
  return isPayloadFreeLaunch(url) && launchUrls.some(value => {
    try { const launch = new URL(value); return isPayloadFreeLaunch(launch) && launch.href === url.href } catch { return false }
  })
}

/** Separate from provider web-search permission: displayed in the browser
 * plan review and bound into its task hash before use. */
export interface BrowserResearchScope { version: 1; queries: string[] }

export function browserResearchReview(scope: BrowserResearchScope): string {
  return `Public research: search Google for ${scope.queries.map(query => JSON.stringify(query)).join('; ')} and read Wikipedia pages about those topics.`
}

export function browserResearchDestinationCovered(url: URL, scope?: BrowserResearchScope): boolean {
  if (!scope || scope.version !== 1 || !scope.queries.length || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false
  if (url.origin === 'https://www.google.com' && url.pathname === '/search') {
    const entries = [...url.searchParams.entries()]
    return entries.length === 1 && entries[0]![0] === 'q' && scope.queries.includes(entries[0]![1])
  }
  if (!/^(?:(?:[a-z]{2,12})(?:\.m)?\.)?wikipedia\.org$/u.test(url.hostname)) return false
  return scope.queries.some(query => browserDestinationCoveredByGoal(url, `Wikipedia ${query}`))
}

/** Web products run inside an authorized browser, independently of the
 * installed native-application catalog. These entries describe navigation
 * only; creating, editing, or sharing an artifact retains its own checks. */
const webProducts = [
  { name: 'Google Docs', pattern: /\bgoogle docs?\b/iu, url: 'https://docs.google.com', paths: ['/', '/document', '/document/'] },
  { name: 'Google Sheets', pattern: /\bgoogle sheets?\b/iu, url: 'https://sheets.google.com', paths: ['/'] },
] as const

export function requestedBrowserDestinations(goal: string): Array<{ name: string; url: string }> {
  return webProducts.flatMap((product) => {
    const match = product.pattern.exec(goal)
    return match ? [{ name: product.name, url: product.url, index: match.index }] : []
  }).sort((left, right) => left.index - right.index).map(({ name, url }) => ({ name, url }))
}

export function requestedBrowserDestination(goal: string, name: string): { name: string; url: string } | null {
  const wanted = name.trim().toLocaleLowerCase()
  return requestedBrowserDestinations(goal).find((destination) => (
    destination.name.toLocaleLowerCase() === wanted
    || destination.name.toLocaleLowerCase().replace(/s$/u, '') === wanted
    || new URL(destination.url).hostname === wanted
  )) ?? null
}

/** Canonical launch pages contain no user payload. Match exact origins and
 * paths; a product name must never authorize lookalike hosts or URL data. */
export function requestedBrowserLaunchUrl(url: URL, goal: string): boolean {
  if (url.username || url.password || url.search || url.hash) return false
  return webProducts.some((product) => product.pattern.test(goal)
    && url.origin === product.url && (product.paths as readonly string[]).includes(url.pathname))
}

/** Authority comes from an exact URL supplied by the person, a canonical
 * launcher, or a narrowly defined read-only route. Brand-like host tokens
 * never establish ownership of an origin. Keep payloads intact: short and
 * numeric values, parameter names, ports and fragments are not scaffolding. */
export function browserDestinationCoveredByGoal(url: URL, goal: string): boolean {
  if (url.protocol !== 'https:' || url.username || url.password) return false
  if (navigationUrlExplicitlyRequested(url, goal)) return true
  if (requestedBrowserLaunchUrl(url, goal)) return true
  if (url.port || url.hash || url.hostname.endsWith('.')) return false

  // Wikipedia article/search navigation has a known read-only route grammar.
  // Only a single language (optionally mobile) subdomain belongs to this rule.
  if (!/\b(?:wiki|wikipedia)\b/iu.test(goal)
    || !/^(?:(?:[a-z]{2,12})(?:\.m)?\.)?wikipedia\.org$/u.test(url.hostname)) return false
  if (url.pathname === '/' && !url.search) return true
  const goalTerms = new Set(destinationTerms(goal))
  const covered = (value: string): boolean => {
    const terms = destinationTerms(value)
    return terms.length > 0 && terms.every((term) => goalTerms.has(term))
  }
  try {
    const path = decodeURIComponent(url.pathname)
    if (path === '/wiki/Special:Search') {
      const entries = [...url.searchParams.entries()]
      return entries.length === 1 && entries[0]![0] === 'search' && covered(entries[0]![1])
    }
    return !url.search && path.startsWith('/wiki/')
      && !/[:/%\\]/u.test(path.slice('/wiki/'.length))
      && covered(path.slice('/wiki/'.length))
  } catch { return false }
}

function destinationTerms(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}
