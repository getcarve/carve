import { isIP } from 'node:net'
import type { ProviderTokenUsage } from './providers/types.js'
import type { SourceSupportReceipt } from './source-support.js'

/** Fixed first-release envelope. This is a public provider search, not a local
 * HTTP client and not authority to use cookies, screenshots or recalled data. */
export const publicLookupLimits = {
  queryCharacters: 2_000,
  toolCalls: 3,
  outputTokens: 3_000,
  timeoutMs: 60_000,
  responseBytes: 1_000_000,
} as const

export interface PublicSearchRequest {
  query: string
  asOf: string
  model: string
  signal: AbortSignal
}

export interface PublicWebCitation {
  url: string
  title: string
  start: number
  end: number
}

export interface PublicLookupEvidence {
  version: 1
  method: 'public_web'
  query: string
  asOf: string
  retrievedAt: string
  providerId: string
  model: string
  responseId: string | null
  answer: string
  citations: PublicWebCitation[]
  /** `provider_citations_checked`: annotation integrity only. The others record
   * the source-support check (source-support.ts): every material claim quoted
   * from the fetched page, an answer rewritten to what the page supports, or
   * an answer that could not be checked and says so. */
  verification: 'provider_citations_checked' | 'source_supported' | 'source_revised' | 'source_unconfirmed'
  support?: SourceSupportReceipt
  toolCalls: number
  searchCalls: number
  serviceTier?: string | null
  usage: ProviderTokenUsage
}

export class PublicSearchError extends Error {
  constructor(message: string, readonly usage: ProviderTokenUsage = { inputTokens: null, outputTokens: null }, readonly toolCalls: number | null = null, readonly searchCalls: number | null = null, readonly serviceTier: string | null = null, readonly responseId: string | null = null) {
    super(message)
    this.name = 'PublicSearchError'
  }
}

/** Explicit override that bypasses automatic method inference. The caller
 * must still enforce public-only request scope and its execution contract. */
export function explicitPublicLookupQuery(goal: string): string | null {
  return /^(?:search|look up) (?:the )?public web(?: for|:)\s+(.+)$/isu.exec(goal.trim())?.[1]?.trim() ?? null
}

export function validatePublicSearchRequest(request: Pick<PublicSearchRequest, 'query' | 'asOf' | 'model'>): void {
  if (!request.query.trim() || request.query.length > publicLookupLimits.queryCharacters) throw new Error('Public lookup requires a query of 1–2000 characters')
  if (!request.model.trim() || request.model.length > 200) throw new Error('Public lookup requires an explicit model')
  if (!Number.isFinite(Date.parse(request.asOf))) throw new Error('Public lookup requires an explicit date')
}

/** Link acceptance only, never an SSRF/network authorization check. Carve does
 * not fetch these URLs. A future local web.read must also validate DNS/redirects. */
export function publicCitationUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4_096) return null
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase().replace(/\.$/u, '')
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port
      || !host.includes('.') || isIP(host) || host.startsWith('[')
      || /(?:^|\.)(?:localhost|local|internal|invalid|test|example|onion)$/u.test(host)) return null
    return url.href
  } catch { return null }
}
