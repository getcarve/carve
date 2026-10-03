/** The exhaustive-list obligation, checked mechanically (a clothing
 * retailer's linen shirts, in testing: "List every linen shirt the store sells for men." The
 * page text the actor and the final check both read held 14 name-and-price
 * groups; the answer covered 12, the check added one and the person got 13.
 * The omitted card, a pullover shirt at $49.99, was in the page text
 * in full). The "every/all" contract was prompt-only (optionSurveyScope); this
 * compares the answer's items with the page's listings and speaks only when the
 * two align (`reliable`). Listings are single name-and-price lines, or records
 * found by repeated line structure where names and prices sit on separate lines
 * (structuredListings). Pure: string work on the page text. */
import { answerStatements, asItems, evidenceText } from './answer-edit-grounding.js'

/** `STEWARD_LIST_COVERAGE=off` removes the local refusal, the verifier input and the after-accept gate. */
export const listCoverageEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_LIST_COVERAGE?.trim().toLowerCase() !== 'off'

/** "every", "each", "all" (not "all the time"), "complete/full/entire list", "all pages", "how many". A named number
 * ("the three cheapest") is not exhaustive and is handled by the ordinary answer standards. */
export function exhaustiveRequest(goal: string): boolean {
  return /\b(?:every|each|all(?!\s+(?:of\s+)?(?:the\s+)?time\b)|complete list|full list|entire list|how many)\b/iu.test(goal)
}

const squash = (text: string) => evidenceText(text).replace(/[^a-z0-9]+/gu, ' ').trim()
const priceRe = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/gu
const amount = (raw: string) => Number(raw.replace(/,/gu, ''))

/** The request's price ceiling ("under $100", "below $100", "less than $100", "$100 or less"), or null. */
export function conditionMaxPrice(goal: string): number | null {
  const match = /\b(?:under|below|less than|at most|no more than|up to|cheaper than|max(?:imum)?)\s+\$\s?(\d[\d,]*(?:\.\d{1,2})?)/iu.exec(goal)
    ?? /\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s+or\s+(?:less|under|below)\b/iu.exec(goal)
  return match ? amount(match[1]!) : null
}

/** `text` is the normalized name used for matching; `line` is the page's own line without its price, for messages.
 * `prices` (repeated-structure listings only) is every price the listing's record shows, a sale price with its original. */
export interface PageListing { text: string; line: string; price: number; count: number; prices?: number[] }

/** `STEWARD_LIST_STRUCTURE=off` keeps item detection to single lines with one `$` price and a two-word name. */
export const listStructureEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_LIST_STRUCTURE?.trim().toLowerCase() !== 'off'
/** `STEWARD_LIST_COVERAGE_GATE=off` makes the after-accept comparison a diagnostic again. */
export const listCoverageGateEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => listCoverageEnabled(env) && env.STEWARD_LIST_COVERAGE_GATE?.trim().toLowerCase() !== 'off'
/** `STEWARD_EXHAUSTIVE_LIST_RULE=off` removes the shared every/all rule from the actor, the local gate and the check, and the
 * local scope refusal. */
export const exhaustiveListRuleEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_EXHAUSTIVE_LIST_RULE?.trim().toLowerCase() !== 'off'

/** One rule, word for word, for the actor, the local premature-report gate and the final check. Before it the local gate
 * told the actor that "the matching items a results page has loaded already make a complete answer" while the check read
 * "every" as the whole catalog, and clothing-retailer runs alternated between the two (no run ever loaded
 * page 2 of 42 items, and none needed to). */
export const exhaustiveListRule = 'Exhaustive lists (a request for every, all or each matching item, or a complete list): the answer either covers every matching item the listing has (loading further pages or Load more when that is needed), or covers every matching item on the results it did load and states that scope explicitly with the listing\'s own total when one is shown (for example "the first 36 of 42 shown on page 1; 6 more are on page 2"). Either one is a complete answer: report it as completed, and a scoped answer is never rejected for not loading further pages. An answer that names fewer items than a total it states or the page shows, without such a scope statement, is incomplete, and so is one that leaves out a matching item on the results it loaded.'

/** Page lines that carry one listing: a name of at least two words and exactly one price on the same line, grouped by
 * (name, price). A promotion banner ("20% OFF $100 OR 15% OFF $75") carries two prices and is not a listing. With a
 * ceiling, listings at or above it are dropped ("under $100"). */
export function pageListings(text: string, maxPrice: number | null = null): PageListing[] {
  const groups = new Map<string, PageListing>()
  for (const line of text.split('\n')) {
    const prices = [...line.matchAll(priceRe)]
    if (prices.length !== 1 || /\d\s?%\s?off\b/iu.test(line)) continue
    const name = squash(line.replace(priceRe, ' '))
    if (name.split(' ').length < 2) continue
    const price = amount(prices[0]![1]!)
    if (maxPrice !== null && price >= maxPrice) continue
    const key = `${name}|${price}`
    const group = groups.get(key)
    if (group) group.count += 1
    else groups.set(key, { text: name, line: line.replace(priceRe, ' ').replace(/\s+/gu, ' ').trim().slice(0, 120), price, count: 1 })
  }
  return [...groups.values()]
}

/** The coarse shape of a page line for record detection: a price, another figure, or text only. */
const lineClass = (line: string): 'P' | 'N' | 'T' => /\$\s?\d/u.test(line) ? 'P' : (line.match(/\d/gu)?.length ?? 0) > (line.match(/\p{L}/gu)?.length ?? 0) ? 'N' : 'T'

/** The common leading text of every value, cut back to a word boundary unless every value continues with a capital
 * right after a lower-case letter (accessibility text run together: "Try onBix", "Try onElio"). */
function commonLead(values: string[]): string {
  if (values.length < 2) return ''
  let lead = values[0]!
  for (const value of values) { let i = 0; while (i < lead.length && i < value.length && lead[i] === value[i]) i++; lead = lead.slice(0, i) }
  if (!lead || !/\p{L}$/u.test(lead)) return lead
  if (/\p{Ll}$/u.test(lead) && values.every(value => /^\p{Lu}/u.test(value.slice(lead.length)))) return lead
  const boundary = Math.max(lead.lastIndexOf(' '), lead.search(/[^\p{L}\p{N}]\p{L}*$/u))
  return boundary >= 0 ? lead.slice(0, boundary + 1) : ''
}

/**
 * Listings found by repeated record structure rather than by one line each: a run of at least four records of 1–4
 * lines whose coarse line shapes (price, figure, text) repeat, with a price in every record. The name is the record's
 * varying text line (a line identical in most records, such as "prevnext" or "Select lenses and buy", is layout), or
 * the price line's text when no other line varies, with the text every record starts with removed ("SAVE TO FAVORITES",
 * "Try on"). Menus and prose have no price in every record and are never read as lists. Pure string work.
 */
export function structuredListings(text: string, maxPrice: number | null = null): PageListing[] {
  const lines = text.split('\n').map(line => line.replace(/\s+/gu, ' ').trim()).filter(Boolean)
  const classes = lines.map(lineClass)
  const groups = new Map<string, PageListing>()
  let i = 0
  while (i < lines.length) {
    let best: { k: number; records: number } | null = null
    for (let k = 1; k <= 4; k++) {
      let m = 0
      while (i + m + k < lines.length && classes[i + m] === classes[i + m + k]) m++
      const records = Math.floor((m + k) / k)
      const pattern = classes.slice(i, i + k)
      if (records >= 4 && pattern.includes('P') && (!best || records * k > best.records * best.k)) best = { k, records }
    }
    if (!best) { i++; continue }
    const { k, records } = best
    const rows = Array.from({ length: records }, (_, r) => lines.slice(i + r * k, i + r * k + k))
    const columns = Array.from({ length: k }, (_, c) => rows.map(row => row[c]!))
    // A line identical in half the records or more is layout ("prevnext", "Select lenses and buy"), never a name.
    const layout = (c: number) => { const counts = new Map<string, number>(); for (const value of columns[c]!) counts.set(value, (counts.get(value) ?? 0) + 1); return Math.max(...counts.values()) / records >= 0.5 }
    const priceColumn = classes.slice(i, i + k).indexOf('P')
    const textColumns = columns.map((_, c) => c).filter(c => classes[i + c] === 'T' && !layout(c))
    const nameColumn = textColumns.length ? textColumns.reduce((a, b) => columns[b]!.join('').length > columns[a]!.join('').length ? b : a) : priceColumn
    const raw = columns[nameColumn]!.map(value => nameColumn === priceColumn ? value.replace(priceRe, ' ').replace(/\s+/gu, ' ').trim() : value)
    const lead = commonLead(raw)
    rows.forEach((row, r) => {
      const prices = [...row.join(' ').matchAll(priceRe)].map(match => amount(match[1]!))
      const line = raw[r]!.slice(lead.length).trim().slice(0, 120)
      const name = squash(line)
      if (!prices.length || name.length < 3 || line.length > 200) return
      const price = Math.min(...prices)
      if (maxPrice !== null && price >= maxPrice) return
      const key = `${name}|${prices.join(',')}`
      const group = groups.get(key)
      if (group) group.count += 1
      else groups.set(key, { text: name, line, price, prices, count: 1 })
    })
    i += records * k
  }
  return [...groups.values()]
}

/** The items a page lists: single name-and-price lines when there are at least four of them, otherwise (with
 * `STEWARD_LIST_STRUCTURE` on) records found by repeated structure. */
export function listedItems(text: string, maxPrice: number | null = null): PageListing[] {
  const lines = pageListings(text, maxPrice)
  if (lines.length >= 4 || !listStructureEnabled()) return lines
  const records = structuredListings(text, maxPrice)
  return records.length >= 4 ? records : lines
}

/** A clause that names no new item ("also listed at $39.99", "some listings show $39.99", "one listing shows $49.99")
 * continues the item before it. */
const continuation = /^(?:also|and|or|plus|some|one|two|three|a few|other|another)\b.*\b(?:listed|listing|listings|shows?|shown|at|priced)\b|^(?:also|and|or|plus)\b/u

/** Items the answer names, with the prices it gives them. "— $29.99; also listed at $39.99" and "— $29.99 (6); $39.99
 * (2)" continue the previous item, as does an inline "Name ($39.99 and $49.99)". */
export function answerListItems(answer: string): Array<{ name: string; prices: number[] }> {
  const items: Array<{ name: string; prices: number[] }> = []
  for (const line of answer.split(/\n+/u)) {
    let previous: { name: string; prices: number[] } | null = null
    for (const statement of answerStatements(line)) {
      const parsed = asItems(statement)
      // A clause with prices but no name ("$39.99 (2)") continues the item before it.
      if (!parsed.length && previous) { previous.prices.push(...[...statement.matchAll(priceRe)].map(m => amount(m[1]!))); continue }
      for (const item of parsed) {
        if (previous && continuation.test(item.name)) { previous.prices.push(...item.prices); continue }
        previous = { name: squash(item.name), prices: [...item.prices] }
        items.push(previous)
      }
    }
  }
  return items
}

export interface ListCoverage { pageGroups: number; covered: number; missing: PageListing[]; reliable: boolean }

/** The page's name-and-price groups the answer does not name at that price. The diff is trusted (`reliable`) only when
 * the page's lines and the answer's items align: at least four groups, at least 60% of them already covered, and at most
 * ten missing. Where names and prices sit on separate lines (a clothing retailer) extraction yields promo and
 * badge fragments, almost nothing aligns, and the check stays silent. */
export function listCoverage(answer: string, pageText: string, goal: string): ListCoverage {
  const listings = listedItems(pageText, conditionMaxPrice(goal))
  const items = answerListItems(answer)
  const names = (listing: PageListing, name: string) => name.length >= 3 && (listing.text.includes(name) || (listing.prices !== undefined && listing.text.length >= 3 && name.includes(listing.text)))
  const priced = (listing: PageListing, prices: number[]) => listing.prices ? prices.length === 0 || prices.some(price => listing.prices!.includes(price)) : prices.includes(listing.price)
  const missing = listings.filter(listing => !items.some(item => names(listing, item.name) && priced(listing, item.prices)))
  const covered = listings.length - missing.length
  const reliable = listings.length >= 4 && covered / listings.length >= 0.6 && missing.length <= 10
  return { pageGroups: listings.length, covered, missing, reliable }
}

/** The actor's one local refusal when a reliable diff finds groups the answer leaves out. */
export function listCoverageRefusal(coverage: ListCoverage): string {
  const named = coverage.missing.map(m => `"${m.line}" $${m.price.toFixed(2)}${m.count > 1 ? ` (×${m.count})` : ''}`).join('; ')
  return `The request asks for every item, and the page text lists ${coverage.pageGroups} name-and-price groups; your answer covers ${coverage.covered}. `
    + `Not in your answer: ${named}. Add each one that meets the request, with its name and displayed price in the same format as the rest of the answer, `
    + 'or leave one out only if it fails a stated condition and say which and why. Keep everything else unchanged.'
}

/** The total a listing states for itself ("42 Products", "176 STYLES", "124frames", "1,204 results"), or null. */
export function statedListTotal(text: string): number | null {
  const match = /(?:^|[^\d.,$])(\d{1,3}(?:,\d{3})+|\d{1,6})\s*\+?\s*(?:products|items|results|styles|frames|listings|matches)\b/iu.exec(text)
  return match ? amount(match[1]!) : null
}

/** Words that state an answer's scope: which page or part of the listing it covers. */
const scopeStatement = /\b(?:first|page (?:1|one)\b|loaded|shown on|on this page|of \d[\d,]*\b|more (?:pages?|items|results|products|styles)|next page|further pages|other pages|remaining|additional (?:pages?|items|results)|not all|only (?:the )?(?:loaded|visible|first))/iu

export interface ListScope { total: number | null; listed: number; scopeStated: boolean; gap: boolean }

/** The mechanical half of `exhaustiveListRule`: an answer that lists fewer items than the total it states, or the total
 * the page states, without a scope statement. Only answers that list at least two items are judged. */
export function listScope(answer: string, pageText: string | null): ListScope {
  const listed = answerListItems(answer).length
  const total = statedListTotal(answer) ?? (pageText ? statedListTotal(pageText) : null)
  const scopeStated = scopeStatement.test(answer)
  return { total, listed, scopeStated, gap: listed >= 2 && total !== null && total > listed && !scopeStated }
}

/** The actor's one local refusal for an unscoped partial list. */
export function listScopeRefusal(scope: ListScope): string {
  return `The request asks for every item. Your answer lists ${scope.listed} item${scope.listed === 1 ? '' : 's'} but the listing shows ${scope.total} in total, and the answer does not say which part it covers. `
    + 'Either load the rest (the next page or Load more) and list every matching item, or keep every matching item from the results you loaded and state that scope plainly with the total (for example "the first 36 of 42, on page 1"); a scoped answer is complete. Keep the items and prices unchanged.'
}

/** One sentence for the final check about the `listCoverage` input. */
export const listCoverageVerifierGuidance = 'listCoverage, when present, is the controller\'s mechanical comparison of the current page\'s name-and-price lines with the proposed answer: for a request for every or all items, each notInAnswer entry that meets the request must be in the answer (add it with correctedAnswer exactly as the page shows it) or its exclusion must be stated with the failed condition.'
