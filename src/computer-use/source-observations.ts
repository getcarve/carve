import type { LiveComputerCapturedFrame } from '../live-computer.js'
import type { LiveComputerElement } from '../types.js'
import { isBrowserLocationField } from './effects.js'

/** Source text is observed data, never current control geometry or authority. */
export function sourceElementVisible(element: LiveComputerElement, frame: LiveComputerCapturedFrame): boolean {
  const b = element.bounds, c = frame.contentBounds ?? { x: 0, y: 0, width: frame.width, height: frame.height }
  return !element.sensitive && !element.obstructed && !!b
    && b.x < c.x + c.width && b.x + b.width > c.x && b.y < c.y + c.height && b.y + b.height > c.y
}

export function sourceElementText(element: LiveComputerElement): string[] {
  const name = element.name?.trim(), rawValue = element.value?.trim()
  const value = rawValue ? rawValue + (element.valueComplete === false ? ' [incomplete value]' : '') : rawValue
  if (value && name && value.startsWith(name) && !element.editable) return [value]
  if (value && name && (element.editable || /text(field|area)|combobox/iu.test(element.role))) {
    return [`${name}: ${value}`]
  }
  return [...new Set([name, value].filter((v): v is string => !!v))]
}

/** The document an observation was read from: the address the browser itself
 * showed (never one typed into a focused address bar) and the page title.
 * This is provenance for facts, not authority to act; a link cited for a
 * fact must be the address shown while that fact was on screen, not an
 * image, manifest or API address that merely contains a similar identifier.
 * `schemeShown: false` marks an address whose scheme the browser hid (Chrome
 * shows "127.0.0.1:4488/d/doc/page" for an http:// page): `url` then
 * carries https:// only so it parses for matching, and every record of it
 * uses `sourceAddress`, which never writes the guessed scheme. */
export interface SourceDocument { url: string | null; title: string | null; schemeShown?: false }

/** The loaded address comes from the web area's AXURL, not the address bar's elided text (in testing: every saved
 * link read https:// for an http:// page). `STEWARD_SOURCE_ADDRESS_SCHEME=off` restores the address-bar-only reading
 * and the https:// guess in records. */
export const sourceAddressSchemeEnabled = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_SOURCE_ADDRESS_SCHEME?.trim().toLowerCase() !== 'off'

function normalizedAddress(candidate: string): string | null {
  try {
    const parsed = new URL(candidate)
    if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) return null
    parsed.hash = ''
    return parsed.toString()
  } catch { return null }
}

/** `STEWARD_LOADED_ADDRESS_SCHEME=off`: a scheme the address bar hid is never recovered from the page's own address. */
export const loadedAddressSchemeEnabled = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_LOADED_ADDRESS_SCHEME?.trim().toLowerCase() !== 'off'

/** Addresses pages reported for themselves (the web area's AXURL, read with the page text by the input bridge), keyed
 * by the address without its scheme. Chrome's address bar shows "127.0.0.1:4488/d/doc/page" for an http:// page;
 * until the helper reports AXURL with each frame (deferred: a rebuilt helper needs a permission re-grant), the page
 * text read is where the loaded scheme is known. In one run, saved text files still linked https:// for
 * http:// pages because the guessed https:// reached the model in pageText.source and in the actor's evidence log. */
const loadedAddresses = new Map<string, string>()
const LOADED_ADDRESS_LIMIT = 500

function schemelessKey(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    parsed.hash = ''
    return parsed.toString().replace(/^https?:\/\//iu, '').replace(/\/$/u, '')
  } catch { return null }
}

/** Remember the address a page reported for itself (http or https only). */
export function learnLoadedAddress(url: string | null | undefined): void {
  if (!url || !loadedAddressSchemeEnabled()) return
  const loaded = normalizedAddress(url)
  const key = loaded ? schemelessKey(loaded) : null
  if (!loaded || !key || !/^https?:/iu.test(loaded)) return
  loadedAddresses.delete(key)
  loadedAddresses.set(key, loaded)
  while (loadedAddresses.size > LOADED_ADDRESS_LIMIT) loadedAddresses.delete(loadedAddresses.keys().next().value!)
}

/** The loaded address of a page shown without its scheme, when that page reported it. */
export function loadedAddressFor(shown: string | null | undefined): string | null {
  if (!shown || !loadedAddressSchemeEnabled() || !sourceAddressSchemeEnabled()) return null
  const key = schemelessKey(/^[a-z][a-z0-9+.-]*:\/\//iu.test(shown) ? shown : `https://${shown}`)
  return key ? loadedAddresses.get(key) ?? null : null
}

/** For tests: forget every learned address. */
export function forgetLoadedAddresses(): void { loadedAddresses.clear() }

export function sourceDocumentOf(frame: Pick<LiveComputerCapturedFrame, 'elements'>): SourceDocument {
  const areas = frame.elements.filter(e => e.role === 'AXWebArea' && e.bounds)
    .sort((a, b) => b.bounds!.width * b.bounds!.height - a.bounds!.width * a.bounds!.height)
  const area = areas.find(e => e.name?.trim())
  const title = area?.name.trim().slice(0, 200) ?? null
  const loaded = sourceAddressSchemeEnabled() ? areas.find(e => e.url)?.url : undefined
  const loadedUrl = loaded ? normalizedAddress(loaded) : null
  if (loadedUrl) return { url: loadedUrl, title }
  const address = frame.elements.find(e => isBrowserLocationField(e) && e.focused !== true && e.containsFocus !== true && !e.sensitive && e.value?.trim())
  const raw = address?.value?.trim() ?? ''
  const schemed = /^[a-z][a-z0-9+.-]*:\/\//iu.test(raw)
  const candidate = schemed ? raw : /^[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:[/?#]|$)/u.test(raw) ? `https://${raw}` : null
  const url = candidate ? normalizedAddress(candidate) : null
  const loadedShown = url && !schemed ? loadedAddressFor(url) : null
  if (loadedShown) return { url: loadedShown, title }
  return { url, title, ...(url && !schemed && sourceAddressSchemeEnabled() ? { schemeShown: false as const } : {}) }
}

/** A source as it may be written into a prompt or record: its address from `sourceAddress`, never a guessed scheme. */
export function publicSource(source: Pick<SourceDocument, 'url' | 'title' | 'schemeShown'> | null | undefined): { url: string | null; title: string | null } | null {
  return source ? { url: sourceAddress(source), title: source.title } : null
}

/** The address to write into a record, a prompt or a document: the loaded URL, or, when the browser hid the scheme,
 * the address as shown (without a scheme), never an invented https://. */
export function sourceAddress(source: Pick<SourceDocument, 'url' | 'schemeShown'> | null | undefined): string | null {
  if (!source?.url) return null
  return source.schemeShown === false ? loadedAddressFor(source.url) ?? source.url.replace(/^https:\/\//iu, '') : source.url
}

/** Same document, same key. A window with neither an address nor a web area
 * (a native app) is one source, as before. */
export function sourceDocumentKey(source: SourceDocument | null | undefined): string {
  return source?.url ?? (source?.title ? `title:${source.title}` : 'window')
}

/** Keep a line unless the same line already followed the same line in this
 * document. Deduplicating bare lines broke label–value pairs: on a product
 * page whose "Price (excl. tax)" and "Price (incl. tax)" are both £51.77, the
 * second £51.77 vanished and the included-tax price read as unstated (books
 * test). `seen` holds pair keys and is updated. */
export function dedupeInContext(lines: readonly string[], seen: Set<string>): string[] {
  const kept: string[] = []
  let previous = ''
  for (const line of lines) {
    const key = `${previous}\u0001${line}`
    previous = line
    if (!line.trim() || seen.has(key)) continue
    seen.add(key)
    kept.push(line)
  }
  return kept
}

export interface SourceHistoryEntry { frameId: string; text: string; source?: SourceDocument | null }

/** Control-state lines in retained evidence (in testing: 41% of its characters, and 93% of them repeat the label on the
 * line above with every state false). A true state is kept as "name [checked]"; an all-false line that repeats the
 * line above is dropped; any other all-false line is kept as "name [not checked]". The recorded source is unchanged:
 * this applies only where retained evidence enters a prompt. `STEWARD_RETAINED_CONTROL_LINES=full` restores them. */
export const retainedControlLinesCompact = () => process.env.STEWARD_RETAINED_CONTROL_LINES?.trim() !== 'full'
export function compactControlStateLines(lines: readonly string[]): string[] {
  const kept: string[] = []
  for (const line of lines) {
    if (!line.startsWith('{"control":')) { kept.push(line); continue }
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(line) as Record<string, unknown> } catch { kept.push(line); continue }
    const name = typeof parsed.control === 'string' ? parsed.control : ''
    const states = ['checked', 'selected', 'expanded'].filter(key => typeof parsed[key] === 'boolean')
    const on = states.filter(key => parsed[key] === true)
    if (on.length) kept.push(`${name} [${on.join(', ')}]`)
    else if (kept.at(-1)?.trim() !== name.trim()) kept.push(`${name} [not ${states.join(', not ')}]`)
  }
  return kept
}

/**
 * Bound retained page text without detaching facts from the page they came
 * from. Repeated lines used to be removed across the whole run
 * and against the current page, so a painting's "Oil on canvas" vanished once
 * another painting showed the same medium, and its answer said "not stated".
 * Lines now repeat freely across documents and are removed only when the same
 * document already contributed them (a newer frame of it, or the current
 * page when it is that document). Under a small budget every document keeps a
 * share before newer frames take the rest, so an early detail page is not
 * evicted wholesale by a later listing page. Output stays chronological and
 * carries each entry's source for provenance; it is untrusted page data.
 */
export function compactSourceHistory(entries: SourceHistoryEntry[], maxCharacters = 24_000, currentTexts: string[] = [], currentSource: SourceDocument | null = null) {
  const currentKey = sourceDocumentKey(currentSource)
  const seen = new Map<string, Set<string>>()
  const seenFor = (key: string) => { let set = seen.get(key); if (!set) seen.set(key, set = new Set()); return set }
  for (const text of currentTexts) dedupeInContext(text.split('\n'), seenFor(currentKey))
  const candidates: Array<{ index: number; key: string; entry: SourceHistoryEntry; lines: string[] }> = []
  entries.forEach((entry, index) => candidates.push({ index, key: sourceDocumentKey(entry.source), entry, lines: [] }))
  for (const candidate of [...candidates].reverse()) {
    candidate.lines = dedupeInContext(candidate.entry.text.split('\n'), seenFor(candidate.key))
    if (retainedControlLinesCompact()) candidate.lines = compactControlStateLines(candidate.lines)
  }
  const live = candidates.filter(c => c.lines.length)
  const budgets = new Map<number, number>()
  let remaining = Math.max(0, maxCharacters)
  const take = (candidate: typeof live[number], limit: number) => {
    const already = budgets.get(candidate.index) ?? 0
    const full = candidate.lines.join('\n').length
    const extra = Math.max(0, Math.min(limit, full - already, remaining))
    if (extra > 0) { budgets.set(candidate.index, already + extra); remaining -= extra }
  }
  // First pass: a fair share per document, newest frames of each first.
  const documents = [...new Set([...live].reverse().map(c => c.key))]
  const share = documents.length ? Math.floor(remaining / documents.length) : 0
  for (const key of documents) {
    let quota = share
    for (const candidate of [...live].reverse().filter(c => c.key === key)) {
      if (quota <= 0 || remaining <= 0) break
      const before = remaining
      take(candidate, quota)
      quota -= before - remaining
    }
  }
  // Second pass: whatever is left goes to the newest frames.
  for (const candidate of [...live].reverse()) { if (remaining <= 0) break; take(candidate, remaining) }
  return live.filter(c => (budgets.get(c.index) ?? 0) > 0).map(c => ({
    frameId: c.entry.frameId,
    ...(c.entry.source && (c.entry.source.url || c.entry.source.title) ? { source: { url: sourceAddress(c.entry.source), title: c.entry.source.title } } : {}),
    text: c.lines.join('\n').slice(0, budgets.get(c.index)!),
  }))
}

const excerptStopwords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'this', 'that', 'with', 'from', 'what', 'which', 'when', 'where', 'who', 'how', 'does', 'did', 'say', 'says', 'tell', 'page', 'site', 'find', 'give', 'show', 'about', 'then', 'there', 'their', 'them', 'they', 'also', 'into', 'than', 'its', 'it’s', 'please', 'me', 'my'])

/** Lowercased word forms with a light plural/verb-suffix fold ("bees" → "bee",
 * "feeding" → "feed"). A deliberate simple stemmer, not a linguistic one. */
function excerptTerms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? [])
    .filter(word => word.length >= 3 && !excerptStopwords.has(word))
    .map(word => word.replace(/(?:ies)$/u, 'y').replace(/(?:ing|ed|es|s)$/u, '') || word)
}

/**
 * A bounded excerpt of a whole page read, for a page the run has left: its lead,
 * then the passages most relevant to the request by BM25 (k1 1.2, b 0.75) over
 * ~600-character passages, then the passages that follow the lead, emitted in
 * page order with gaps marked. Pages that fit are returned whole.
 *
 * Why: a run read a honey-bee article (40k characters), went to
 * a store for the second half of the request, and the article's text left every
 * later prompt; only its first screen survived, and the diet paragraph was not
 * on it. The verifier then rejected the right answer as unsupported.
 *
 * Lexical ranking cannot bridge "feed" to "nectarivorous", so `pinned` carries
 * the actor's own verbatim findings from this page (quotes the controller has
 * already found in it): the passages holding them are kept right after the lead.
 */
export function relevantPageExcerpt(text: string, query: string, maxCharacters: number, pinned: readonly string[] = []): string {
  if (text.length <= maxCharacters) return text
  const passages: string[] = []
  let current = ''
  for (const line of text.split(/\n+/u).map(part => part.trim()).filter(Boolean)) {
    if (current && current.length + line.length + 1 > 600) { passages.push(current); current = '' }
    current = current ? `${current}\n${line}` : line
  }
  if (current) passages.push(current)
  const queryTerms = [...new Set(excerptTerms(query))]
  const passageTerms = passages.map(excerptTerms)
  const averageLength = passageTerms.reduce((n, terms) => n + terms.length, 0) / Math.max(1, passageTerms.length)
  const documentFrequency = new Map<string, number>()
  for (const terms of passageTerms) for (const term of new Set(terms)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
  const scores = passageTerms.map(terms => {
    let score = 0
    for (const term of queryTerms) {
      const frequency = terms.filter(t => t === term).length
      if (!frequency) continue
      const df = documentFrequency.get(term) ?? 0
      const idf = Math.log(1 + (passages.length - df + 0.5) / (df + 0.5))
      score += idf * (frequency * 2.2) / (frequency + 1.2 * (0.25 + 0.75 * terms.length / Math.max(1, averageLength)))
    }
    return score
  })
  const chosen = new Set<number>()
  let used = 0
  const choose = (index: number) => {
    if (chosen.has(index) || used + passages[index]!.length + 3 > maxCharacters) return false
    chosen.add(index); used += passages[index]!.length + 3
    return true
  }
  const leadBudget = Math.min(4_000, Math.floor(maxCharacters * 0.4))
  for (let index = 0; index < passages.length && used < leadBudget; index++) if (!choose(index)) break
  const flat = (value: string) => value.replace(/\s+/gu, ' ').trim().toLowerCase()
  const flatPassages = passages.map(flat)
  for (const pin of pinned.map(flat).filter(value => value.length >= 12)) {
    const at = flatPassages.findIndex(passage => passage.includes(pin))
    if (at >= 0) { choose(at); continue }
    // A quote across a passage boundary keeps both passages.
    const pair = flatPassages.findIndex((passage, index) => index + 1 < flatPassages.length && `${passage} ${flatPassages[index + 1]}`.includes(pin))
    if (pair >= 0) { choose(pair); choose(pair + 1) }
  }
  for (const index of passages.map((_, i) => i).filter(i => scores[i]! > 0).sort((a, b) => scores[b]! - scores[a]! || a - b)) choose(index)
  for (let index = 0; index < passages.length && used < maxCharacters; index++) choose(index)
  const ordered = [...chosen].sort((a, b) => a - b)
  return ordered.map((index, position) => (position > 0 && ordered[position - 1] !== index - 1 ? '…\n' : '') + passages[index]).join('\n')
}
