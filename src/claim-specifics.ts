/** The checkable specifics in a factual sentence: dates, years, amounts,
 * percentages, versions and multi-digit figures, each in one canonical form so
 * "September 11, 2023", "Sep 11 2023" and "2023-09-11" compare equal.
 *
 * Used to ask one narrow question deterministically: does every specific an
 * answer asserts appear in the evidence it was given (or in the person's own
 * question)? A date that appears nowhere in the evidence was not read there.
 *
 * Typed comparison (27 September, answer-trust phase 4). Until then a figure was
 * compared by its bare value: "$49" was "supported" by "49%", "42 km" by "42
 * miles", a two-part version "3.10" equalled "3.1", "03/04/2025" was read
 * month-first whatever the page meant, and "Q4 2027", "2027-12", "12/2027" or "8
 * months ago" were not dates at all. Values now carry their unit (currency, %,
 * length, mass, duration, data), magnitude (k, M, B, million, billion),
 * versions compare as dotted strings, ambiguous day/month dates match nothing
 * but the same written date, and relative dates are resolved against the time
 * the page was read when that time is known. `STEWARD_TYPED_SPECIFICS=off`
 * restores the untyped comparison. */

const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const monthIndex = (word: string): number => {
  const value = word.toLowerCase().replace(/\.$/u, '')
  if (value === 'sept') return 9
  const index = months.findIndex(month => month === value || (value.length >= 3 && month.startsWith(value)))
  return index + 1
}
const pad = (value: number) => String(value).padStart(2, '0')
const monthPattern = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?'

export type SpecificKind = 'date' | 'month' | 'quarter' | 'relative' | 'year' | 'amount' | 'percent' | 'version' | 'number'
export type Specific = {
  kind: SpecificKind
  value: string
  text: string
  /** Typed only. Currency code for an amount; canonical unit for a measured number ("km", "h", "GB"). */
  unit?: string
  /** Typed only. A numeric day/month date whose order the text does not settle ("03/04/2025"). */
  ambiguous?: boolean
}

export interface SpecificOptions {
  /** Typed parsing and comparison; defaults to `typedSpecificsEnabled()`. */
  typed?: boolean
  /** Also single digits and spelled-out numbers ("three", "five-year"). Typed only. */
  smallNumbers?: boolean
  /** Reference instant for relative dates ("6 days ago"). Without it they are not specifics. Typed only. */
  now?: number | string | Date | null
}

export const typedSpecificsEnabled = () => process.env.STEWARD_TYPED_SPECIFICS?.trim().toLowerCase() !== 'off'

/** Canonical specifics, in order of appearance, without duplicates. */
export function claimSpecifics(text: string, options: SpecificOptions = {}): Specific[] {
  return options.typed ?? typedSpecificsEnabled() ? typedSpecifics(text, options) : legacySpecifics(text)
}

/** True when `specific` is present in `evidence` in any written form. A full
 * date also counts as present when the evidence has that exact date; a month
 * or year counts when any date in that month or year is present. */
export function specificPresent(specific: Specific, evidence: Specific[], options: Pick<SpecificOptions, 'typed'> = {}): boolean {
  return options.typed ?? typedSpecificsEnabled() ? evidence.some(candidate => typedMatch(specific, candidate)) : legacyPresent(specific, evidence)
}

/** Specifics in `claim` that appear nowhere in the evidence texts. */
export function unsupportedSpecifics(claim: string, ...evidence: string[]): Specific[] {
  return unsupportedSpecificsWith({}, claim, evidence)
}

/** `unsupportedSpecifics` with explicit options; `evidenceNow` resolves relative dates in the evidence (the time it was read). */
export function unsupportedSpecificsWith(options: SpecificOptions & { evidenceNow?: SpecificOptions['now'] }, claim: string, evidence: string[]): Specific[] {
  const typed = options.typed ?? typedSpecificsEnabled()
  const known = evidence.flatMap(text => claimSpecifics(text, { typed, smallNumbers: options.smallNumbers ?? false, now: options.evidenceNow ?? options.now ?? null }))
  return claimSpecifics(claim, { typed, smallNumbers: options.smallNumbers ?? false, now: options.now ?? null }).filter(specific => !specificPresent(specific, known, { typed }))
}

// ---------------------------------------------------------------------------
// Legacy (untyped) parsing, kept verbatim for `STEWARD_TYPED_SPECIFICS=off`.

function legacySpecifics(text: string): Specific[] {
  const found: Array<Specific & { at: number; end: number }> = []
  const taken = (start: number, end: number) => found.some(item => start < item.end && end > item.at)
  const add = (kind: Specific['kind'], value: string, at: number, raw: string) => {
    if (!taken(at, at + raw.length)) found.push({ kind, value, text: raw.trim(), at, end: at + raw.length })
  }
  let match: RegExpExecArray | null
  const scan = (pattern: RegExp, handle: (match: RegExpExecArray) => void) => { pattern.lastIndex = 0; while ((match = pattern.exec(text))) handle(match) }
  // 2023-09-11, 2023/09/11
  scan(/\b((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/gu, m => {
    const month = Number(m[2]), day = Number(m[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) add('date', `${m[1]}-${pad(month)}-${pad(day)}`, m.index, m[0])
  })
  // September 11, 2023 · Sep 11 2023 · Sept. 11th, 2023
  scan(new RegExp(`\\b${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+((?:19|20)\\d{2})\\b`, 'giu'), m => {
    const month = monthIndex(m[1]!), day = Number(m[2])
    if (month && day >= 1 && day <= 31) add('date', `${m[3]}-${pad(month)}-${pad(day)}`, m.index, m[0])
  })
  // 11 September 2023
  scan(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${monthPattern},?\\s+((?:19|20)\\d{2})\\b`, 'giu'), m => {
    const month = monthIndex(m[2]!), day = Number(m[1])
    if (month && day >= 1 && day <= 31) add('date', `${m[3]}-${pad(month)}-${pad(day)}`, m.index, m[0])
  })
  // 09/11/2023 (US order; ambiguous forms are read month-first, as Carve writes them)
  scan(/\b(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})\b/gu, m => {
    const month = Number(m[1]), day = Number(m[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) add('date', `${m[3]}-${pad(month)}-${pad(day)}`, m.index, m[0])
  })
  // September 2023 · Dec, 2027 (kernel.org's "Projected EOL: Dec, 2027")
  scan(new RegExp(`\\b${monthPattern},?\\s+((?:19|20)\\d{2})\\b`, 'giu'), m => {
    const month = monthIndex(m[1]!)
    if (month) add('month', `${m[2]}-${pad(month)}`, m.index, m[0])
  })
  // $1,299.99 · €45 · USD 12
  scan(/(?:[$€£¥]|\b(?:USD|EUR|GBP|CAD|AUD)\s?)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\b/gu, m => {
    add('amount', `${m[1]!.replace(/,/gu, '')}${m[2] && Number(m[2]) !== 0 ? '.' + m[2].replace(/0+$/u, '') : ''}`, m.index, m[0])
  })
  // 12.5%
  scan(/\b(\d+(?:\.\d+)?)\s?(?:%|percent\b)/gu, m => add('percent', String(Number(m[1])), m.index, m[0]))
  // v16.20.2 · 3.11.4
  // (page text can run a version into the next word: nodejs.org's "v24.21.0Latest LTS")
  scan(/(?<![\d.])v?(\d+\.\d+(?:\.\d+)+)(?![\d]|\.\d)/gu, m => add('version', m[1]!, m.index, m[0]))
  // Space-grouped thousands, as many statistics offices write them (SSB: "5 594 340")
  scan(/(?<![\d.,])(\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?![\d.,]?\d)/gu, m => add('number', String(Number(m[1]!.replace(/[ \u00a0\u202f]/gu, ''))), m.index, m[0]))
  // Version majors written with a v ("v24", "v16"): the number the claim's "Node.js 24" names
  scan(/\bv(\d+)\b/giu, m => add('number', String(Number(m[1])), m.index, m[0]))
  // Standalone years
  scan(/\b((?:19|20)\d{2})\b/gu, m => add('year', m[1]!, m.index, m[0]))
  // Other figures of two or more digits (1,234 · 12.5 · 45)
  scan(/\b(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{2,}(?:\.\d+)?|\d+\.\d+)\b/gu, m => add('number', String(Number(m[1]!.replace(/,/gu, ''))), m.index, m[0]))
  found.sort((left, right) => left.at - right.at)
  const seen = new Set<string>()
  return found.filter(item => { const key = `${item.kind}:${item.value}`; if (seen.has(key)) return false; seen.add(key); return true })
    .map(({ kind, value, text }) => ({ kind, value, text }))
}

function legacyPresent(specific: Specific, evidence: Specific[]): boolean {
  return evidence.some(candidate => {
    if (specific.kind === 'date') return candidate.kind === 'date' && candidate.value === specific.value
    if (specific.kind === 'month') return (candidate.kind === 'month' && candidate.value === specific.value) || (candidate.kind === 'date' && candidate.value.startsWith(specific.value + '-'))
    if (specific.kind === 'year') return (candidate.kind === 'year' || candidate.kind === 'number') && candidate.value === specific.value || ((candidate.kind === 'date' || candidate.kind === 'month') && candidate.value.startsWith(specific.value))
    if (specific.kind === 'amount' || specific.kind === 'number' || specific.kind === 'percent') return ['amount', 'number', 'percent', 'year'].includes(candidate.kind) && Number(candidate.value) === Number(specific.value)
    if (specific.kind === 'version') return candidate.kind === 'version' && candidate.value === specific.value
    return false
  })
}

// ---------------------------------------------------------------------------
// Typed parsing.

/** Units a measured figure may carry, with the dimension it measures and its factor to that dimension's base unit. */
const units: Array<{ pattern: string; unit: string; dimension: string; factor: number }> = [
  { pattern: 'kilomet(?:er|re)s?|km', unit: 'km', dimension: 'length', factor: 1000 },
  { pattern: 'centimet(?:er|re)s?|cm', unit: 'cm', dimension: 'length', factor: 0.01 },
  { pattern: 'millimet(?:er|re)s?|mm', unit: 'mm', dimension: 'length', factor: 0.001 },
  { pattern: 'met(?:er|re)s?', unit: 'm', dimension: 'length', factor: 1 },
  { pattern: 'miles?|mi', unit: 'mi', dimension: 'length', factor: 1609.344 },
  { pattern: 'feet|foot|ft', unit: 'ft', dimension: 'length', factor: 0.3048 },
  { pattern: 'inch(?:es)?', unit: 'in', dimension: 'length', factor: 0.0254 },
  { pattern: 'yards?|yd', unit: 'yd', dimension: 'length', factor: 0.9144 },
  { pattern: 'kilograms?|kgs?', unit: 'kg', dimension: 'mass', factor: 1 },
  { pattern: 'milligrams?|mg', unit: 'mg', dimension: 'mass', factor: 1e-6 },
  { pattern: 'grams?|g', unit: 'g', dimension: 'mass', factor: 0.001 },
  { pattern: 'pounds?|lbs?', unit: 'lb', dimension: 'mass', factor: 0.45359237 },
  { pattern: 'ounces?|oz', unit: 'oz', dimension: 'mass', factor: 0.028349523125 },
  { pattern: 'tonnes?|metric tons?', unit: 't', dimension: 'mass', factor: 1000 },
  { pattern: 'milliseconds?|ms', unit: 'ms', dimension: 'time', factor: 0.001 },
  { pattern: 'seconds?|secs?', unit: 's', dimension: 'time', factor: 1 },
  { pattern: 'minutes?|mins?', unit: 'min', dimension: 'time', factor: 60 },
  { pattern: 'hours?|hrs?|h', unit: 'h', dimension: 'time', factor: 3600 },
  { pattern: 'days?', unit: 'day', dimension: 'time', factor: 86400 },
  { pattern: 'weeks?|wks?', unit: 'week', dimension: 'time', factor: 604800 },
  // Calendar months and years vary in length; a month is never 30 days for this check.
  { pattern: 'months?', unit: 'month', dimension: 'calendar', factor: 1 },
  { pattern: 'years?|yrs?', unit: 'year', dimension: 'calendar', factor: 12 },
  { pattern: 'kilobytes?|kb', unit: 'KB', dimension: 'data', factor: 1e3 },
  { pattern: 'megabytes?|mb', unit: 'MB', dimension: 'data', factor: 1e6 },
  { pattern: 'gigabytes?|gb', unit: 'GB', dimension: 'data', factor: 1e9 },
  { pattern: 'terabytes?|tb', unit: 'TB', dimension: 'data', factor: 1e12 },
  { pattern: 'millilit(?:er|re)s?|ml', unit: 'ml', dimension: 'volume', factor: 0.001 },
  { pattern: 'lit(?:er|re)s?', unit: 'l', dimension: 'volume', factor: 1 },
  { pattern: 'gallons?|gal', unit: 'gal', dimension: 'volume', factor: 3.785411784 },
  { pattern: '°\\s?c|degrees? c(?:elsius)?|celsius', unit: '°C', dimension: 'celsius', factor: 1 },
  { pattern: '°\\s?f|degrees? f(?:ahrenheit)?|fahrenheit', unit: '°F', dimension: 'fahrenheit', factor: 1 },
]
const unitPattern = units.map(entry => entry.pattern).join('|')
const unitFor = (written: string) => {
  const value = written.toLowerCase().replace(/\s+/gu, ' ')
  return units.find(entry => new RegExp(`^(?:${entry.pattern})$`, 'iu').test(value)) ?? null
}
const unitInfo = (unit: string | undefined) => unit ? units.find(entry => entry.unit === unit) ?? null : null

const magnitudes: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12 }
const magnitudePattern = '(?:thousand|million|billion|trillion|mn|bn|tn|[kmbt])'
const scaled = (digits: string, magnitude?: string) => {
  const value = Number(digits.replace(/[,\s\u00a0\u202f]/gu, ''))
  const factor = magnitude ? magnitudes[magnitude.toLowerCase()] ?? 1 : 1
  return canonicalNumber(value * factor)
}
const canonicalNumber = (value: number) => String(Number(value.toPrecision(12)))

const currencies: Array<[RegExp, string]> = [
  [/^(?:us\$|usd)$/iu, 'USD'], [/^(?:c\$|ca\$|cad)$/iu, 'CAD'], [/^(?:a\$|au\$|aud)$/iu, 'AUD'], [/^\$$/u, 'USD'],
  [/^(?:€|eur|euros?)$/iu, 'EUR'], [/^(?:£|gbp)$/iu, 'GBP'], [/^(?:¥|jpy|yen)$/iu, 'JPY'], [/^(?:₹|inr|rupees?)$/iu, 'INR'],
  [/^(?:chf)$/iu, 'CHF'], [/^(?:dollars?)$/iu, 'USD'],
]
const currencyFor = (written: string) => currencies.find(([pattern]) => pattern.test(written.trim()))?.[1] ?? 'USD'

const spelled: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const spelledPattern = '(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\\s](?:one|two|three|four|five|six|seven|eight|nine))?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)'
const spelledValue = (written: string) => written.toLowerCase().split(/[-\s]+/u).reduce((sum, word) => sum + (spelled[word] ?? 0), 0)
const countWord = (written: string) => /^(?:a|an|one)$/iu.test(written) ? 1 : /^\d+$/u.test(written) ? Number(written) : spelledValue(written)

/** Words that make a two-part number a version ("Python 3.10", "PHP 8.1", "Branch: 8.1"), not a decimal. */
const versionCue = /(?:\b(?:versions?|release[sd]?|releasing|v|ver|python|php|node(?:\.js)?|nodejs|linux|kernel|django|rust|rustc|ruby|rails|go|golang|java|jdk|ubuntu|debian|fedora|rhel|centos|postgres(?:ql)?|mysql|mariadb|ios|ipados|macos|android|windows|lts|branch|series|laravel|react|angular|vue|swift|kotlin|scala|perl|\.net|gcc|clang|llvm|openssl|nginx|apache|redis|mongodb|elasticsearch|kubernetes|k8s|docker|typescript|firefox|chrome|safari|electron|dotnet|symfony|spring|pandas|numpy|tensorflow|pytorch|update|patch|build|upgrade)\b[\s:–-]*(?:is\s+|was\s+|of\s+|to\s+)?|\bv)$/iu

const toDate = (reference: SpecificOptions['now']): Date | null => {
  if (reference === null || reference === undefined) return null
  const date = reference instanceof Date ? reference : new Date(reference)
  return Number.isFinite(date.getTime()) ? date : null
}
const isoDay = (date: Date) => date.toISOString().slice(0, 10)
const shiftMonths = (date: Date, months: number) => { const next = new Date(date.getTime()); next.setUTCMonth(next.getUTCMonth() + months); return next }

function typedSpecifics(text: string, options: SpecificOptions): Specific[] {
  const found: Array<Specific & { at: number; end: number }> = []
  const taken = (start: number, end: number) => found.some(item => start < item.end && end > item.at)
  const add = (specific: Specific, at: number, raw: string) => {
    if (!taken(at, at + raw.length)) found.push({ ...specific, text: raw.trim(), at, end: at + raw.length })
  }
  let match: RegExpExecArray | null
  const scan = (pattern: RegExp, handle: (match: RegExpExecArray) => void) => { pattern.lastIndex = 0; while ((match = pattern.exec(text))) handle(match) }
  const now = toDate(options.now)
  const year = (written: string) => written.length === 2 ? (Number(written) <= 69 ? 2000 : 1900) + Number(written) : Number(written)

  // Relative dates first, so "8 months ago" is not read as a duration.
  if (now) {
    const count = `(\\d+|a|an|${spelledPattern})`
    const span = '(years?|months?|weeks?|days?|hours?)'
    scan(new RegExp(`\\b${count}\\s+${span}(?:,?\\s+(?:and\\s+)?${count}\\s+${span})?\\s+ago\\b`, 'giu'), m => {
      const parts = [[m[1], m[2]], [m[3], m[4]]].filter(([n, unit]) => n && unit).map(([n, unit]) => ({ n: countWord(n!), unit: unit!.toLowerCase().replace(/s$/u, '') }))
      const monthsBack = parts.reduce((sum, part) => sum + (part.unit === 'year' ? part.n * 12 : part.unit === 'month' ? part.n : 0), 0)
      const daysBack = parts.reduce((sum, part) => sum + (part.unit === 'week' ? part.n * 7 : part.unit === 'day' ? part.n : 0), 0)
      const smallest = parts.at(-1)!.unit
      // "8 months ago" is how a page writes anything from 8 to just under 9 months back; a day either side for time zones.
      const day = 86_400_000
      let from: Date, to: Date
      if (monthsBack > 0 && daysBack === 0) {
        const step = smallest === 'year' ? 12 : 1
        from = new Date(shiftMonths(now, -(monthsBack + step)).getTime() - day); to = new Date(shiftMonths(now, -monthsBack).getTime() + day)
      } else {
        const step = smallest === 'week' ? 7 : 1
        const back = shiftMonths(now, -monthsBack).getTime() - daysBack * day
        from = new Date(back - step * day - day); to = new Date(back + day)
      }
      add({ kind: 'relative', value: `${isoDay(from)}..${isoDay(to)}`, text: '' }, m.index, m[0])
    })
    scan(/\b(yesterday|today)\b/giu, m => {
      const days = m[1]!.toLowerCase() === 'yesterday' ? 1 : 0
      add({ kind: 'relative', value: `${isoDay(new Date(now.getTime() - 86_400_000 * (days + 1)))}..${isoDay(new Date(now.getTime() - 86_400_000 * Math.max(0, days - 1)))}`, text: '' }, m.index, m[0])
    })
  }
  // 2023-09-11, 2023/09/11, 2023.09.11
  scan(/\b((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/gu, m => {
    const month = Number(m[2]), day = Number(m[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) add({ kind: 'date', value: `${m[1]}-${pad(month)}-${pad(day)}`, text: '' }, m.index, m[0])
  })
  // September 11, 2023 · Sep 11 2023 · Sept. 11th, 2023
  scan(new RegExp(`\\b${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+((?:19|20)\\d{2})\\b`, 'giu'), m => {
    const month = monthIndex(m[1]!), day = Number(m[2])
    if (month && day >= 1 && day <= 31) add({ kind: 'date', value: `${m[3]}-${pad(month)}-${pad(day)}`, text: '' }, m.index, m[0])
  })
  // 11 September 2023 · 31 Dec 2025
  scan(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${monthPattern},?\\s+((?:19|20)\\d{2})\\b`, 'giu'), m => {
    const month = monthIndex(m[2]!), day = Number(m[1])
    if (month && day >= 1 && day <= 31) add({ kind: 'date', value: `${m[3]}-${pad(month)}-${pad(day)}`, text: '' }, m.index, m[0])
  })
  // 09/11/2023 · 11.09.2023 · 9/11/23: day-first or month-first only when a part exceeds 12, otherwise unresolved.
  // (A two-digit year only with slashes: "4.2.30" is a version.)
  scan(/(?<![\d/.-])(\d{1,2})([/.-])(\d{1,2})\2((?:19|20)\d{2}|\d{2})(?![\d/.-]?\d)/gu, m => {
    if (m[4]!.length === 2 && m[2] !== '/') return
    const first = Number(m[1]), second = Number(m[3]), y = year(m[4]!)
    if (first < 1 || second < 1 || first > 31 || second > 31 || (first > 12 && second > 12)) return
    if (first > 12) add({ kind: 'date', value: `${y}-${pad(second)}-${pad(first)}`, text: '' }, m.index, m[0])
    else if (second > 12 || first === second) add({ kind: 'date', value: `${y}-${pad(first)}-${pad(second)}`, text: '' }, m.index, m[0])
    else add({ kind: 'date', value: `ambiguous:${y}:${[first, second].map(pad).join('/')}`, text: '', ambiguous: true }, m.index, m[0])
  })
  // Sunday, September 27th · Sept. 27 · 27 September — a date written without its year, as schedules and event pages
  // write this season's dates (a sports schedule page: "Team A at Team B, Sunday, September 27th" never matched
  // the same date with a year, and a correct kickoff date was dropped). Read only against a known time, as the occurrence
  // nearest it; a weekday written with it must fall on that date, or the date is not read at all.
  // STEWARD_YEARLESS_DATES=off.
  if (now && process.env.STEWARD_YEARLESS_DATES?.trim().toLowerCase() !== 'off') {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const weekdayPattern = '(Sun(?:day)?|Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:rs(?:day)?)?|Fri(?:day)?|Sat(?:urday)?)\\.?'
    const resolve = (month: number, day: number, weekday: string | undefined): string | null => {
      const wanted = weekday ? weekdays.findIndex(name => name.startsWith(weekday.toLowerCase().replace(/\.$/u, '').slice(0, 3))) : -1
      const candidates = [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1]
        .map(y => new Date(Date.UTC(y, month - 1, day)))
        .filter(date => date.getUTCMonth() === month - 1 && (wanted < 0 || date.getUTCDay() === wanted))
        .sort((a, b) => Math.abs(a.getTime() - now.getTime()) - Math.abs(b.getTime() - now.getTime()))
      // Without a weekday, only a date within half a year of the time it was read is unambiguous enough to place.
      const best = candidates[0]
      if (!best || (wanted < 0 && Math.abs(best.getTime() - now.getTime()) > 183 * 86_400_000)) return null
      return `${best.getUTCFullYear()}-${pad(month)}-${pad(day)}`
    }
    scan(new RegExp(`(?:\\b${weekdayPattern},?\\s+)?\\b${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!,?\\s*(?:[''’]?\\d{2}\\b|(?:19|20)\\d{2}\\b|:))`, 'giu'), m => {
      const month = monthIndex(m[2]!), day = Number(m[3])
      const value = month && day >= 1 && day <= 31 ? resolve(month, day, m[1]) : null
      if (value) add({ kind: 'date', value, text: '' }, m.index, m[0])
    })
    scan(new RegExp(`(?:\\b${weekdayPattern},?\\s+)?\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${monthPattern}\\b(?!,?\\s*(?:[''’]?\\d{2}\\b|(?:19|20)\\d{2}\\b))`, 'giu'), m => {
      const month = monthIndex(m[3]!), day = Number(m[2])
      const value = month && day >= 1 && day <= 31 ? resolve(month, day, m[1]) : null
      if (value) add({ kind: 'date', value, text: '' }, m.index, m[0])
    })
  }
  // Q4 2027 · Q4'27 · 4Q 2027 · fourth quarter of 2027
  scan(/\b(?:Q([1-4])\s*(?:of\s+)?(?:FY\s*)?[''’]?((?:19|20)\d{2}|\d{2})|([1-4])Q\s*[''’]?((?:19|20)\d{2}|\d{2}))\b/gu, m => {
    const quarter = m[1] ?? m[3]!, y = year(m[2] ?? m[4]!)
    add({ kind: 'quarter', value: `${y}-Q${quarter}`, text: '' }, m.index, m[0])
  })
  scan(/\b(first|second|third|fourth|1st|2nd|3rd|4th)\s+quarter\s+(?:of\s+)?((?:19|20)\d{2})\b/giu, m => {
    const quarter = ({ first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4 } as Record<string, number>)[m[1]!.toLowerCase()]!
    add({ kind: 'quarter', value: `${m[2]}-Q${quarter}`, text: '' }, m.index, m[0])
  })
  // September 2023 · Dec, 2027 (kernel.org's "Projected EOL: Dec, 2027") · Dec '27
  scan(new RegExp(`\\b${monthPattern},?\\s+(?:((?:19|20)\\d{2})\\b|[''’](\\d{2})\\b)`, 'giu'), m => {
    const month = monthIndex(m[1]!)
    if (month) add({ kind: 'month', value: `${m[2] ?? year(m[3]!)}-${pad(month)}`, text: '' }, m.index, m[0])
  })
  // 2027-12 · 2027/12 (not a date: that was read above)
  scan(/(?<![\d.])((?:19|20)\d{2})[-/](\d{1,2})(?![\d]|[-/.]\d)/gu, m => {
    const month = Number(m[2])
    if (month >= 1 && month <= 12) add({ kind: 'month', value: `${m[1]}-${pad(month)}`, text: '' }, m.index, m[0])
  })
  // 12/2027 · 12-2027
  scan(/(?<![\d/.-])(\d{1,2})[/-]((?:19|20)\d{2})(?![\d]|[-/.]\d)/gu, m => {
    const month = Number(m[1])
    if (month >= 1 && month <= 12) add({ kind: 'month', value: `${m[2]}-${pad(month)}`, text: '' }, m.index, m[0])
  })
  // $1,299.99 · €45 · USD 12 · US$1.2 billion · $5M · 49 euros
  scan(new RegExp(`(?:(US\\$|C\\$|CA\\$|A\\$|AU\\$|[$€£¥₹])|\\b(USD|EUR|GBP|CAD|AUD|JPY|INR|CHF)\\s?)\\s?(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)(?:\\s?(${magnitudePattern})\\b)?`, 'giu'), m => {
    add({ kind: 'amount', value: scaled(m[3]!, m[4]), unit: currencyFor(m[1] ?? m[2]!), text: '' }, m.index, m[0])
  })
  scan(new RegExp(`(?<![\\d.,])(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)(?:\\s?(${magnitudePattern})\\b)?\\s?(USD|EUR|GBP|CAD|AUD|JPY|INR|CHF|dollars?|euros?|yen|rupees?)\\b`, 'giu'), m => {
    add({ kind: 'amount', value: scaled(m[1]!, m[2]), unit: currencyFor(m[3]!), text: '' }, m.index, m[0])
  })
  // 12.5% · 12.5 percent
  scan(/(?<![\d.])(\d+(?:\.\d+)?)\s?(?:%|per\s?cent\b|pct\b)/giu, m => add({ kind: 'percent', value: canonicalNumber(Number(m[1])), text: '' }, m.index, m[0]))
  // v16.20.2 · 3.11.4 (page text can run a version into the next word: nodejs.org's "v24.21.0Latest LTS")
  scan(/(?<![\d.])v?(\d+\.\d+(?:\.\d+)+)(?![\d]|\.\d)/gu, m => add({ kind: 'version', value: m[1]!, text: '' }, m.index, m[0]))
  // Space-grouped thousands, as many statistics offices write them (SSB: "5 594 340")
  scan(/(?<![\d.,])(\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?![\d.,]?\d)/gu, m => add({ kind: 'number', value: scaled(m[1]!), text: '' }, m.index, m[0]))
  // Version majors written with a v ("v24", "v16"): the number the claim's "Node.js 24" names
  scan(/\bv(\d+)\b/giu, m => add({ kind: 'number', value: String(Number(m[1])), text: '' }, m.index, m[0]))
  // Measured figures: 42 km · 26.2 miles · 1.5 hours · five-year · 2 GB
  const figure = `(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?${options.smallNumbers ? `|${spelledPattern}` : ''})`
  scan(new RegExp(`(?<![\\d.,\\p{L}])${figure}(?:\\s?(${magnitudePattern})\\b)?(?:\\s|-|\\u00a0)?(${unitPattern})(?![\\p{L}])`, 'giu'), m => {
    const unit = unitFor(m[3]!)
    if (!unit) return
    // A bare "5 m"/"4 g"/"3 h"/"2 mi" single letter needs a digit right before it; "a 5-minute walk" is fine.
    const value = /^\d/u.test(m[1]!) ? scaled(m[1]!, m[2]) : canonicalNumber(spelledValue(m[1]!) * (m[2] ? magnitudes[m[2].toLowerCase()] ?? 1 : 1))
    add({ kind: 'number', value, unit: unit.unit, text: '' }, m.index, m[0])
  })
  // Standalone years
  scan(/\b((?:19|20)\d{2})\b/gu, m => add({ kind: 'year', value: m[1]!, text: '' }, m.index, m[0]))
  // 1.2 million · 5k · 3 billion (no unit)
  scan(new RegExp(`(?<![\\d.,])(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)\\s?(${magnitudePattern})\\b`, 'giu'), m => {
    // "5 m" alone is metres or minutes as often as millions: a single-letter magnitude must touch the digits.
    if (/^[mbt]$/iu.test(m[2]!) && /\s/u.test(m[0])) return
    add({ kind: 'number', value: scaled(m[1]!, m[2]), text: '' }, m.index, m[0])
  })
  // Two-part versions: "Python 3.10", "PHP 8.1", "Branch: 8.1", "v3.1", "3.10.x"
  scan(/(?<![\d.])(v?)(\d+\.\d+)(\.x\b)?(?![\d]|\.\d)/giu, m => {
    const before = text.slice(Math.max(0, m.index - 32), m.index)
    if (m[1] || m[3] || versionCue.test(before)) add({ kind: 'version', value: m[2]!, text: '' }, m.index, m[0])
  })
  // Other figures of two or more digits (1,234 · 12.5 · 45)
  scan(/\b(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{2,}(?:\.\d+)?|\d+\.\d+)\b/gu, m => add({ kind: 'number', value: scaled(m[1]!), text: '' }, m.index, m[0]))
  if (options.smallNumbers) {
    scan(/(?<![\d.,])(\d)(?![\d.,]?\d)/gu, m => add({ kind: 'number', value: m[1]!, text: '' }, m.index, m[0]))
    scan(new RegExp(`\\b${spelledPattern}\\b`, 'giu'), m => add({ kind: 'number', value: String(spelledValue(m[0])), text: '' }, m.index, m[0]))
  }
  found.sort((left, right) => left.at - right.at)
  // A relative date written beside the absolute one ("31 Dec 2025 (8 months ago)") only restates it, less precisely.
  const restated = (item: typeof found[number]) => item.kind === 'relative' && found.some(other => other.kind === 'date' && !other.ambiguous && other.end <= item.at && item.at - other.end <= 4)
  const seen = new Set<string>()
  return found.filter(item => { if (restated(item)) return false; const key = `${item.kind}:${item.value}:${item.unit ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true })
    .map(({ at: _at, end: _end, ...specific }) => specific)
}

const sameNumber = (left: string, right: string) => {
  const a = Number(left), b = Number(right)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
}
const dayIn = (day: string, range: string) => { const [from, to] = range.split('..'); return day >= from! && day <= to! }
const rangesOverlap = (left: string, right: string) => { const [a, b] = left.split('..'), [c, d] = right.split('..'); return a! <= d! && c! <= b! }
const monthRange = (month: string) => `${month}-01..${month}-31`
const quarterOf = (month: string) => `${month.slice(0, 4)}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}`
/** A bare figure's written digits ("8.1" in "8.1 or later"), for comparing against a version. */
const writtenDigits = (specific: Specific) => specific.text.replace(/^v/iu, '').replace(/,/gu, '')

function typedMatch(claim: Specific, evidence: Specific): boolean {
  switch (claim.kind) {
    case 'date':
      if (claim.ambiguous) return evidence.kind === 'date' && evidence.value === claim.value
      return (evidence.kind === 'date' && evidence.value === claim.value) || (evidence.kind === 'relative' && dayIn(claim.value, evidence.value))
    case 'month':
      return (evidence.kind === 'month' && evidence.value === claim.value) || (evidence.kind === 'date' && !evidence.ambiguous && evidence.value.startsWith(claim.value + '-'))
        || (evidence.kind === 'relative' && rangesOverlap(monthRange(claim.value), evidence.value))
    case 'quarter':
      return (evidence.kind === 'quarter' && evidence.value === claim.value) || ((evidence.kind === 'month' || (evidence.kind === 'date' && !evidence.ambiguous)) && quarterOf(evidence.value.slice(0, 7)) === claim.value)
    case 'relative':
      return (evidence.kind === 'relative' && rangesOverlap(claim.value, evidence.value)) || (evidence.kind === 'date' && !evidence.ambiguous && dayIn(evidence.value, claim.value))
        || (evidence.kind === 'month' && rangesOverlap(monthRange(evidence.value), claim.value))
    case 'year':
      return ((evidence.kind === 'year' || (evidence.kind === 'number' && !evidence.unit)) && evidence.value === claim.value)
        || ((evidence.kind === 'date' && !evidence.ambiguous) || evidence.kind === 'month' || evidence.kind === 'quarter') && evidence.value.startsWith(claim.value)
        || (evidence.kind === 'date' && evidence.ambiguous === true && evidence.value.startsWith(`ambiguous:${claim.value}:`))
    case 'amount':
      // A bare figure may take its currency from a column header ("Price (USD): 49"); a different currency, a percentage or a measured figure never supports it.
      return (evidence.kind === 'amount' && evidence.unit === claim.unit && sameNumber(evidence.value, claim.value)) || (evidence.kind === 'number' && !evidence.unit && sameNumber(evidence.value, claim.value))
    case 'percent':
      return (evidence.kind === 'percent' || (evidence.kind === 'number' && !evidence.unit)) && sameNumber(evidence.value, claim.value)
    case 'version':
      return (evidence.kind === 'version' && evidence.value === claim.value) || (evidence.kind === 'number' && !evidence.unit && writtenDigits(evidence) === claim.value)
    case 'number': {
      if (claim.unit) {
        if (evidence.kind === 'number' && !evidence.unit) return sameNumber(evidence.value, claim.value)
        if (evidence.kind !== 'number' || !evidence.unit) return false
        if (evidence.unit === claim.unit) return sameNumber(evidence.value, claim.value)
        const left = unitInfo(claim.unit), right = unitInfo(evidence.unit)
        if (!left || !right || left.dimension !== right.dimension) return false
        // A converted figure is rounded when written ("26.2 miles" for 42.195 km, "2.6 lb" for 1.2 kg): within half
        // of the claim's last written digit, or 0.5%.
        const a = Number(claim.value) * left.factor, b = Number(evidence.value) * right.factor
        const decimals = /\.(\d+)/u.exec(claim.text.replace(/,/gu, ''))?.[1]?.length ?? 0
        return Math.abs(a - b) <= Math.max(0.005 * Math.abs(b), 0.5 * 10 ** -decimals * left.factor)
      }
      // A bare figure in the claim: the same figure bare, as a year, as a measured figure, or as the digits of a version.
      if (evidence.kind === 'number' || evidence.kind === 'year') return sameNumber(evidence.value, claim.value)
      // A whole number names a release line the page writes in full: "Node.js 24" is the 24 of "v24.21.0".
      if (evidence.kind === 'version') return evidence.value === writtenDigits(claim) || (/^\d+$/u.test(claim.value) && evidence.value.startsWith(claim.value + '.'))
      return false
    }
  }
}
