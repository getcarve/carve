import type { MemoryResourceOccurrence, MemoryResourceRecord, MemoryResourceType } from './types.js'
import type { RecallMoment } from './recall.js'
import { sha256, tokenize } from './util.js'

export interface MemoryResourceProjection {
  resource: MemoryResourceRecord
  occurrence: MemoryResourceOccurrence
}

const browserApplication = /(?:chrome|safari|firefox|edge|browser|webkit)/iu
const messageApplication = /(?:mail|gmail|outlook|slack|teams|messages)/iu
const documentSuffix = /\.(?:pdf|docx?|xlsx?|pptx?|txt|md|csv)\b/iu

/**
 * Turns a noisy screen moment into a stable resource identity. Extractors are
 * deliberately generic: a product/domain is data, never a branch in planning.
 */
export function projectMemoryResource(moment: RecallMoment): MemoryResourceProjection {
  const structured = normalizeWebUrl(moment.url ?? '')
  const recognized = structured ? null : extractRecognizedUrl(`${moment.title}\n${moment.body}`)
  const canonicalUrl = structured ?? recognized
  const type = resourceType(moment, canonicalUrl)
  const title = cleanTitle(moment.title, moment.app)
  const canonicalKey = canonicalUrl
    ? `${type}:url:${canonicalUrl}`
    : `${type}:title:${normalizeIdentity(title)}:app:${normalizeIdentity(moment.app)}`
  const domain = canonicalUrl ? safeDomain(canonicalUrl) : null
  const aliases = resourceAliases(title, canonicalUrl, domain)
  const id = `resource_${sha256(canonicalKey).slice(0, 24)}`
  const extractionMethod: MemoryResourceOccurrence['extractionMethod'] = structured
    ? 'structured_url'
    : recognized
      ? 'recognized_url'
      : 'title_identity'
  const confidence = structured ? 1 : recognized ? 0.82 : title && title !== moment.app ? 0.66 : 0.45
  return {
    resource: {
      id,
      type,
      canonicalKey,
      title,
      canonicalUrl,
      domain,
      aliases,
      firstSeenAt: moment.occurredAt,
      lastSeenAt: moment.occurredAt,
      occurrenceCount: 1,
    },
    occurrence: {
      resourceId: id,
      momentId: moment.momentId,
      sessionId: moment.sessionId,
      occurredAt: moment.occurredAt,
      extractionMethod,
      confidence,
    },
  }
}

function resourceType(moment: RecallMoment, url: string | null): MemoryResourceType {
  if (url || browserApplication.test(moment.app)) return 'web_page'
  if (messageApplication.test(moment.app)) return 'message'
  if (documentSuffix.test(moment.title) || documentSuffix.test(moment.body)) return 'document'
  return 'application_state'
}

function cleanTitle(title: string, app: string): string {
  const compact = title.trim().replace(/\s+/gu, ' ')
  if (!compact || /^\[?untitled(?: window)?\]?$/iu.test(compact)) return app.trim() || 'Unknown resource'
  return compact
}

function normalizeIdentity(value: string): string {
  return tokenize(value).join('-') || 'unknown'
}

function extractRecognizedUrl(text: string): string | null {
  const candidates = text.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[a-z0-9_~:/?#@!$&'()*+,;=.%-]*)?/giu) ?? []
  for (const candidate of candidates) {
    // A filename is not a URL merely because its extension is syntactically a
    // valid DNS label. Paths and explicit schemes remain eligible.
    if (!/^https?:\/\//iu.test(candidate) && !candidate.includes('/') && documentSuffix.test(candidate)) continue
    const normalized = normalizeWebUrl(candidate)
    if (normalized) return normalized
  }
  return null
}

function normalizeWebUrl(value: string): string | null {
  const trimmed = value.trim().replace(/^[^a-z0-9]+/iu, '').replace(/[),.;:'"\]}]+$/gu, '')
  if (!trimmed || !trimmed.includes('.')) return null
  try {
    const parsed = new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`)
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) return null
    parsed.hash = ''
    for (const key of [...parsed.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid)/iu.test(key)) parsed.searchParams.delete(key)
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./u, '')
    if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/u, '')
    return parsed.toString()
  } catch {
    return null
  }
}

function safeDomain(url: string): string | null {
  try { return new URL(url).hostname } catch { return null }
}

function resourceAliases(title: string, url: string | null, domain: string | null): string[] {
  const aliases = new Set<string>()
  if (title) aliases.add(title)
  if (domain) {
    aliases.add(domain)
    for (const label of domain.split('.')) if (label.length > 2) aliases.add(label)
  }
  if (url) {
    try {
      const parsed = new URL(url)
      const path = decodeURIComponent(parsed.pathname).replace(/[_/-]+/gu, ' ').trim()
      if (path) aliases.add(path)
    } catch {
      // The URL was already validated; aliases are optional derived data.
    }
  }
  return [...aliases]
}
