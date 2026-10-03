import { claimSpecifics, type Specific, specificPresent } from './claim-specifics.js'

/** Where a quoted passage sits on a page, and what its values are labelled.
 *
 * The source check (source-support.ts) accepts a model's "supported" verdict only
 * when its quote is on the page and holds the claimed value. Until 27 September
 * that was all the code checked: a quote stitched from pieces anywhere on the
 * page passed (pieces under 8 characters were dropped unseen), and whether the
 * value's column meant what the claim said was left to the model's reading of the
 * prompt. On campaign-42 f-node16-eol r2 the cited release table's "Last
 * updated" date became an end-of-life date.
 *
 * Here, deterministically and from the page text source-text.ts writes (one
 * table row per line, each cell "Header: value"):
 * - a quote's pieces must co-locate: within a few adjacent lines, or one table row
 *   plus the lines introducing its table; never two different rows of a table;
 * - short pieces are matched inside that region instead of being dropped;
 * - a value taken from a labelled cell must sit under a label that means what the
 *   claim says (a "Last updated" date is not an end-of-life date); a value from
 *   prose or an unlabelled cell needs the claim's predicate (end of life,
 *   released, latest, LTS…) in the region around the quote.
 * `STEWARD_QUOTE_COLOCATION=off` and `STEWARD_FIELD_CHECK=off` turn these off. */

export const quoteColocationEnabled = () => process.env.STEWARD_QUOTE_COLOCATION?.trim().toLowerCase() !== 'off'
export const fieldCheckEnabled = () => process.env.STEWARD_FIELD_CHECK?.trim().toLowerCase() !== 'off'

export const normalizeSourceText = (text: string) => text.toLowerCase().replace(/[‘’`]/gu, "'").replace(/[“”]/gu, '"').replace(/[‐‑‒–—]/gu, '-').replace(/\s+/gu, ' ').trim()

/** Lines apart that pieces of one quote may be: the quoted line, and one line either side of another. */
const adjacentLines = 2
/** Lines above a table that may introduce it (a heading, a sentence saying what the table lists). */
const tableContextLines = 3
/** A piece at least this long is located by itself; a shorter one only inside the region the others fix. */
const anchorLength = 8

export interface PageIndex {
  lines: string[]
  /** Normalized lines joined by single spaces. */
  joined: string
  /** Offset in `joined` where each line starts. */
  starts: number[]
  /** Table-row lines, by line index, with the row's block (first line index). */
  rows: Map<number, number>
}

/** A table row as source-text writes it: at least two "Header: value" cells (a page title "Name: subtitle | Site" is not one). */
export function tableRowLine(line: string): boolean {
  return line.split(' | ').filter(cell => /^[^:|]{1,60}: \S/u.test(cell.trim())).length >= 2
}

export function pageIndex(text: string): PageIndex {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const starts: number[] = []
  let joined = ''
  for (const line of lines) {
    if (joined) joined += ' '
    starts.push(joined.length)
    joined += normalizeSourceText(line)
  }
  const rows = new Map<number, number>()
  let block = -1
  lines.forEach((line, index) => {
    if (!tableRowLine(line)) { block = -1; return }
    if (block < 0) block = index
    rows.set(index, block)
  })
  return { lines, joined, starts, rows }
}

const lineAt = (index: PageIndex, offset: number) => {
  let low = 0, high = index.starts.length - 1
  while (low < high) { const mid = (low + high + 1) >> 1; if (index.starts[mid]! <= offset) low = mid; else high = mid - 1 }
  return low
}

/** Every place `piece` occurs, as the first and last line it covers. */
function occurrences(index: PageIndex, piece: string, limit = 40): Array<[number, number]> {
  const found: Array<[number, number]> = []
  let at = index.joined.indexOf(piece)
  while (at >= 0 && found.length < limit) {
    found.push([lineAt(index, at), lineAt(index, at + piece.length - 1)])
    at = index.joined.indexOf(piece, at + 1)
  }
  return found
}

export interface QuoteLocation {
  found: boolean
  /** Why a quote whose words are on the page is still not accepted. */
  reason?: 'not_found' | 'not_colocated' | 'rows_stitched'
  /** The page lines the quote was read from, in order. */
  lines: number[]
}

function colocated(index: PageIndex, spans: Array<[number, number]>): { ok: boolean; reason?: 'not_colocated' | 'rows_stitched' } {
  const lines = [...new Set(spans.flatMap(([first, last]) => Array.from({ length: last - first + 1 }, (_, offset) => first + offset)))].sort((a, b) => a - b)
  const rows = lines.filter(line => index.rows.has(line))
  // Pieces from two different rows of a table are a new row the page does not have, unless the
  // quote reads them as one contiguous passage (checked before pieces are located).
  const pieceRows = new Set(spans.flatMap(([first, last]) => first === last && index.rows.has(first) ? [first] : []))
  if (pieceRows.size >= 2) return { ok: false, reason: 'rows_stitched' }
  const first = lines[0]!, last = lines.at(-1)!
  if (last - first <= adjacentLines) return { ok: true }
  // One row plus the lines that introduce its table ("This page lists the end of life date for each branch").
  if (rows.length === 1) {
    const block = index.rows.get(rows[0]!)!
    if (lines.every(line => line === rows[0] || (line < block && line >= block - tableContextLines && !index.rows.has(line)))) return { ok: true }
  }
  return { ok: false, reason: 'not_colocated' }
}

/** Where `quote` is on the page. A verbatim passage is found as is; a quote the model joined from separate lines
 * or marked with a gap ("…") is found only when its pieces co-locate. */
export function locateQuote(quote: string, index: PageIndex): QuoteLocation {
  const whole = normalizeSourceText(quote)
  if (!whole) return { found: false, reason: 'not_found', lines: [] }
  const exact = occurrences(index, whole, 1)[0]
  if (exact) return { found: true, lines: Array.from({ length: exact[1] - exact[0] + 1 }, (_, offset) => exact[0] + offset) }
  const pieces = quote.split(/\n|…|\.\.\./u).map(normalizeSourceText).filter(Boolean)
  if (pieces.length < 2) return { found: false, reason: 'not_found', lines: [] }
  const located = pieces.map(piece => ({ piece, places: occurrences(index, piece) }))
  if (located.some(entry => !entry.places.length)) return { found: false, reason: 'not_found', lines: [] }
  const anchors = located.filter(entry => entry.piece.length >= anchorLength)
  const seeds = (anchors.length ? anchors : located)[0]!.places
  let best: { spans: Array<[number, number]>; width: number } | null = null
  let reason: 'not_colocated' | 'rows_stitched' = 'not_colocated'
  for (const seed of seeds) {
    // Each other piece at its occurrence nearest the seed; short pieces must fall inside the region.
    const spans = located.map(entry => entry.places.reduce((nearest, place) => Math.abs(place[0] - seed[0]) < Math.abs(nearest[0] - seed[0]) ? place : nearest))
    const verdict = colocated(index, spans)
    if (!verdict.ok) { if (verdict.reason === 'rows_stitched') reason = 'rows_stitched'; continue }
    const width = Math.max(...spans.map(span => span[1])) - Math.min(...spans.map(span => span[0]))
    if (!best || width < best.width) best = { spans, width }
  }
  if (!best) return { found: false, reason, lines: [] }
  return { found: true, lines: [...new Set(best.spans.flatMap(([first, last]) => Array.from({ length: last - first + 1 }, (_, offset) => first + offset)))].sort((a, b) => a - b) }
}

/** The text around a located quote: its lines, one line either side, and the lines introducing its table. */
export function quoteRegion(index: PageIndex, lines: number[], around = 1): string {
  if (!lines.length) return ''
  const chosen = new Set<number>()
  for (const line of lines) for (let offset = -around; offset <= around; offset++) if (line + offset >= 0 && line + offset < index.lines.length) chosen.add(line + offset)
  for (const line of lines) {
    const block = index.rows.get(line)
    if (block === undefined) continue
    for (let context = block - 1; context >= Math.max(0, block - tableContextLines) && !index.rows.has(context); context--) chosen.add(context)
  }
  return [...chosen].sort((a, b) => a - b).map(line => index.lines[line]!).join('\n')
}

/** Where a claim's identifiers (versions, release numbers) may be named for a quote read from table rows: the rows'
 * value cells (not a free-text note such as "A guide is available for migrating from PHP 8.1 to 8.2"), the lines
 * introducing the table, and the page title. A neighbouring row names a different entity. */
export function rowIdentifierPlaces(index: PageIndex, lines: number[]): string {
  const rows = lines.filter(line => index.rows.has(line))
  const cells = rows.map(line => index.lines[line]!.split(' | ').filter(cell => !(cell.length > 40 && cell.trim().split(/\s+/u).length >= 6)).join(' | '))
  const context = new Set<number>()
  for (const line of rows) for (let above = index.rows.get(line)! - 1; above >= Math.max(0, index.rows.get(line)! - tableContextLines) && !index.rows.has(above); above--) context.add(above)
  for (const line of lines) if (!index.rows.has(line)) context.add(line)
  return [...cells, ...[...context].sort((a, b) => a - b).map(line => index.lines[line]!), pageHead(index)].join('\n')
}

/** The first lines of a page: its title and main heading, which name what the whole page is about. */
export const pageHead = (index: PageIndex, count = 3) => index.lines.slice(0, count).join('\n')

// ---------------------------------------------------------------------------
// What a claim asserts, and what a page label means.

/** Predicate classes: a label or passage that means one of these can support a claim that asserts it. */
const predicates: Array<{ name: string; pattern: RegExp }> = [
  { name: 'end_of_life', pattern: /\b(?:end[\s-]+of[\s-]+(?:life|(?:[\w-]+[\s-]+){0,4}support|(?:[\w-]+[\s-]+){0,2}(?:maintenance|updates?))|eol|support(?:\s+[\w-]+){0,2}\s+(?:ends?|ended|expires?|expired|until|through)|(?:ends?|ended|stops?|stopped|expires?|expired)\s+(?:[\w-]+\s+){0,3}(?:support|maintenance|updates?)|unsupported|no longer (?:supported|maintained|receiv\w+)|sunset\w*|retire[sd]?|retirement|discontinu\w+|end date|reach(?:es|ed)?\s+(?:its\s+)?end\b|supported (?:until|through)|security (?:support|fixes) (?:until|through))/iu },
  { name: 'released', pattern: /\b(?:releas(?:e|ed|es|ing)|release date|launch(?:ed|es)?|first released|initial release|shipped|published|posted|announced|came out|debut\w*|available since|out since)\b/iu },
  { name: 'updated', pattern: /\b(?:last updated|updated|last update|last modified|modified|revised|last edited)\b/iu },
  { name: 'latest', pattern: /\b(?:latest|newest|most recent|current(?:ly)?|last release)\b/iu },
  { name: 'lts', pattern: /\b(?:lts|long[\s-]?term(?:\s+support)?|longterm)\b/iu },
  { name: 'price', pattern: /\b(?:price[ds]?|costs?|priced|msrp|fee|fare|rate)\b/iu },
  { name: 'rating', pattern: /\b(?:rating|rated|stars?|score[sd]?)\b/iu },
  { name: 'count', pattern: /\b(?:ratings|reviews|votes|downloads|installs|users|population|count)\b/iu },
]

export function predicateClasses(text: string): Set<string> {
  // Page text can run words together ("v24.21.0Latest LTSv26.10.0"): split digits from letters and "LTSv" from "v".
  const spaced = text.replace(/(\d)(?=\p{L})/gu, '$1 ').replace(/(\p{Lu}{2,})(?=\p{Ll})/gu, '$1 ')
  return new Set(predicates.filter(entry => entry.pattern.test(spaced)).map(entry => entry.name))
}

/** What a claim asserts, without the words that only name its subject ("Release 22.x", "Version 6.1", "Branch 3.9"). */
const assertedClasses = (text: string) => predicateClasses(text.replace(/\b(?:release|version|branch|series|build|update)\s+v?\d[\w.]*/giu, ' '))

/** A label that names a field ("Last updated", "Projected EOL", "First released") has classes; "Date" or "Value" has none. */
const labelClasses = (label: string) => predicateClasses(label)

/** The clause of the claim a value belongs to ("Node.js 16 is end-of-life; its last update was on Aug 08, 2023"). */
function claimClause(claim: string, raw: string): string {
  const at = claim.indexOf(raw)
  if (at < 0) return claim
  const clauses = claim.split(/(?<=;)|(?<=[.!?])\s+|\s[—–]\s|,\s+(?=(?:and|but|while|its|it|which|whereas)\b)/u)
  let offset = 0
  for (const clause of clauses) {
    const start = claim.indexOf(clause, offset)
    if (start <= at && at < start + clause.length) return clause
    offset = start + clause.length
  }
  return claim
}

/** Measured values: what a label has to mean the same thing for. Identifiers (versions, small whole numbers) name things. */
export const measuredSpecific = (specific: Specific) => ['date', 'month', 'quarter', 'relative', 'amount', 'percent'].includes(specific.kind)
  || (specific.kind === 'number' && (Boolean(specific.unit) || !Number.isInteger(Number(specific.value)) || Number(specific.value) >= 1000))
  || specific.kind === 'year'

export interface FieldVerdict {
  ok: boolean
  reason?: 'field_mismatch' | 'predicate_not_found' | 'term_not_in_quote'
  detail?: string
}

/** Does the quote's labelled field, or the region around it, mean what the claim asserts about its values? */
export function fieldSupports(claim: string, quote: string, region: string, options: { now?: string | number | null } = {}): FieldVerdict {
  const typed = { typed: true, smallNumbers: true, now: options.now ?? null }
  // A term the claim puts in quotation marks (a word of the year, a product name) must be in the quote.
  for (const term of claim.matchAll(/(?<=^|[\s(])["“‘']([^"“”‘’']{2,60}?)[.,!?]?["”’'](?![\p{L}])/gu)) {
    const value = normalizeSourceText(term[1]!)
    if (!/[\p{L}\p{N}]/u.test(value)) continue
    if (!normalizeSourceText(quote).includes(value) && !normalizeSourceText(region).includes(value)) return { ok: false, reason: 'term_not_in_quote', detail: term[1]! }
  }
  const claimValues = claimSpecifics(claim, typed).filter(measuredSpecific)
  const claimWide = assertedClasses(claim)
  if (!claimWide.size) return { ok: true }
  const regionClasses = predicateClasses(region)
  if (!claimValues.length) {
    // A status claim ("is end-of-life", "is the latest LTS") with no value: its predicate must be read in or around the quote.
    return [...claimWide].some(name => regionClasses.has(name)) ? { ok: true } : { ok: false, reason: 'predicate_not_found', detail: [...claimWide].join(',') }
  }
  const cells = quote.split(/\n|…|\.\.\./u).map(line => line.trim()).filter(Boolean).flatMap(line => {
    const parts = line.split(/\s+\|\s+/u)
    const labelled = parts.length >= 2 || /^[^:]{1,40}:\s/u.test(line)
    return parts.map(cell => {
      const match = labelled ? /^([^:]{1,60}):\s+(.+)$/su.exec(cell.trim()) : null
      return { label: match?.[1]?.trim() ?? null, text: cell }
    })
  })
  for (const value of claimValues) {
    const clause = claimClause(claim, value.text)
    const asserted = assertedClasses(clause).size ? assertedClasses(clause) : claimWide
    const holding = cells.filter(cell => specificPresent(value, claimSpecifics(cell.text, typed), { typed: true }))
    const labelled = holding.filter(cell => cell.label && labelClasses(cell.label).size)
    if (holding.length && labelled.length === holding.length) {
      // Every cell holding the value names its field: one of them must name the asserted one.
      if (!labelled.some(cell => [...labelClasses(cell.label!)].some(name => asserted.has(name)))) {
        return { ok: false, reason: 'field_mismatch', detail: `${labelled.map(cell => cell.label).join(', ')} is not ${[...asserted].join('/')}` }
      }
      continue
    }
    // Prose or an unlabelled cell ("Date: 31 Dec 2025"): the claim's predicate must be stated around it.
    if (![...asserted].some(name => regionClasses.has(name))) return { ok: false, reason: 'predicate_not_found', detail: [...asserted].join(',') }
  }
  return { ok: true }
}
