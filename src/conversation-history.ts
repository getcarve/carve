/**
 * What was said in one conversation, keyed by the conversation's own identity rather than by the clock.
 *
 * Two kinds of record make a conversation: task runs (the database keeps their goal and result) and answers Carve gave in
 * the capsule without a run (the guide route, which left nothing durable until now). A run is bound to the conversation
 * that started it; a follow-up inherits its parent run's conversation, so a pause of any length does not split it and an
 * unrelated task started minutes later is never pulled in. The record is persisted through the settings table so an app
 * restart keeps it. It is bounded, and the reader is told what was left out.
 */
export interface ConversationExchange { at: string; user: string; answer: string; conversationId: string; turnId?: string }

export interface HistoryStore { load(): string | null; save(value: string): void }

export interface SeenPage { url: string; title: string | null }
interface Persisted { exchanges: ConversationExchange[]; runs: Record<string, string>; aliases: Record<string, string>; pages?: Record<string, SeenPage[]> }

const perConversationLimit = 60
const totalLimit = 240
const runLimit = 400

let exchanges: ConversationExchange[] = []
let runs = new Map<string, string>()
let aliases = new Map<string, string>()
let pages = new Map<string, SeenPage[]>()
let store: HistoryStore | null = null

function persist(): void {
  if (!store) return
  try {
    const payload: Persisted = { exchanges, runs: Object.fromEntries(runs), aliases: Object.fromEntries(aliases), pages: Object.fromEntries(pages) }
    store.save(JSON.stringify(payload))
  } catch { /* the in-memory record still serves this process */ }
}

/** Attach durable storage and load what an earlier process recorded. */
export function attachConversationHistoryStore(next: HistoryStore | null): void {
  store = next
  if (!next) return
  try {
    const raw = next.load()
    if (!raw) return
    const parsed = JSON.parse(raw) as Partial<Persisted>
    exchanges = Array.isArray(parsed.exchanges) ? parsed.exchanges.filter(e => e && typeof e.user === 'string' && typeof e.answer === 'string' && typeof e.conversationId === 'string') : []
    runs = new Map(Object.entries(parsed.runs ?? {}))
    aliases = new Map(Object.entries(parsed.aliases ?? {}))
    pages = new Map(Object.entries(parsed.pages ?? {}))
  } catch { exchanges = []; runs = new Map(); aliases = new Map(); pages = new Map() }
}

/** The conversation an id belongs to after any merges (a follow-up after a long pause joins its parent's). */
export function resolveConversation(id: string): string {
  let current = id
  for (let hops = 0; hops < 8; hops++) {
    const next = aliases.get(current)
    if (!next || next === current) break
    current = next
  }
  return current
}

/** Make `from` part of `into`; every exchange recorded under either is read as one conversation. */
export function mergeConversations(from: string, into: string): void {
  const a = resolveConversation(from), b = resolveConversation(into)
  if (a === b) return
  aliases.set(a, b)
  persist()
}

export function recordConversationExchange(exchange: ConversationExchange): void {
  if (!exchange.user.trim() || !exchange.answer.trim()) return
  exchanges.push({ ...exchange })
  const mine = exchanges.filter(e => resolveConversation(e.conversationId) === resolveConversation(exchange.conversationId))
  if (mine.length > perConversationLimit) exchanges.splice(exchanges.indexOf(mine[0]!), 1)
  if (exchanges.length > totalLimit) exchanges.shift()
  persist()
}

/** Bind a run to the conversation that started it. A run already bound keeps its binding. */
export function bindRunToConversation(runId: string, conversationId: string): void {
  if (!runId || !conversationId || runs.has(runId)) return
  runs.set(runId, conversationId)
  while (runs.size > runLimit) runs.delete(runs.keys().next().value as string)
  persist()
}

/** Addresses a run's window showed (from the browser's address bar), so a later request for "the link to each page" has them. */
export function recordRunPages(runId: string, seen: ReadonlyArray<SeenPage>): void {
  const unique = new Map<string, SeenPage>()
  for (const page of seen) if (page.url && !unique.has(page.url)) unique.set(page.url, { url: page.url.slice(0, 500), title: page.title?.slice(0, 200) ?? null })
  if (!runId || !unique.size) return
  pages.set(runId, [...unique.values()].slice(0, 12))
  while (pages.size > runLimit) pages.delete(pages.keys().next().value as string)
  persist()
}
export function pagesOfRun(runId: string): readonly SeenPage[] { return pages.get(runId) ?? [] }

export function conversationOfRun(runId: string): string | null {
  const id = runs.get(runId)
  return id ? resolveConversation(id) : null
}

export function conversationExchanges(conversationId: string): readonly ConversationExchange[] {
  const wanted = resolveConversation(conversationId)
  return exchanges.filter(e => resolveConversation(e.conversationId) === wanted)
}

export function clearConversationExchanges(): void { exchanges = []; runs = new Map(); aliases = new Map(); pages = new Map(); store = null }
