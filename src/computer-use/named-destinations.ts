import type { WorkSurfaceIntent, WorkSurfaceResource } from '../types.js'

/**
 * Multi-destination requests ("compare a product at Big Shop and Store Two"): each
 * site the person names is its own objective. The router usually leaves such a
 * resource's address null, so typing bigshop.com counted as leaving the plan
 * and paid for a model review of the address (158 s over 65 retail runs;
 * one classifieds run alone 48 s). A named site is resolved here, at plan time, to a
 * site label (the words of its name: "Big Shop" -> bigshop, "A&B" -> ab), and
 * the browser-location policy covers that site's own public origin, and only
 * that one (see `namedSiteDestinationCovered`).
 *
 * The label never grants a different site: a host must be exactly the label on
 * a common public suffix, optionally behind "www." or "m.". It never grants
 * credentials, ports, fragments or a long query (a payload channel).
 * `STEWARD_NAMED_SITES=off` resolves nothing (the earlier behaviour).
 */
export const namedSitesEnabled = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_NAMED_SITES?.trim().toLowerCase() !== 'off'

export interface NamedDestination { name: string; label: string }

/** `STEWARD_DESTINATION_TABS=off`: every destination opens in the current tab and Command-T stays unclassified. */
export const destinationTabsEnabled = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_DESTINATION_TABS?.trim().toLowerCase() !== 'off'

/** Words that name the kind of place, not the site: "Big Shop website" is Big Shop. */
const generic = new Set(['website', 'site', 'web', 'online', 'store', 'shop', 'app', 'page', 'homepage', 'official', 'the', 'com', 'www'])
/** Public suffixes a named retail or service site plausibly uses; anything else is not implied by a name. */
const oneLabelSuffix = new Set(['com', 'org', 'net', 'co', 'io', 'us', 'ca', 'uk', 'de', 'fr', 'es', 'it', 'nl', 'au', 'jp', 'ie', 'nz'])
const twoPartSuffix = new Set(['co.uk', 'org.uk', 'com.au', 'co.jp', 'co.nz'])
const queryLimit = 256

/** The site label a destination name resolves to, or null when the name is not a proper site name in the request. */
export function siteLabelFor(destination: string, goal: string): string | null {
  const name = destination.trim()
  if (name.length < 2 || name.length > 60 || /https?:|\//u.test(name)) return null
  const words = name.split(/\s+/u).filter(word => !generic.has(word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')))
  if (!words.length) return null
  // The name must be the person's words: whole words of the request, spelled as a proper name there.
  const escaped = words.join(' ').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+')
  const occurrence = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').exec(goal)
  // "StoreTwo.com" or "bigshop.com" in the request: the label is the host's own name.
  const host = /^([a-z0-9-]+)\.(?:[a-z]{2,3})(?:\.[a-z]{2})?$/iu.exec(name)
  if (host) return occurrence ? host[1]!.toLowerCase() : null
  if (!occurrence) return null
  // A proper name: every remaining word as the request writes it starts with a capital letter or a digit (A&B, XYZ, 24-7 Mart).
  const written = occurrence[0].split(/\s+/u).filter(word => !generic.has(word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')))
  if (!written.length || !written.every(word => /^[\p{Lu}\p{N}]/u.test(word))) return null
  const label = words.join('').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/gu, '')
  return label.length >= 2 && label.length <= 40 ? label : null
}

/** Resources the request names as sites, resolved to labels in request order. Mutates nothing. */
export function namedSiteLabels(resources: readonly WorkSurfaceResource[], goal: string): Array<{ resourceId: string; name: string; label: string }> {
  const seen = new Set<string>()
  const found = resources.flatMap(resource => {
    if (resource.url && resource.urlSource !== 'inferred') {
      // An address the request itself gives ("go to storetwo.com") resolves to its own host label.
      try {
        const label = new URL(resource.url).hostname.replace(/^(?:www\d*|m)\./u, '').split('.')[0]!.toLowerCase()
        return label.length >= 2 ? [{ resourceId: resource.id, name: resource.destination, label }] : []
      } catch { return [] }
    }
    // Otherwise the person's own words name the site. An inferred address never does: in testing, "Compare the
    // price of a product at Big Shop and Store Two" resolved only Store Two because Big Shop's resource carried an
    // inferred bigshop.com and was dropped, so the two-site plan never formed. The quoted words ("Big Shop") come
    // first; the router's descriptive destination ("Big Shop product listing for …") is the fallback.
    const name = [resource.sourceText, resource.destination].find(candidate => candidate?.trim() && siteLabelFor(candidate, goal))
    const label = name ? siteLabelFor(name, goal) : null
    return label ? [{ resourceId: resource.id, name: name!, label }] : []
  })
  return found.filter(entry => !seen.has(entry.label) && seen.add(entry.label))
    .sort((a, b) => indexIn(goal, a.name) - indexIn(goal, b.name))
}

function indexIn(goal: string, name: string): number {
  const index = goal.toLowerCase().indexOf(name.toLowerCase())
  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}

/** The named sites of a resolved intent, in request order. */
export function namedDestinationsForIntent(intent?: WorkSurfaceIntent | null): NamedDestination[] {
  if (intent?.version !== 3 || !namedSitesEnabled()) return []
  return (intent.namedSites ?? []).map(({ name, label }) => ({ name, label }))
}

/** The site label of a host: its registered name on a common public suffix
 * (www.bigshop.com, m.storetwo.com and sub.listings.com are bigshop, storetwo
 * and listings). A subdomain belongs to the site that owns the domain. */
export function hostSiteLabel(hostname: string): string | null {
  const labels = hostname.toLowerCase().replace(/\.$/u, '').split('.')
  if (labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label))) return null
  const two = labels.slice(-2).join('.')
  const registered = labels.length >= 3 && twoPartSuffix.has(two) ? labels.at(-3)! : oneLabelSuffix.has(labels.at(-1)!) ? labels.at(-2)! : null
  return registered ? registered.replace(/-/gu, '') : null
}

/** Read-only navigation to a named site's own origin: any path, a bounded query, no credentials, port or fragment. */
export function namedSiteDestinationCovered(url: URL, labels: readonly string[]): boolean {
  if (!labels.length || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false
  if (url.search.length > queryLimit) return false
  const label = hostSiteLabel(url.hostname)
  return label !== null && labels.includes(label)
}

/** Which named destination a page address belongs to, if any. */
export function destinationForUrl(url: string | null | undefined, destinations: readonly NamedDestination[]): NamedDestination | null {
  if (!url) return null
  try {
    const label = hostSiteLabel(new URL(url).hostname)
    return label ? destinations.find(destination => destination.label === label) ?? null : null
  } catch { return null }
}

/** The controller's line for the actor and the Thin loop: the named sites as separate objectives, in visiting order. */
export function namedDestinationsInstruction(destinations: ReadonlyArray<NamedDestination & { boundary?: { kind: string } | null }>): string {
  const listed = destinations.map((destination, index) => `${index + 1}. ${destination.name}${destination.boundary ? ` (recently stopped Carve with a ${destination.boundary.kind.replace(/_/gu, ' ')}; visit it after the others)` : ''}`).join('; ')
  return `The request names ${destinations.length} sites; each is its own objective with its own findings. Visit them in this order: ${listed}. Their own public pages are part of this task, so opening them needs no other approval. Keep each site's facts before leaving it${destinationTabsEnabled() ? ', and prefer opening each site in its own tab' : ''}. When one site stops at a boundary (access denied, a rate limit, a sign-in wall, or a human-verification check left for the person), go on to the next site instead of ending, and report per site what was found or what stopped it.`
}
