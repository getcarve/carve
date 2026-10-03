import { voices, type VoiceId } from './voice-settings.js'
import { parseResultBlocks } from './result-blocks.js'
import type { LiveComputerOverlayPresentation } from './live-computer-overlay.js'

/** Spoken copy comes from visible results and controller states, never tool traces. */
export function spokenSummary(value: string): string {
  // A public-web answer carries its citations as text: "[1]" after the cited
  // clause and a "[1] Title: url" line per source (executor.ts
  // publicLookupResult). Read aloud that was "1606, one, one. The link is in
  // Carve." The markers are dropped, the reference lines are not read, and
  // the sources are named once at the end.
  const references = [...value.matchAll(/^[ \t]*\[\d+\][ \t]+.*?:[ \t]*(https?:\/\/\S+)[ \t]*$/gmu)].map(match => spokenSiteName(match[1]!))
  const sourceSites = references.filter((site, index) => site && references.indexOf(site) === index)
  value = value.replace(/^[ \t]*\[\d+\][ \t]+.*?:[ \t]*https?:\/\/\S+[ \t]*$/gmu, '')
    .replace(/[ \t]*\[\d+(?:[,\s]+\d+)*\](?=[\s.,;:!?)[\]]|$)/gu, '')
  const urlPattern = /(?:https?:\/\/|www\.|(?<![\w@])(?:[a-z0-9-]+\.)+(?:com|org|net|gov|edu|io|co)\/)[^\s<>]*/giu
  const hasLinks = urlPattern.test(value)
  urlPattern.lastIndex = 0
  let tableMentioned = false
  const speakable = parseResultBlocks(value).map(block => {
    if (block.kind === 'text') return block.text
    if (tableMentioned) return ''
    tableMentioned = true
    return 'Table details are available in Carve.'
  }).join('\n')
  const text = speakable.replace(/```[\s\S]*?```/gu, ' Code is available in Carve. ')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    // Standalone link cards are navigation, not spoken answer content.
    .replace(/^\s*\[[^\]]+\]\(https?:\/\/[^)]*\)\s*$/gmu, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(urlPattern, '')
    .replace(/^(?:source|link|spreadsheet|document)\s*:\s*$/gimu, '')
    // A list marker must not become a standalone sentence ("...facts. 1.").
    .replace(/^\s*\d+[.)]\s+/gmu, '')
    .replace(/^\s*[-+*]\s+/gmu, '')
    .replace(/[#*_`>|]/gu, '').replace(/\s+/gu, ' ').trim()
  const sentences = Array.from(new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text), part => part.segment)
  // Citations do not change how much answer content is spoken. Bound long
  // replies at sentence boundaries and explicitly disclose any omitted text.
  const limit = 1600
  let summary = ''
  let consumed = 0
  for (const sentence of sentences) {
    if ((summary + sentence).length > limit) break
    summary += sentence
    consumed++
  }
  const truncated = consumed < sentences.length
  const limitation = truncated ? sentences.slice(consumed).find(sentence => /\b(?:could not|couldn['’]t|cannot|can['’]t|unable|not (?:confirmed|verified|saved|sent|available)|aren['’]t confirmed|isn['’]t confirmed|unconfirmed|still needs?|incomplete)\b/iu.test(sentence)) : null
  const spoken = summary.trim() || (text ? 'The answer is too long to read aloud in full.' : '')
  const sources = sourceSites.length === 0 ? ''
    : sourceSites.length === 1 ? `Source: ${sourceSites[0]}, linked in Carve.`
    : sourceSites.length === 2 ? `Sources: ${sourceSites[0]} and ${sourceSites[1]}, linked in Carve.`
    : `Sources: ${sourceSites[0]}, ${sourceSites[1]} and ${sourceSites.length - 2} more, linked in Carve.`
  return [spoken, limitation && limitation.length <= 240 ? limitation.trim() : '',
    truncated ? 'The full answer is in Carve.' : '', sources || (hasLinks ? 'The link is in Carve.' : '')].filter(Boolean).join(' ')
}

/** A site as it is said: the host without "www." or a language prefix, so "en.wikipedia.org" is "wikipedia.org". */
function spokenSiteName(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./u, '').replace(/^(?:[a-z]{2}(?:-[a-z]{2})?|m|mobile|amp)\./u, '')
  } catch { return '' }
}

export interface VoiceLine { text: string; priority: 'normal' | 'urgent' }

/** The request's title from interpretation, when it produced one, is the
 * cheapest summary there is: no call on the startup path, and never the
 * request read back verbatim. Without one, the goal's first sentence. */
export function taskAcknowledgement(goal?: string, title?: string): string {
  const heading = title?.replace(/\s+/gu, ' ').trim().replace(/[.!?:;,]+$/u, '') ?? ''
  if (heading) return `I’ll get started on ${spokenHeading(heading)}.`
  if (!goal?.trim()) return 'I’ll get started.'
  const clean = goal.replace(/```[\s\S]*?```/gu, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/https?:\/\/\S+/gu, 'the linked page')
    .replace(/[#*_`>|]/gu, '').replace(/\s+/gu, ' ').trim()
    .replace(/^(?:(?:can|could|would) you\s+|please\s+|I(?:’|')?d like you to\s+|I want you to\s+)+/iu, '')
  if (!clean) return 'I’ll get started.'
  const first = Array.from(new Intl.Segmenter('en', { granularity: 'sentence' }).segment(clean))[0]?.segment.trim() ?? clean
  const brief = first.length > 180 ? first.slice(0, 177).replace(/\s+\S*$/u, '') + '…' : first
  const task = brief.replace(/[.!?]+$/u, '')
  const verbs: Record<string, string> = { search: 'searching', find: 'finding', look: 'looking', check: 'checking', compare: 'comparing', open: 'opening', create: 'creating', write: 'writing', draft: 'drafting', update: 'updating', edit: 'editing', review: 'reviewing', summarize: 'summarizing', organize: 'organizing', plan: 'planning', add: 'adding', make: 'making', fix: 'fixing', help: 'helping' }
  const match = /^(\w+)\b(.*)$/u.exec(task)
  const verb = match ? verbs[match[1]!.toLowerCase()] : undefined
  if (verb && match) return `I’ll get started ${verb}${match[2]}${task.endsWith('…') ? '' : '.'}`
  return `I’ll get started on your request: ${task}${task.endsWith('…') ? '' : '.'}`
}

/** A sentence-case heading read as a phrase: the first word drops its
 * capital unless it looks like a name or acronym (a digit, all capitals, or an inner capital). */
function spokenHeading(heading: string): string {
  const [first = '', ...rest] = heading.split(' ')
  const keep = /^[A-Z]{2,}|\d|^[A-Z][a-z]*[A-Z]/u.test(first)
  return [keep ? first : first.charAt(0).toLowerCase() + first.slice(1), ...rest].join(' ')
}

/** Keep receipts across capsule hide/show and window switches; no replay on unmute. */
export class CapsuleVoicePolicy {
  private sessions = new Map<string, { seen: Set<string>; lastSpoke: number; recoveringSince: number | null }>()
  observe(p: LiveComputerOverlayPresentation, now = Date.now()): VoiceLine | null {
    let state = this.sessions.get(p.voiceContextId ?? p.sessionId)
    if (!state) {
      state = { seen: new Set(), lastSpoke: -Infinity, recoveringSince: null }
      this.sessions.set(p.voiceContextId ?? p.sessionId, state)
      if (this.sessions.size > 32) this.sessions.delete(this.sessions.keys().next().value!)
    }
    state.recoveringSince = p.phase === 'recovering' ? state.recoveringSince ?? now : null
    let key = '', text = '', priority: VoiceLine['priority'] = 'urgent'
    if (p.guide?.state === 'answered' && p.answer) {
      key = `answer:${p.guide.answerId}`; text = spokenSummary(p.answer)
    } else if (p.theme === 'complete') {
      key = `complete:${spokenSummary(p.answer ?? '')}`
      text = spokenSummary(p.answer ?? '') || 'Done.'
    } else if (p.guide?.state === 'failed') {
      key = `guide-failed:${p.guide.failure}`; text = `I couldn't answer that. ${spokenSummary(p.guide.failure ?? '')}`
    } else if (p.failure) {
      key = `failure:${p.failure.message}`; text = `I couldn't finish the task. ${spokenSummary(p.failure.message)}`
    } else if (p.decision || p.budgetCheckpoint || p.guidance || p.planApproval || p.theme === 'attention') {
      key = `attention:${p.decision?.id ?? p.budgetCheckpoint?.id ?? p.guidance?.id ?? p.guidance?.question ?? p.planApproval?.planHash ?? p.label}`
      text = p.guidance ? `I need your input. ${spokenSummary(p.guidance.question)}` : 'I need your approval before continuing. Please review the controls in Carve.'
    } else if (p.phase === 'ended') {
      key = 'ended'; text = 'The task has stopped.'
    } else if (p.steeringReceiptId) {
      key = `steered:${p.steeringReceiptId}`; text = 'Got it. I’ve applied your direction.'
      // A receipt remains attached to later states; let subsequent milestones through.
      if (state.seen.has(key)) key = ''
    }
    if (!key && (p.mode === 'session' || p.mode === 'steer') && p.theme !== 'paused' && p.phase !== 'waiting') {
      priority = 'normal'
      if (!state.seen.has('start')) { key = 'start'; text = taskAcknowledgement(p.taskGoal, p.taskTitle) }
      else if (state.recoveringSince !== null && now - state.recoveringSince >= 30_000 && now - state.lastSpoke >= 60_000) {
        key = 'milestone:recovering'
        text = 'This is taking longer than expected. I’m still working on it.'
      } else if (p.intent && now - state.lastSpoke >= 12_000) {
        // One substantive line per long quiet stretch: the declared next
        // step, never filler, never the same phrase twice in a run.
        key = `intent:${p.intent.toLowerCase()}`
        text = `${p.intent}.`
      }
    }
    if (!key || state.seen.has(key)) return null
    state.seen.add(key)
    // Bound answer/decision receipts within long-running guide sessions too.
    if (state.seen.size > 128) state.seen.delete(state.seen.values().next().value!)
    state.lastSpoke = now
    return { text: text.trim(), priority }
  }
}

/** Small sentence-aware requests keep time-to-first-audio independent of answer length.
 * Split unusually long sentences at whitespace, retaining every word. */
export function speechChunks(text: string): string[] {
  const chunks: string[] = []
  let chunk = ''
  for (const { segment } of new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)) {
    const sentence = segment.trim()
    if (sentence.length <= 280) {
      if (chunk && chunk.length + sentence.length + 1 > 280) { chunks.push(chunk); chunk = '' }
      chunk = [chunk, sentence].filter(Boolean).join(' ')
    } else {
      if (chunk) { chunks.push(chunk); chunk = '' }
      for (const word of sentence.split(/\s+/u)) {
        if (chunk && chunk.length + word.length + 1 > 280) { chunks.push(chunk); chunk = '' }
        // Bound even a single long token without losing its characters.
        let rest = word
        while (rest.length > 280) { chunks.push(rest.slice(0, 280)); rest = rest.slice(280) }
        chunk = [chunk, rest].filter(Boolean).join(' ')
      }
    }
  }
  if (chunk) chunks.push(chunk)
  return chunks
}

type VoiceFailureReason = 'timeout' | 'service' | 'network' | 'configuration' | 'audio' | 'playback'
class VoiceFailure extends Error {
  constructor(readonly reason: VoiceFailureReason, readonly retryable = false, readonly status?: number) { super(reason) }
}
export type VoicePacket = { kind: 'stop' } | { kind: 'audio'; audioBase64: string; id: number } | { kind: 'error'; reason?: VoiceFailureReason }

/** One utterance, with at most one small audio segment prepared ahead of playback. */
export class CapsuleVoice {
  readonly policy = new CapsuleVoicePolicy()
  private pending: AbortController | null = null
  private generation = 0
  private audioSequence = 1
  private sessionId: string | null = null
  private listening = false
  private playing: number | null = null
  private playbackFinished: ((error?: VoiceFailure) => void) | null = null
  voiceId: VoiceId = 'thalia'
  enabled = false
  async preview(): Promise<void> {
    if (!this.available || this.listening) throw new Error('Voice preview is unavailable')
    await this.speak('Hi, I’m Carve. I can help you find answers and get things done.')
  }
  constructor(private readonly send: (packet: VoicePacket) => void,
    private readonly apiKey = process.env.DEEPGRAM_API_KEY ?? '',
    private readonly request: typeof fetch = fetch,
    private readonly audit: (event: Record<string, unknown>) => void = () => {},
    private readonly timing = { requestMs: 30_000, playbackMs: 90_000 }) {}
  private record(event: string, details: Record<string, unknown> = {}): void {
    try { this.audit({ event, contextId: this.sessionId, ...details }) } catch { /* Voice diagnostics never affect work. */ }
  }
  playback(id: number, state: 'started' | 'ended' | 'error'): void {
    if (id !== this.playing) return
    this.record(`playback_${state}`, { id })
    if (state !== 'started') {
      this.playing = null
      this.playbackFinished?.(state === 'error' ? new VoiceFailure('playback') : undefined)
    }
  }
  get available(): boolean { return Boolean(this.apiKey.trim()) }
  stop(reason = 'user_action'): void {
    if (this.pending || this.playing !== null) this.record('cancelled', { reason, id: this.generation })
    this.playing = null
    this.generation++
    this.pending?.abort(); this.pending = null
    this.send({ kind: 'stop' })
  }
  setListening(listening: boolean): void {
    this.listening = listening
    if (listening) this.stop('microphone')
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled && this.available
    if (!this.enabled) this.stop('muted')
  }
  observe(p: LiveComputerOverlayPresentation): void {
    const contextId = p.voiceContextId ?? p.sessionId
    if (this.sessionId !== contextId) { this.stop('task_changed'); this.sessionId = contextId }
    const line = this.policy.observe(p)
    if (!line || !this.enabled || this.listening) return
    if (line.priority === 'normal' && (this.pending || this.playing !== null)) return
    void this.speak(line.text)
  }
  private async synthesize(text: string, signal: AbortSignal, generation: number, chunk: number, model: string): Promise<Buffer> {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted()
      const timeout = new AbortController()
      const timer = setTimeout(() => timeout.abort(), this.timing.requestMs)
      const started = Date.now()
      let status: number | undefined
      this.record('synthesis_started', { id: generation, chunk, attempt, model, characters: text.length })
      try {
        const response = await this.request(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}&encoding=mp3`, {
          method: 'POST', headers: { Authorization: `Token ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }), signal: AbortSignal.any([signal, timeout.signal]),
        })
        status = response.status
        if (!response.ok) throw new VoiceFailure(status === 401 || status === 403 ? 'configuration' : 'service', status === 408 || status === 429 || status >= 500, status)
        if (!response.headers.get('content-type')?.startsWith('audio/')) throw new VoiceFailure('audio')
        const audio = Buffer.from(await response.arrayBuffer())
        if (!audio.length || audio.length > 2 * 1024 * 1024) throw new VoiceFailure('audio')
        signal.throwIfAborted()
        if (timeout.signal.aborted) throw new VoiceFailure('timeout', true)
        return audio
      } catch (error) {
        if (signal.aborted) throw error
        const failure = timeout.signal.aborted ? new VoiceFailure('timeout', true) : error instanceof VoiceFailure ? error : new VoiceFailure('network', true)
        this.record('synthesis_failed', { id: generation, chunk, attempt, reason: failure.reason, status, elapsedMs: Date.now() - started })
        if (attempt >= 1 || !failure.retryable) throw failure
        this.record('synthesis_retry', { id: generation, chunk, reason: failure.reason })
        // A short, cancellable backoff avoids immediately repeating a failing request.
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(backoff); reject(signal.reason) }
          const backoff = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 500)
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
        })
      } finally { clearTimeout(timer) }
    }
  }
  private waitForPlayback(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (error?: VoiceFailure) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        if (this.playbackFinished === finish) this.playbackFinished = null
        if (error) reject(error); else resolve()
      }
      const abort = () => finish(new VoiceFailure('playback'))
      const timer = setTimeout(abort, this.timing.playbackMs)
      timer.unref?.()
      this.playbackFinished = finish
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }
  private async speak(text: string): Promise<void> {
    // Existing audio continues until its replacement is ready; queued segments
    // from the old utterance are cancelled immediately.
    this.pending?.abort()
    const generation = ++this.generation
    const controller = new AbortController()
    this.pending = controller
    const model = voices.find(voice => voice.id === this.voiceId)!.model
    const chunks = speechChunks(text)
    try {
      let next = this.synthesize(chunks[0] ?? '', controller.signal, generation, 0, model)
        .then(audio => ({ audio }), error => ({ error }))
      for (let index = 0; index < chunks.length; index++) {
        const result = await next
        controller.signal.throwIfAborted()
        if ('error' in result) throw result.error
        if (generation !== this.generation || !this.enabled || this.listening) return
        const id = ++this.audioSequence
        this.playing = id
        const played = this.waitForPlayback(controller.signal)
        this.record('audio_ready', { id, chunk: index, chunks: chunks.length })
        this.send({ kind: 'audio', audioBase64: result.audio.toString('base64'), id })
        // Catch prefetch failures immediately, but report them only after the
        // current segment finishes. Never replay an already spoken segment.
        if (index + 1 < chunks.length) next = this.synthesize(chunks[index + 1]!, controller.signal, generation, index + 1, model)
          .then(audio => ({ audio }), error => ({ error }))
        await played
      }
    } catch (error) {
      if (generation === this.generation && !controller.signal.aborted) {
        const reason = error instanceof VoiceFailure ? error.reason : 'network'
        controller.abort()
        this.send({ kind: 'error', reason })
      }
    } finally {
      if (this.pending === controller) this.pending = null
    }
  }
}
