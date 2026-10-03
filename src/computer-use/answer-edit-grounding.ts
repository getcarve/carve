/** Deterministic checks on the final check's edited answer (`correctedAnswer`).
 *
 * The final check is a model. When it accepts an answer "with edits", the
 * edited text is model-written and has not been reviewed by anything else, so
 * it is shown only when every statement it changed or added passes these
 * checks against the captured page evidence. A failed check does not reject the
 * answer: the controller falls back to the ordinary repair turn and a second
 * final check. Passing these checks means the edit introduced no unpaired
 * price or figure, no new scope or selection-state claim and no unsupported
 * prose; it does not mean the rest of the answer was verified by code.
 *
 * An independent review reproduced the following against the length-based
 * rule this replaces: real product names with their prices swapped were
 * accepted because both prices occurred somewhere on the page; short invented
 * prose was accepted; an edit of similar size with an invented price skipped the
 * grounding check entirely because only grown edits were checked.
 */

export interface EditGroundingResult {
  ok: boolean
  /** One line per statement the edit changed that could not be grounded. */
  failures: string[]
  /** Statements the edit changed or added that were checked and grounded. */
  grounded: number
}

const clusterFiller = new Set(['was', 'now', 'from', 'sale', 'regularly', 'regular', 'reg', 'with', 'code', 'off', 'save', 'orig', 'original', 'price', 'prices', 'compare', 'at', 'to', 'and', 'or', 'usd', 'each', 'starting', 'list', 'our', 'new', 'you', 'compared', 'value', 'msrp', 'retail', 'flash', 'otherwise', 'as', 'low', 'marked'])
const stopWords = new Set(['that', 'this', 'these', 'those', 'with', 'from', 'have', 'has', 'were', 'what', 'when', 'which', 'where', 'there', 'their', 'they', 'them', 'then', 'than', 'also', 'into', 'your', 'about', 'only', 'each', 'here', 'shown', 'show', 'shows', 'listed', 'lists', 'list', 'page', 'pages', 'results', 'result', 'items', 'item', 'options', 'option', 'loaded', 'visible', 'displayed', 'appear', 'appears', 'include', 'includes', 'including', 'like', 'would', 'could', 'should', 'more', 'other', 'some', 'both', 'does', 'will', 'just', 'still', 'because', 'since', 'while', 'well', 'being', 'been', 'the', 'and', 'distinct', 'different', 'separate', 'matching', 'qualifying', 'total'])
/** Words that widen what an answer claims, or claim a selected control state. An
 * edit may narrow an answer; it may not add these (see scopeTokens). */
const scopePattern = /\b(?:all|every|entire|complete|full|whole|only|none|no other|sorted|sort(?:ed)? by|filtered|filters? (?:applied|set)|applied|selected|cheapest|lowest|highest|best|most|least|newest|latest|top|exhaustive|in stock)\b/gu
/** Language that limits an answer's scope or says what is unconfirmed. */
const hedgePattern = /\b(?:more (?:results|listings|items|options|styles|products|pages?|matches)|(?:additional|remaining|other) (?:results|listings|items|options|styles|products|pages?)|not (?:every|all|include|includes|a complete|an exhaustive|necessarily|confirm|confirmed|verify|verified|checked)|couldn't|could not|can't|cannot|unconfirmed|unverified|a selection|selection (?:of|from)|among|loaded|first page|page 1|next page|other pages|i can (?:continue|look|share|check|keep))\b/u
/** Carve's own conduct ("I haven't bought anything"), which the page cannot show and the answer may state. */
const ownConduct = /^(?:i|carve) (?:haven't|have not|didn't|did not|won't|will not) (?:buy|bought|purchase|purchased|add|added|submit|submitted|send|sent|book|booked|select|selected|rent|rented|sign|signed|change|changed)\b|^no (?:\w+ )?(?:was|were) (?:bought|purchased|selected|rented|added|submitted|booked)\b/u
/** A price the request set as a condition ("under $100"), not an item's price. */
const conditionPrice = /\b(?:under|below|less than|over|above|up to|at most|no more than|within|maximum|max|budget of|cheaper than)\s+\$\s?\d[\d,]*(?:\.\d{1,2})?/gu
const numberWords: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', twenty: '20' }
const weekdayMonth = /\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b|\b(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\bmay\s+\d/gu

/** Lowercased, markdown and typography removed; newlines kept as boundaries. */
export function evidenceText(text: string): string {
  return text.normalize('NFKC').toLowerCase()
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/[*_`#>|]/gu, ' ')
    .replace(/[‘’′]/gu, "'").replace(/[“”″]/gu, '"')
    .replace(/[–—−]/gu, ' - ')
    .replace(/\u00a0/gu, ' ')
    .replace(/[^\S\n]+/gu, ' ').replace(/ *\n */gu, '\n').trim()
}
const flat = (text: string) => evidenceText(text).replace(/\n+/gu, ' ')
const withNumberWords = (text: string) => text.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty)\b/gu, word => numberWords[word]!)

const priceValues = (text: string) => [...text.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/gu)].map(match => Number(match[1]!.replace(/,/gu, '')))
/** Figures other than prices, normalized: "1,673" → "1673", "8:00" stays, "4.50" → "4.5". */
function figures(text: string): string[] {
  const withoutPrices = text.replace(/\$\s?\d[\d,]*(?:\.\d{1,2})?/gu, ' ')
  return [...withoutPrices.matchAll(/\d[\d,]*(?:[.:]\d+)?/gu)].map(match => {
    const raw = match[0].replace(/,/gu, '')
    return raw.includes('.') ? String(Number(raw)) : raw
  })
}
const dateWords = (text: string) => [...text.matchAll(weekdayMonth)].map(match => match[0].slice(0, 3))
const contentWords = (text: string) => (text.match(/[a-z][a-z'-]{3,}/gu) ?? []).filter(word => !stopWords.has(word))
const figureSet = (text: string) => new Set([...figures(text), ...priceValues(text).map(String)])

/** Scope words outside item names ("Top Rated Trail Jacket" names a jacket). */
function scopeTokens(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  const claims = answerStatements(text).map(statement => { const items = asItems(statement); return items.length ? items.map(item => item.rest).join(' ') : flat(statement) }).join(' ')
  for (const match of claims.matchAll(scopePattern)) {
    const token = match[0].replace(/\s+/gu, ' ').replace(/^sort by$/u, 'sorted by')
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

/** "; "-joined clauses, not splitting inside parentheses ("(Flash Sale; otherwise $75.00)"). */
function splitOutsideParentheses(text: string): string[] {
  const out: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ';' && depth === 0 && /\s/u.test(text[i + 1] ?? '')) { out.push(text.slice(start, i)); start = i + 1 }
  }
  out.push(text.slice(start))
  return out.map(part => part.trim().replace(/^and\s+/u, '')).filter(Boolean)
}

/** Statements of an answer: list items, lines, "; "-joined items, and
 * sentences of prose. A lead-in before a colon is its own statement when an
 * item with a price follows it. */
export function answerStatements(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\n+/u)) {
    // A table row reads as "first cell — other cells"; separator rows carry nothing.
    const cells = raw.includes('|') ? raw.split('|').map(cell => cell.trim()).filter(Boolean) : null
    if (cells && cells.every(cell => /^:?-{2,}:?$/u.test(cell))) continue
    const line = cells && cells.length > 1 ? `${cells[0]} — ${cells.slice(1).join(', ')}` : raw
    const item = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, '').trim()
    if (!item) continue
    for (const clause of splitOutsideParentheses(item)) {
      const lead = /^(.{8,200}?):\s+(.*\$\s?\d.*)$/u.exec(clause)
      const pieces = lead ? [lead[1]!, lead[2]!] : [clause]
      for (const piece of pieces) {
        // Prose splits into sentences; an item line with a price stays whole ("$9.99. Ships free" is two).
        for (const sentence of piece.split(/(?<=[.!?])\s+(?=["“(]?[A-Z])/u)) {
          const trimmed = sentence.replace(/^and\s+/u, '').trim()
          if (trimmed) out.push(trimmed)
        }
      }
    }
  }
  return out
}

/** The item a statement is about: the text before its first separator, dash,
 * price or parenthesis ("Alder — $95", "Alder ($95)", "Alder: $95", "Alder is $95"). */
export function itemName(statement: string): string | null {
  const plain = flat(statement)
  const cut = plain.split(/\s-\s|:\s|\s\(|\s?\$|\s(?:is|are|at|for|costs?|priced at|listed at|starts? at)\s(?=\$|\d)|,\s(?=\$|\d)/u)[0]?.trim() ?? ''
  const name = cut.replace(/^(?:the|a|an)\s+/u, '').replace(/[.,;:!?]+$/u, '').trim()
  if (name.length < 3 || name.length > 160 || name === plain) return null
  return name
}

export interface Item { name: string; prices: number[]; figures: string[]; dates: string[]; rest: string }
const joinerWords = new Set([...clusterFiller, 'the', 'and', 'for', 'are', 'costs', 'priced', 'listed', 'starts', 'plus'])
const cleanName = (text: string) => text
  .replace(/(?:\s(?:at|for|is|are|costs?|priced at|listed at|starts? at|from))+\s*$/u, '')
  .split(/\s-\s|:\s|\s\(/u)[0]!
  .replace(/^[\s,;:)]+|[\s,;:(]+$/gu, '').replace(/^(?:and|or)\s+/u, '')
  // A lead-in before the first item ("two options are the Alpha…", "examples include …").
  .replace(/^(?:.*\s)?(?:are|include|includes|including|shows?|lists?|features?)\s+(?=\S+\s+\S)/u, '')
  .replace(/^(?:the|a|an)\s+/u, '').trim()

/** The items a statement names, each with the prices that follow it: "Alder —
 * $95", "Alder ($95), Birch ($95) and Cedar ($95)", "the Alpha at $149.95 and the Beta
 * at $79.99". A price preceded only by price words ("with code (regularly
 * $75)") belongs to the item before it. Without a price, a statement is an item
 * only in the "Name — details" form. */
export function asItems(statement: string): Item[] {
  const plain = flat(statement).replace(conditionPrice, ' ').replace(/\s+/gu, ' ').trim()
  const matches = [...plain.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/gu)]
  if (!matches.length) {
    const name = itemName(plain)
    if (!name) return []
    const rest = plain.slice(plain.indexOf(name) + name.length)
    return /^\s*(?:-|:)\s/u.test(rest) ? [{ name, prices: [], figures: figures(rest), dates: dateWords(rest), rest }] : []
  }
  const items: Array<{ name: string; nameEnd: number; prices: number[]; end: number }> = []
  let previousEnd = 0
  for (const match of matches) {
    const before = plain.slice(previousEnd, match.index).replace(/\bcode\s+[a-z0-9]+/gu, ' ')
    const words = (before.match(/[a-z0-9][a-z0-9'.-]*/gu) ?? []).filter(word => !joinerWords.has(word))
    const current = items.at(-1)
    if (current && (words.length === 0 || (words.length === 1 && words[0]!.length < 4))) current.prices.push(Number(match[1]!.replace(/,/gu, '')))
    else {
      const name = cleanName(before)
      if (current) current.end = previousEnd + Math.max(0, before.indexOf(name))
      if (name.length >= 3) items.push({ name, nameEnd: previousEnd + before.indexOf(name) + name.length, prices: [Number(match[1]!.replace(/,/gu, ''))], end: plain.length })
    }
    previousEnd = match.index! + match[0].length
  }
  return items.filter(item => item.name.length <= 160).map(item => {
    const rest = plain.slice(item.nameEnd, item.end)
    return { name: item.name, prices: item.prices, figures: figures(rest), dates: dateWords(rest), rest }
  })
}
const itemKey = (item: Item) => `${item.name}|${[...item.prices].sort((a, b) => a - b).join(',')}|${[...item.figures].sort().join(',')}|${[...item.dates].sort().join(',')}`

/** Where a name occurs in the evidence. Page text often runs a badge or the
 * next field into a title with no separator ("CurveCedar Mini Dress Black
 * Curve", "Alpha Tune 770NCOver-ear"), so no word boundary is required; an
 * occurrence that is the start of a longer name the answer also lists ("Cedar
 * Mini Dress Black" inside "Cedar Mini Dress Black Tall") is not this item. */
function nameOccurrences(source: string, name: string, names: string[]): number[] {
  const longer = names.filter(other => other !== name && other.startsWith(name))
  const found: number[] = []
  for (let at = source.indexOf(name); at >= 0; at = source.indexOf(name, at + 1)) {
    if (longer.some(other => { return source.startsWith(other, at) })) continue
    found.push(at)
  }
  return found
}

/** The name as the page writes it: the whole name; only when that is not on
 * the page with a price, its trailing words ("options include the Acme Co-op
 * Trail Tent 3" is "trail tent 3" where a brand runs into the title), at least
 * two words and three fifths of the name, so "Cedar Mini Dress Black" never
 * becomes "mini dress black". */
function pageName(source: string, name: string, names: string[], priced: boolean): { name: string; at: number[] }[] {
  const words = name.split(' ')
  const whole = nameOccurrences(source, name, names)
  const found: { name: string; at: number[] }[] = whole.length ? [{ name, at: whole }] : []
  const wholePriced = whole.some(at => priceCluster(source, at, name, names).prices.length > 0)
  if (whole.length && (!priced || wholePriced)) return found
  for (let start = 1; start < words.length; start++) {
    const candidate = words.slice(start).join(' ')
    if (words.length - start < 2 || candidate.length < 6 || (words.length - start) / words.length < 0.6) break
    const at = nameOccurrences(source, candidate, names)
    if (at.length) found.push({ name: candidate, at })
  }
  return found
}

/** The prices that belong to the item at this occurrence: the first price after
 * its name, and any price joined to it only by price words ("$75.00 $52.50 with
 * code", "was $79.00"), never past another answer item's name. When no price
 * follows before the next item, the nearest price before the name is used. */
function priceCluster(source: string, at: number, name: string, otherNames: string[]): { prices: number[]; window: string; context: string } {
  const start = at + name.length
  let end = Math.min(source.length, start + 400)
  for (const other of otherNames) {
    if (other === name || other.includes(name)) continue
    const next = source.indexOf(other, start)
    if (next >= 0 && next < end) end = next
  }
  const window = source.slice(start, end)
  // The item's own text before its price: back to the previous price on the page, at most 600 characters.
  const back = source.slice(Math.max(0, at - 600), at)
  const lastPrice = [...back.matchAll(/\$\s?\d[\d,]*(?:\.\d{1,2})?/gu)].at(-1)
  const lead = lastPrice ? back.slice(lastPrice.index! + lastPrice[0].length) : back
  const matches = [...window.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/gu)]
  const prices: number[] = []
  let last = -1
  for (const match of matches) {
    if (last >= 0) {
      const between = window.slice(last, match.index)
      const words = between.match(/[a-z]{3,}/gu) ?? []
      if (words.some(word => !clusterFiller.has(word)) || between.length > 60) break
    }
    prices.push(Number(match[1]!.replace(/,/gu, '')))
    last = match.index! + match[0].length
  }
  const context = lead + name + window.slice(0, last >= 0 ? last : window.length)
  if (prices.length || matches.length) return { prices, window, context }
  const near = source.slice(Math.max(0, at - 120), at)
  const previous = [...near.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/gu)].at(-1)
  const tail = previous ? near.slice(previous.index! + previous[0].length) : ''
  if (previous && !otherNames.some(other => other !== name && tail.includes(other)) && !/[a-z]{3,}\s*\n.*\$/u.test(tail)) return { prices: [Number(previous[1]!.replace(/,/gu, ''))], window: near + window, context: near + name + window }
  return { prices: [], window, context }
}

const weekday = (now: Date, offset: number) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][(now.getDay() + offset) % 7]!

function itemGrounded(item: Item, source: string, names: string[], now: Date): string | null {
  const found = pageName(source, item.name, names, item.prices.length > 0)
  if (!found.length) return `"${item.name}" is not on the page as written`
  const wantedWords = contentWords(item.rest.replace(/\$\s?\d[\d,]*(?:\.\d{1,2})?/gu, ' ').replace(weekdayMonth, ' ')).filter(word => !clusterFiller.has(word) && !/^(?:sale|price|each|select|colors?|code|regularly|listed|shown)$/u.test(word))
  const windows = found.flatMap(match => match.at.map(at => priceCluster(source, at, match.name, names)))
  // Each price must belong to this item at some occurrence of its name (a
  // grouped row may name several listings of one shirt at different prices).
  // A variant written with the item ("(Black)", "(2-pack)") must be in that
  // item's own text where the price is: a color's price is not another color's.
  const variant = [...item.rest.matchAll(/\(([^)$]*)\)/gu)].flatMap(match => contentWords(match[1]!)).filter(word => !clusterFiller.has(word) && !/^(?:sale|price|each|code|regularly|listed|shown|select|colors?)$/u.test(word))
  const unpaired = item.prices.filter(price => !windows.some(window => window.prices.includes(price) && variant.every(word => window.context.includes(word))))
  if (unpaired.length) return `"${item.name}" is not shown with ${unpaired.map(p => '$' + p).join(' / ')} on the page`
  // Other figures, dates and (for an item without a price) its details appear together in one occurrence's text.
  const together = windows.some(({ prices, window }) => {
    const near = new Set([...figures(window), ...prices.map(String)])
    if (item.figures.some(figure => !near.has(figure))) return false
    const nearDates = new Set(dateWords(window))
    // "Today" and "Tomorrow" on the page are the weekdays they name now.
    if (/\btoday\b/u.test(window)) nearDates.add(weekday(now, 0))
    if (/\btomorrow\b/u.test(window)) nearDates.add(weekday(now, 1))
    if (item.dates.some(date => !nearDates.has(date))) return false
    return item.prices.length > 0 || wantedWords.every(word => window.includes(word))
  })
  return together ? null : `"${item.name}" is not shown with "${item.rest.trim().slice(0, 80)}" on the page`
}

/** New prose (no item) is grounded when it only rewords the proposed answer,
 * or when the words it adds occur together in one short span of the page. */
function proseGrounded(statement: string, originalFlat: string, originalFigures: Set<string>, sourceFlat: string, itemCounts: Set<string>): string | null {
  const plain = withNumberWords(flat(statement))
  const missingFigures = [...figureSet(plain)].filter(figure => !originalFigures.has(figure) && !itemCounts.has(figure))
  if (missingFigures.length) return `"${statement.slice(0, 80)}" adds ${missingFigures.join(', ')}, not in the proposed answer`
  const added = [...new Set(contentWords(plain))].filter(word => !originalFlat.includes(word))
  if (!added.length) return null
  if (added.some(word => !sourceFlat.includes(word))) return `"${statement.slice(0, 80)}" adds wording the page does not support`
  // All the added words within one 300-character span of the page.
  const first = added[0]!
  for (let at = sourceFlat.indexOf(first); at >= 0; at = sourceFlat.indexOf(first, at + 1)) {
    const span = sourceFlat.slice(Math.max(0, at - 300), at + 300)
    if (added.every(word => span.includes(word))) return null
  }
  return `"${statement.slice(0, 80)}" joins page wording that does not occur together`
}

/** A limitation or a statement of Carve's own conduct adds no page fact, but
 * any figure in it must already be in the proposed answer. */
function proseFiguresKept(statement: string, originalFigures: Set<string>, itemCounts: Set<string>): string | null {
  const missing = [...figureSet(withNumberWords(flat(statement)))].filter(figure => !originalFigures.has(figure) && !itemCounts.has(figure))
  return missing.length ? `"${statement.slice(0, 80)}" adds ${missing.join(', ')}, not in the proposed answer` : null
}

/** Checks every statement the edit changed or added against the evidence. */

export function groundEditedAnswer(original: string, edited: string, evidence: string, now = new Date()): EditGroundingResult {
  const failures: string[] = []
  const originalFlat = withNumberWords(flat(original))
  const source = evidenceText(evidence), sourceFlat = withNumberWords(source.replace(/\n+/gu, ' '))
  const originalStatements = answerStatements(original)
  const originalItems = new Set(originalStatements.flatMap(asItems).map(itemKey))
  const originalFigures = new Set([...figureSet(originalFlat)])
  const editedStatements = answerStatements(edited)
  const names = [...new Set([...originalStatements, ...editedStatements].flatMap(asItems).map(item => item.name))]
  const editedItems = editedStatements.flatMap(asItems)
  // A count the edit states is checked against the items it lists.
  const editedItemCounts = new Set([String(editedItems.length), String(editedItems.filter(item => item.prices.length).length)])

  // Scope and selection state: an edit may narrow, never widen.
  const before = scopeTokens(original)
  for (const [token, count] of scopeTokens(edited)) if (count > (before.get(token) ?? 0)) failures.push(`the edit adds "${token}", a scope or selection claim the page text cannot establish`)
  // A limitation the proposed answer disclosed must survive the edit.
  if (hedgePattern.test(flat(original)) && !hedgePattern.test(flat(edited))) failures.push('the edit removes the answer\'s stated limitation')

  let grounded = 0
  for (const statement of editedStatements) {
    const plain = flat(statement)
    // Kept from the proposed answer (a removal leaves a sentence's head: "Sign-in is required.")...
    const head = withNumberWords(plain).replace(/[.!?;,:]+$/u, '')
    if (!plain) continue
    if (originalFlat.includes(head)) {
      // ...unless what the removal cut off was a negation or exception ("key chains, not sets").
      const cut = originalStatements.map(original => withNumberWords(flat(original))).find(original => original.includes(head) && original.length > head.length)
      const tail = cut ? cut.slice(cut.indexOf(head) + head.length) : ''
      if (/^[\s,;:()-]*(?:(?:and|or)\s+)?(?:not|no|never|except|excluding|without|unless|but|only|although|though)\b/u.test(tail) && !originalStatements.some(original => withNumberWords(flat(original)).replace(/[.!?;,:]+$/u, '') === head)) failures.push(`the edit cuts "${tail.trim().slice(0, 60)}" from a statement`)
      continue
    }
    const items = asItems(statement)
    const hedge = hedgePattern.test(plain) || ownConduct.test(plain)
    const failure = items.length
      ? items.map(item => originalItems.has(itemKey(item)) ? null : itemGrounded(item, source, names, now)).find(Boolean) ?? null
      : !evidence ? `"${statement.slice(0, 80)}" is new and there is no page evidence`
      : hedge ? proseFiguresKept(statement, originalFigures, editedItemCounts)
      : proseGrounded(statement, originalFlat, originalFigures, sourceFlat, editedItemCounts)
    if (failure) failures.push(failure); else grounded += 1
  }
  return { ok: failures.length === 0, failures, grounded }
}

/** Structured final-check edits: the check names the statements to delete and the item lines to add
 * instead of rewriting the whole answer, which made an accepted-with-edit check take a median 11 s (≈900 output
 * tokens) against 2.5 s for a plain accept. The rebuilt answer still goes through groundEditedAnswer. Returns null
 * when an edit cannot be applied exactly (text not found, nowhere to add a line); the caller then repairs as usual. */
export function applyAnswerEdits(original: string, edits: { remove: readonly string[]; addLines: readonly string[]; replace?: ReadonlyArray<{ find: string; with: string }> }): string | null {
  const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/u
  const bare = (line: string) => line.replace(bullet, '').replace(/[*_`]/gu, '').replace(/\s+/gu, ' ').trim()
  // Replacements first: exact passages of the proposed answer ("two options" → "options", a punctuation fix).
  let text = original
  for (const { find, with: replacement } of edits.replace ?? []) {
    if (!find) continue
    const at = text.indexOf(find)
    if (at < 0) return null
    text = text.slice(0, at) + replacement + text.slice(at + find.length)
  }
  let lines = text.split('\n')
  for (const raw of edits.remove) {
    const target = bare(raw).replace(/[.;,]+$/u, '')
    if (!target) continue
    const whole = lines.findIndex(line => bare(line).replace(/[.;,]+$/u, '') === target)
    if (whole >= 0) { lines.splice(whole, 1); continue }
    const index = lines.findIndex(line => line.includes(raw.trim()) || bare(line).includes(target))
    if (index < 0) return null
    const line = lines[index]!
    const needle = line.includes(raw.trim()) ? raw.trim() : target
    const at = line.indexOf(needle)
    if (at < 0) return null
    let before = line.slice(0, at), after = line.slice(at + needle.length)
    // A clause in a "; "-joined list takes one separator with it; a sentence takes its trailing space.
    if (/;\s*$/u.test(before) && /^[.;]?\s*(?:and\s+)?\S/u.test(after)) before = before.replace(/;\s*$/u, '')
    else if (/^\s*;\s*(?:and\s+)?/u.test(after)) after = after.replace(/^\s*;\s*(?:and\s+)?/u, before.trim() ? '; ' : '')
    else if (/^[.!?]?\s+/u.test(after) || after.trim() === '') after = after.replace(/^[.!?]?\s*/u, before.trim() && after.trim() ? '' : after.trim() ? '' : '')
    lines[index] = (before + (before && after && !/\s$/u.test(before) && !/^[\s.,;]/u.test(after) ? ' ' : '') + after).replace(/\s{2,}/gu, ' ').replace(/\s+([.,;])/gu, '$1')
    if (!bare(lines[index]!)) lines.splice(index, 1)
  }
  if (edits.addLines.length) {
    const last = lines.map((line, i) => bullet.test(line) ? i : -1).filter(i => i >= 0).at(-1)
    if (last === undefined) return null
    const prefix = bullet.exec(lines[last]!)![0]
    const numbered = /^\s*(\d+)([.)])\s+/u.exec(lines[last]!)
    const added = edits.addLines.map((line, i) => (numbered ? prefix.replace(/\d+/u, String(Number(numbered[1]) + i + 1)) : prefix) + bare(line))
    lines = [...lines.slice(0, last + 1), ...added, ...lines.slice(last + 1)]
  }
  const rebuilt = lines.join('\n').replace(/\n{3,}/gu, '\n\n').replace(/ {2,}/gu, ' ').trim()
  return rebuilt && rebuilt !== original.trim() ? rebuilt : null
}
