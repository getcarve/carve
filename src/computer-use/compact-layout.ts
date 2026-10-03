/**
 * Order of the compact request's JSON fields and where its explicit prompt-cache
 * breakpoints fall.
 *
 * Measured on 472 consecutive decision pairs: the goal is the
 * same 99% of the time, the controller instructions are a fixed preamble plus a
 * per-turn note, page text is unchanged between turns about a third of the time,
 * and observations, the note and feedback change every turn. The old order put
 * the per-turn note second, so only the system prompt was ever read from cache
 * (28% of decision input). Cache order puts the stable fields first, marks
 * breakpoints after them, and moves everything that changes each turn to the end.
 *
 * Replay result (75 paired Luna decisions from 12 real runs,
 * one replay): cached share 27% → 35%, uncached
 * input −10%, response time unchanged (paired median +12 ms), cache writes 4.6×,
 * decision agreement with the recorded run 83% vs 77% (noise at n=75). Not worth
 * it on decisions, so it is OFF by default; `STEWARD_PROMPT_CACHE_ORDER=on` opts in.
 */

export type CompactPromptFields = Record<string, unknown> & { goal: string; controllerInstructions: string; controllerNote?: string | undefined }

export interface CompactPromptLayout {
  prompt: string
  cacheablePrefixes: string[]
  /** Character offsets where the request's leading text is split into parts, every earlier log end included, so each
   * turn's parts extend the previous turn's instead of regrouping them (see ModelRequest.cacheSegmentBoundaries). */
  cacheSegmentBoundaries?: number[]
}

/** `STEWARD_CACHE_SEGMENTS=off` marks this turn's log ends as before (they move each turn and rarely hit). */
const maxStableMarks = 4, stableMarkGrowth = 1.6
export const cacheSegmentsEnabled = () => process.env.STEWARD_CACHE_SEGMENTS?.trim().toLowerCase() !== 'off'

export const cacheOrderedPrompts = () => process.env.STEWARD_PROMPT_CACHE_ORDER?.trim() === 'on'

/** Fields after the breakpoints, stable-ish first and the current observation,
 * note and feedback last. Unlisted fields keep their order after these. */
const volatileOrder = [
  'retainedSourceEvidence', 'sourcesVisited', 'programsPreviouslyProposed', 'deliveredInputs', 'uncertainInputs',
  'controllerRejections', 'verificationRejections', 'outstandingRequirements', 'observations', 'currentObservationId',
  'pageControlsReadable', 'controllerNote', 'feedback', 'proposedAnswer',
]

const openPrefix = (value: Record<string, unknown>) => JSON.stringify(value).slice(0, -1)

export function compactPromptLayout(fields: CompactPromptFields, cacheOrdered = cacheOrderedPrompts()): CompactPromptLayout {
  const defined = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
  if (!cacheOrdered) {
    // Earlier order: the note is part of the instructions; only the goal is a prefix.
    const { controllerNote, ...rest } = defined as CompactPromptFields
    const legacy = { ...rest, controllerInstructions: controllerNote ? `${rest.controllerInstructions}\n\n${controllerNote}` : rest.controllerInstructions }
    const ordered: Record<string, unknown> = { goal: legacy.goal, controllerInstructions: legacy.controllerInstructions }
    for (const [key, value] of Object.entries(legacy)) if (!(key in ordered)) ordered[key] = value
    return { prompt: JSON.stringify(ordered), cacheablePrefixes: [openPrefix({ goal: legacy.goal })] }
  }
  const stable: Record<string, unknown> = { goal: defined.goal, controllerInstructions: defined.controllerInstructions }
  const cacheablePrefixes = [openPrefix(stable)]
  const ordered: Record<string, unknown> = { ...stable }
  if (defined.pageText !== undefined) {
    ordered.pageText = defined.pageText
    cacheablePrefixes.push(openPrefix(ordered))
  }
  for (const key of volatileOrder) if (key in defined && !(key in ordered)) ordered[key] = defined[key]
  for (const [key, value] of Object.entries(defined)) if (!(key in ordered)) ordered[key] = value
  const prompt = JSON.stringify(ordered)
  return { prompt, cacheablePrefixes: cacheablePrefixes.filter(prefix => prompt.startsWith(prefix)) }
}

/** Split recorded earlier-order instructions (preamble + "\n\n" + note) back apart, given the run's first-turn preamble. */
export function splitRecordedInstructions(recorded: string, preamble: string): { controllerInstructions: string; controllerNote?: string } {
  if (recorded === preamble) return { controllerInstructions: preamble }
  if (recorded.startsWith(`${preamble}\n\n`)) return { controllerInstructions: preamble, controllerNote: recorded.slice(preamble.length + 2) }
  return { controllerInstructions: recorded }
}

/**
 * Append-only actor prompt (before it, every turn rebuilt one
 * `current-decision` block, actor input grew from 10k to 28k tokens with about
 * 4k cached, 23% of actor input). The actor's request becomes
 *
 *   {"goal", "controllerInstructions", "log": [first-seen entries…], "pageText", "current": {…}}
 *
 * The log only ever grows at its end, in the order things happened: page text
 * first read on an earlier frame (each line once), proposed programs, delivered
 * inputs, controller and verification rejections. Everything that changes each
 * turn (the current observation, the note, feedback, requirements) is in
 * `current`, last. Cache breakpoints sit at the previous turn's log end (a hit
 * for everything already sent), at this turn's log end, and after pageText (a
 * hit while the page is unchanged). Past `maxLogCharacters` the log restarts
 * from a bounded summary once. The verifier keeps its own layout.
 * `STEWARD_ACTOR_APPEND_ONLY=off` restores the per-turn rebuild.
 */
export const appendOnlyActorPrompts = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_ACTOR_APPEND_ONLY?.trim().toLowerCase() !== 'off'

/** What the log's entries are, for the actor's (stable) instructions. */
export const appendOnlyLogGuidance = 'This request is laid out as goal, controllerInstructions, log, pageText (when present) and current. log lists, in the order they happened, what earlier turns established: kind "evidence" is retainedSourceEvidence (text read on an earlier frame of this window, with its source; each line appears once, where it was first read), kind "decision" is programsPreviouslyProposed, kind "inputs" is deliveredInputs, and kind "rejection" is controllerRejections or verificationRejections. current holds the current observation and the controller\'s note and feedback for this turn; it and pageText supersede older log entries where they differ.'

export interface AppendOnlyTurn {
  goal: string
  controllerInstructions: string
  /** Retained source evidence, oldest first, as the controller holds it this turn. */
  evidence: ReadonlyArray<{ frameId: string; text: string; source?: { url: string | null; title: string | null } | null }>
  decisions: ReadonlyArray<{ turn: number; observationId: string; commands: string[] }>
  deliveredInputs: ReadonlyArray<{ sequence: number } & Record<string, unknown>>
  rejections: ReadonlyArray<{ source: 'controller' | 'verification'; turn: number; text: string; unmet?: string[] }>
  pageText?: unknown
  /** Everything else, rendered last in this order. */
  current: Record<string, unknown>
}

export class AppendOnlyActorLog {
  private entries: string[] = []
  private characters = 0
  private readonly seenLines = new Map<string, Set<string>>()
  private readonly seenEvidence = new Set<string>()
  private lastDecisionTurn = -1
  private lastSequence = 0
  private readonly seenRejections = new Set<string>()
  private previousLogPrefix: string | null = null
  private logBoundaries: number[] = []
  private header = ''

  constructor(private readonly maxLogCharacters = 90_000, private readonly maxEntryCharacters = 6_000) {}

  reset(): void {
    this.entries = []; this.characters = 0; this.seenLines.clear(); this.seenEvidence.clear()
    this.lastDecisionTurn = -1; this.lastSequence = 0; this.seenRejections.clear(); this.previousLogPrefix = null; this.logBoundaries = []; this.header = ''
  }

  private append(entry: Record<string, unknown>): void {
    const text = JSON.stringify(entry)
    this.entries.push(text)
    this.characters += text.length + 1
  }

  private appendEvidence(entry: AppendOnlyTurn['evidence'][number]): void {
    const key = `${entry.frameId}\u0001${entry.text}`
    if (this.seenEvidence.has(key)) return
    this.seenEvidence.add(key)
    const document = entry.source?.url ?? (entry.source?.title ? `title:${entry.source.title}` : 'window')
    let seen = this.seenLines.get(document)
    if (!seen) this.seenLines.set(document, seen = new Set())
    const fresh: string[] = []
    for (const line of entry.text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      fresh.push(line)
    }
    if (!fresh.length) return
    this.append({ kind: 'evidence', frameId: entry.frameId, ...(entry.source ? { source: entry.source } : {}), text: fresh.join('\n').slice(0, this.maxEntryCharacters) })
  }

  /** Bring the log up to date with this turn and render the request. */
  render(turn: AppendOnlyTurn): CompactPromptLayout {
    const header = JSON.stringify({ goal: turn.goal, controllerInstructions: turn.controllerInstructions }).slice(0, -1)
    if (header !== this.header) { this.header = header; this.previousLogPrefix = null; this.logBoundaries = [] }
    for (const entry of turn.evidence) this.appendEvidence(entry)
    for (const decision of turn.decisions) if (decision.turn > this.lastDecisionTurn) { this.lastDecisionTurn = decision.turn; this.append({ kind: 'decision', ...decision }) }
    const inputs = turn.deliveredInputs.filter(entry => entry.sequence > this.lastSequence)
    if (inputs.length) { this.lastSequence = Math.max(...inputs.map(entry => entry.sequence)); this.append({ kind: 'inputs', entries: inputs }) }
    for (const rejection of turn.rejections) {
      const key = `${rejection.source}\u0001${rejection.turn}\u0001${rejection.text}`
      if (this.seenRejections.has(key)) continue
      this.seenRejections.add(key)
      this.append({ kind: 'rejection', ...rejection })
    }
    if (this.characters > this.maxLogCharacters) this.compact()
    const logPrefix = `${header},"log":[${this.entries.join(',')}`
    const afterLog = `${logPrefix}]${turn.pageText === undefined ? '' : `,"pageText":${JSON.stringify(turn.pageText)}`}`
    const prompt = `${afterLog},"current":${JSON.stringify(Object.fromEntries(Object.entries(turn.current).filter(([, value]) => value !== undefined)))}}`
    const prefixes = [this.previousLogPrefix, logPrefix, turn.pageText === undefined ? null : afterLog]
      .filter((prefix): prefix is string => prefix !== null && prompt.startsWith(prefix))
    this.previousLogPrefix = logPrefix
    if (cacheSegmentsEnabled()) {
      // Breakpoints that never move: the provider's cache matches a prefix only when the parts before it and their
      // breakpoint marks are the same as when it was written (in one run, turn 4 sent turn 3's first three
      // parts unchanged but without turn 3's first mark, and only the system prompt was cached). So a log end, once
      // marked, stays marked for the run; a new one is marked only when the log has grown well past the last, and at
      // most four, which bounds the marks a provider must accept while caching most of the log.
      const last = this.logBoundaries.at(-1)
      if (this.logBoundaries.length < maxStableMarks && (last === undefined || logPrefix.length >= last * stableMarkGrowth)) this.logBoundaries.push(logPrefix.length)
      const stable = this.logBoundaries.filter(length => length <= logPrefix.length).map(length => prompt.slice(0, length))
      return { prompt, cacheablePrefixes: stable, cacheSegmentBoundaries: [...this.logBoundaries] }
    }
    // Nested and strictly growing, as the provider requires.
    return { prompt, cacheablePrefixes: prefixes.filter((prefix, index) => index === 0 || (prefix.length > prefixes[index - 1]!.length && prefix.startsWith(prefixes[index - 1]!))) }
  }

  /** The log outgrew its bound: keep its newest entries up to half the bound, once, and start caching again from there. */
  private compact(): void {
    const kept: string[] = []
    let size = 0
    for (let index = this.entries.length - 1; index >= 0 && size + this.entries[index]!.length < this.maxLogCharacters / 2; index--) {
      kept.unshift(this.entries[index]!)
      size += this.entries[index]!.length + 1
    }
    this.entries = [JSON.stringify({ kind: 'note', text: 'Earlier log entries were dropped to bound this request; retained facts from them may be missing here.' }), ...kept]
    this.characters = this.entries.reduce((total, entry) => total + entry.length + 1, 0)
    this.previousLogPrefix = null; this.logBoundaries = []
  }
}

/** The prefix a provider can serve from cache for `next`, given the breakpoints written by `previous` (characters). */
export function cachedPrefixCharacters(previous: { system: string; prompt: string; cacheablePrefixes: string[] } | null, next: { system: string; prompt: string }): number {
  if (!previous || previous.system !== next.system) return 0
  const hit = previous.cacheablePrefixes.filter(prefix => next.prompt.startsWith(prefix)).reduce((longest, prefix) => Math.max(longest, prefix.length), 0)
  return next.system.length + hit
}
