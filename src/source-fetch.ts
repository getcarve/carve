import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { publicCitationUrl } from './public-web.js'
import { htmlToText } from './source-text.js'
import { sha256 } from './util.js'

/** A public page a provider cited, read as anonymous text. No cookies,
 * credentials, browser profile or screen content: it is the same request
 * anyone could make, from this Mac, to a host that resolves only to public
 * addresses (checked at connect time, so a rebinding DNS answer cannot reach
 * a private network). Redirects are followed by hand and re-checked. */
export interface FetchedSource {
  url: string
  finalUrl: string
  status: number
  contentType: string
  text: string
  sha256: string
  fetchedAt: string
}

export class SourceFetchError extends Error {
  constructor(message: string, readonly reason: 'invalid_url' | 'private_address' | 'http_status' | 'unsupported_type' | 'too_large' | 'timeout' | 'network' | 'redirects') {
    super(message)
    this.name = 'SourceFetchError'
  }
}

export const sourceFetchLimits = { timeoutMs: 8_000, maxBytes: 3_000_000, maxRedirects: 4 } as const

const blocked = new BlockList()
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]] as const) blocked.addSubnet(network, prefix, 'ipv6')

export function publicAddress(address: string): boolean {
  const family = isIP(address)
  if (!family) return false
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(address)?.[1]
    if (mapped) return publicAddress(mapped)
    return !blocked.check(address, 'ipv6')
  }
  return !blocked.check(address, 'ipv4')
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
/** Connect-time resolution: every address the connection may use must be public. */
function publicOnlyLookup(hostname: string, options: { all?: boolean } & Record<string, unknown>, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, options.all ? [] : '', 0)
    const list = addresses as LookupAddress[]
    if (!list.length || list.some(entry => !publicAddress(entry.address))) {
      const failure = Object.assign(new Error('The source host resolves to a non-public address'), { code: 'CARVE_PRIVATE_ADDRESS' }) as NodeJS.ErrnoException
      return callback(failure, options.all ? [] : '', 0)
    }
    if (options.all) return callback(null, list)
    callback(null, list[0]!.address, list[0]!.family)
  })
}

function once(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET', signal, lookup: publicOnlyLookup as never,
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 Carve-source-check/1',
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
        'accept-language': 'en-US,en;q=0.9', 'accept-encoding': 'gzip, deflate, br',
      },
    }, resolve)
    request.on('error', reject)
    request.end()
  })
}

export async function fetchPublicSource(value: string, parentSignal?: AbortSignal): Promise<FetchedSource> {
  const accepted = publicCitationUrl(value)
  if (!accepted) throw new SourceFetchError('The cited address is not a public web page', 'invalid_url')
  const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(sourceFetchLimits.timeoutMs)]) : AbortSignal.timeout(sourceFetchLimits.timeoutMs)
  let url = new URL(accepted)
  url.hash = ''
  try {
    for (let redirects = 0; ; redirects++) {
      const response = await once(url, signal)
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        if (redirects >= sourceFetchLimits.maxRedirects) throw new SourceFetchError('The source redirected too many times', 'redirects')
        const next = publicCitationUrl(new URL(response.headers.location, url).href)
        if (!next) throw new SourceFetchError('The source redirected to a non-public address', 'invalid_url')
        url = new URL(next)
        continue
      }
      if (status < 200 || status >= 300) { response.resume(); throw new SourceFetchError(`The source returned HTTP ${status}`, 'http_status') }
      const contentType = String(response.headers['content-type'] ?? '').toLowerCase()
      if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/u.test(contentType)) { response.resume(); throw new SourceFetchError(`The source is ${contentType.split(';')[0]}, not a web page`, 'unsupported_type') }
      const declared = Number(response.headers['content-length'] ?? 0)
      if (declared > sourceFetchLimits.maxBytes * 4) { response.resume(); throw new SourceFetchError('The source page is too large to check', 'too_large') }
      const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase()
      const stream = encoding === 'gzip' ? response.pipe(createGunzip()) : encoding === 'br' ? response.pipe(createBrotliDecompress()) : encoding === 'deflate' ? response.pipe(createInflate()) : response
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        length += chunk.byteLength
        if (length > sourceFetchLimits.maxBytes) { response.destroy(); break }
        chunks.push(chunk)
      }
      const body = Buffer.concat(chunks).toString('utf8')
      // A redirect page (<meta http-equiv="refresh" content="0; url=…">) is followed like an HTTP redirect.
      const refresh = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']?\s*\d+\s*;\s*url=([^"'>\s]+)/iu.exec(body.slice(0, 20_000))?.[1]
      if (refresh && body.length < 20_000 && redirects < sourceFetchLimits.maxRedirects) {
        const next = publicCitationUrl(new URL(refresh, url).href)
        if (next) { url = new URL(next); continue }
      }
      const text = contentType.includes('text/plain') ? body.replace(/\s+\n/gu, '\n').slice(0, 400_000) : htmlToText(body)
      return { url: accepted, finalUrl: url.href, status, contentType: contentType.split(';')[0] ?? '', text, sha256: sha256(text), fetchedAt: new Date().toISOString() }
    }
  } catch (error) {
    if (error instanceof SourceFetchError) throw error
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'CARVE_PRIVATE_ADDRESS') throw new SourceFetchError('The source host resolves to a non-public address', 'private_address')
    if (signal.aborted) throw new SourceFetchError('The source did not respond in time', 'timeout')
    throw new SourceFetchError('The source could not be opened', 'network')
  }
}
