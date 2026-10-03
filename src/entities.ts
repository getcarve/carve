/**
 * Entity extraction over recalled moments.
 *
 * Deterministic and local: no model, no network, no configuration. It turns a
 * window title and any recognised text into the handful of things a person
 * would name when describing what they were doing — who, which organisation,
 * which document, which reference number.
 *
 * These entities live in their own store, deliberately separate from
 * `memory_entities`. That table feeds procedure retrieval and planning, and
 * native observation is barred from reaching either. Keeping recall's entities
 * out of it makes that boundary structural rather than incidental.
 *
 * Precision is preferred over recall throughout. A noisy list of "people" that
 * is mostly product names is worse than a short, correct one, so every rule
 * here fails closed on ambiguity.
 */
import { createHash } from 'node:crypto'

export type RecallEntityKind = 'person' | 'organization' | 'document' | 'identifier' | 'application'

export interface ExtractedEntity {
  kind: RecallEntityKind
  name: string
  normalized: string
}

export interface RecallEntity extends ExtractedEntity {
  id: string
  firstSeenAt: string
  lastSeenAt: string
  mentionCount: number
}

/** Words that make a capitalised phrase a product, place, or UI chrome — not a person. */
const notPeople = new Set([
  'google', 'chrome', 'safari', 'firefox', 'gmail', 'inbox', 'mail', 'outlook', 'slack', 'zoom',
  'search', 'news', 'wikipedia', 'youtube', 'github', 'jira', 'notion', 'figma', 'preview',
  'finder', 'terminal', 'settings', 'system', 'desktop', 'downloads', 'documents', 'untitled',
  'new', 'tab', 'window', 'page', 'home', 'dashboard', 'portal', 'billing', 'invoices', 'invoice',
  'account', 'login', 'log', 'sign', 'welcome', 'today', 'yesterday', 'draft', 'drafts', 'sent',
  're', 'fwd', 'am', 'pm', 'the', 'and', 'for', 'from', 'with', 'about', 'missing', 'payment',
  'overdue', 'request', 'report', 'summary', 'notes', 'meeting', 'calendar', 'general', 'random',
  'steward', 'electron', 'observing', 'hacker', 'acme', 'customer', 'plans', 'lunch', 'standup',
  'board', 'submit', 'limerick', 'write',
])

/**
 * Containers that mean the title names a topic rather than a correspondent.
 * "Some Lake - Wikipedia" is an article; a word list of place names could
 * never keep up, but the container it sits in is a reliable tell.
 */
const referenceContainers = new Set(['wikipedia', 'wiki', 'google search', 'search', 'news', 'hacker news', 'youtube', 'reddit', 'stack overflow', 'imdb', 'docs'])

/**
 * Relational cues that make the following capitalised run a person. The cue must
 * be the *entire* preamble, not merely present in it: "From: Jane Okafor" names
 * a correspondent, while "Log In to Acme Benefits" does not.
 */
const cueWords = new Set(['from', 'to', 'with', 'cc', 'bcc', 're', 'fwd', 'dm', 'call', 'meeting', 'message', 'messaged', 'email', 'emailed', 'sender', 'assigned'])
const strongCues = new Set(['from', 'cc', 'bcc', 'dm', 'sender', 'assigned', 'call', 'meeting', 'message', 'messaged', 'email', 'emailed'])

function isPersonCue(prefix: string): boolean {
  const tokens = prefix.toLowerCase().split(/[^a-z]+/u).filter(Boolean)
  if (tokens.length === 0 || tokens.length > 3) return false
  if (!tokens.every((token) => cueWords.has(token))) return false
  return tokens.some((token) => strongCues.has(token))
}

/** Matches the organisation name itself, wherever it sits in a longer line. */
const organizationNames = /\b((?:[A-ZÀ-Ÿ][\wÀ-ÿ&'’-]*\s+){0,3}[A-ZÀ-Ÿ][\wÀ-ÿ&'’-]*\s+(?:Inc|LLC|Ltd|Limited|Corp|Corporation|GmbH|PLC)\.?)(?=\s|$|[.,;])/gu
const documentExtensions = /\b([\w][\w -]{0,60}\.(?:pdf|docx?|xlsx?|pptx?|csv|txt|md|key|numbers|pages))\b/giu
const identifiers = /\b((?:inv|po|tkt|ord|ref|case|acct)[-\s#]?\d{2,}|[A-Z]{2,5}-\d{2,}|(?:invoice|order|ticket|account|customer)\s+#?\d{2,})\b/giu
const titleSplit = /\s+[-—|·:]\s+|\s*[()]\s*/u

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, ' ').trim()
}

export function entityId(kind: RecallEntityKind, normalized: string): string {
  return `ent_${kind}_${createHash('sha256').update(normalized).digest('hex').slice(0, 12)}`
}

function isCapitalizedWord(word: string): boolean {
  return /^[A-Z][a-zà-ÿA-ZÀ-Ÿ'’-]{1,}$/u.test(word)
}

/**
 * A person is a run of two or three capitalised words, none of which is a
 * product, place, or UI word. Anything else is left unclaimed rather than
 * guessed at.
 */
function peopleIn(segment: string): string[] {
  const words = segment.trim().split(/\s+/u)
  const found: string[] = []
  for (let start = 0; start < words.length; start += 1) {
    for (const length of [3, 2]) {
      const run = words.slice(start, start + length)
      if (run.length < length) continue
      if (!run.every((word) => isCapitalizedWord(word))) continue
      if (run.some((word) => notPeople.has(word.toLowerCase()))) continue
      found.push(run.join(' '))
      start += length - 1
      break
    }
  }
  return found
}

export function extractEntities(app: string, title: string, text = ''): ExtractedEntity[] {
  const found = new Map<string, ExtractedEntity>()
  const add = (kind: RecallEntityKind, rawName: string) => {
    const name = rawName.trim().replace(/\s+/gu, ' ')
    if (name.length < 2 || name.length > 80) return
    const normalized = normalize(name)
    if (!normalized) return
    const id = entityId(kind, normalized)
    if (!found.has(id)) found.set(id, { kind, name, normalized })
  }

  if (app.trim()) add('application', app)

  const haystack = `${title}\n${text}`
  for (const match of haystack.matchAll(documentExtensions)) if (match[1]) add('document', match[1])
  for (const match of haystack.matchAll(identifiers)) if (match[1]) add('identifier', match[1])

  const titleSegments = title.split(titleSplit).map((segment) => segment.trim()).filter(Boolean)
  const textSegments = text.split(/[\n,;]/u).map((segment) => segment.trim()).filter(Boolean)
  const container = normalize(titleSegments[titleSegments.length - 1] ?? '')
  const isReference = referenceContainers.has(container)

  for (const match of haystack.matchAll(organizationNames)) {
    if (match[1] && normalize(match[1]) !== normalize(app)) add('organization', match[1])
  }

  // Path 1: a segment that is entirely a name, inside a structured title such as
  // "Missing payment — Jane Okafor — Inbox". Requires a container segment, so a
  // bare page title like "Acme Benefits" is never claimed as a person.
  if (!isReference && titleSegments.length >= 3) {
    for (const segment of titleSegments) {
      if (normalize(segment) === normalize(app)) continue
      const people = peopleIn(segment)
      if (people.length === 1 && people[0] === segment) add('person', segment)
    }
  }

  // Path 2: an explicit relational cue, which works anywhere including free text.
  for (const segment of [...titleSegments, ...textSegments]) {
    for (const match of segment.matchAll(/([A-Za-zÀ-ÿ']+[:\s]+)?([A-ZÀ-Ÿ][\wÀ-ÿ'’-]+(?:\s+[A-ZÀ-Ÿ][\wÀ-ÿ'’-]+){1,2})/gu)) {
      const prefix = segment.slice(0, match.index ?? 0) + (match[1] ?? '')
      const phrase = match[2]
      if (!phrase || !isPersonCue(prefix)) continue
      if (peopleIn(phrase).includes(phrase)) add('person', phrase)
    }
  }

  return [...found.values()]
}
