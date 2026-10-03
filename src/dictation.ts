/**
 * Voice dictation through Deepgram's prerecorded transcription API.
 *
 * Dictation is a hosted text-entry convenience, not a model provider: the only
 * thing that ever leaves the machine is the audio clip the person explicitly
 * recorded with the mic control, and the only thing that comes back is its
 * transcript. Clips are never persisted, never become observations or
 * evidence, and the transcript lands in an input field where the person can
 * edit it before anything acts on it.
 */

export interface DictationStatus {
  configured: boolean
  vendor: 'deepgram'
  model: string
}

export interface DictationResult {
  transcript: string
  durationSeconds: number | null
}

/** Snapshot of a live transcription: finalized text plus the still-moving
 * interim tail Deepgram has not committed yet. */
export interface DictationLiveState {
  sessionId: string
  transcript: string
  interim: string
  done: boolean
  error: string | null
}

export type DictationLiveListener = (state: DictationLiveState) => void

/** The slice of the WHATWG WebSocket surface the live path uses; injectable
 * so tests never open a network socket. */
export interface DictationSocket {
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: (() => void) | null
  onclose: (() => void) | null
  send(data: string | Uint8Array): void
  close(): void
}

interface LiveTranscription {
  id: string
  socket: DictationSocket
  open: boolean
  pendingChunks: Uint8Array[]
  finalized: string[]
  interim: string
  audioBytes: number
  error: string | null
  done: boolean
  closeRequested: boolean
  finishWaiters: Array<() => void>
  expiry: NodeJS.Timeout
}

const deepgramEndpoint = 'https://api.deepgram.com/v1/listen'
const deepgramModel = 'nova-3'
/** Sub-second stub blobs make Deepgram return an opaque 400; refuse them with
 * a human explanation instead. */
const minAudioBytes = 1_024
const maxAudioBytes = 8 * 1024 * 1024

const allowedMimeTypes = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
])

const liveEndpoint = 'wss://api.deepgram.com/v1/listen'
const maxLiveChunkBytes = 512 * 1024
const maxLiveAudioBytes = 16 * 1024 * 1024
const liveSessionTtlMs = 180_000
// Deepgram normally confirms CloseStream within a few hundred milliseconds.
// If it does not, the words heard so far (including the last interim) are
// already the answer, so stop waiting quickly rather than holding the person.
const liveFinishTimeoutMs = 1_500

export class DictationService {
  private readonly liveSessions = new Map<string, LiveTranscription>()
  private readonly liveListeners = new Set<DictationLiveListener>()
  private liveSequence = 0

  constructor(
    private readonly apiKey = process.env.DEEPGRAM_API_KEY ?? '',
    private readonly fetchImplementation: typeof fetch = fetch,
    // Auth rides the WebSocket subprotocol ('token', <key>) because the
    // WHATWG constructor cannot set headers.
    private readonly socketFactory: (url: string, protocols: string[]) => DictationSocket =
      (url, protocols) => new WebSocket(url, protocols) as unknown as DictationSocket,
    private readonly finishTimeoutMs = liveFinishTimeoutMs,
  ) {}

  status(): DictationStatus {
    return { configured: this.apiKey.length > 0, vendor: 'deepgram', model: deepgramModel }
  }

  /** Deepgram results arrive independently of audio uploads. Desktop shells
   * subscribe here so an interim can reach the field immediately rather than
   * waiting for the next chunk request to sample it. */
  onLiveState(listener: DictationLiveListener): () => void {
    this.liveListeners.add(listener)
    return () => this.liveListeners.delete(listener)
  }

  /**
   * Opens a streaming transcription. Audio chunks pushed with pushLiveAudio
   * flow to Deepgram as they arrive. Results publish independently for
   * event-capable desktop shells, while every push also returns the newest
   * state as a fallback for plain request/response transports.
   */
  beginLiveTranscription(mimeType: string): DictationLiveState {
    if (!this.apiKey) throw new Error('Voice dictation is not configured. Set DEEPGRAM_API_KEY in Carve’s local configuration.')
    const normalizedMime = mimeType.trim().toLowerCase()
    if (!allowedMimeTypes.has(normalizedMime)) throw new Error(`Unsupported dictation audio format: ${mimeType}`)
    const id = `dictation_${Date.now().toString(36)}_${(this.liveSequence += 1)}`
    const url = `${liveEndpoint}?model=${deepgramModel}&interim_results=true&smart_format=true&punctuate=true&endpointing=300`
    const socket = this.socketFactory(url, ['token', this.apiKey])
    const session: LiveTranscription = {
      id, socket, open: false, pendingChunks: [], finalized: [], interim: '',
      audioBytes: 0, error: null, done: false, closeRequested: false, finishWaiters: [],
      expiry: setTimeout(() => this.cancelLiveTranscription(id), liveSessionTtlMs),
    }
    session.expiry.unref?.()
    socket.onopen = () => {
      session.open = true
      for (const chunk of session.pendingChunks.splice(0)) socket.send(chunk)
      if (session.closeRequested) socket.send(JSON.stringify({ type: 'CloseStream' }))
    }
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      try {
        const message = JSON.parse(event.data) as {
          type?: string
          is_final?: boolean
          channel?: { alternatives?: Array<{ transcript?: string }> }
        }
        // Deepgram confirms a CloseStream flush with a Metadata frame but may
        // hold the socket open afterwards; treat the confirmation as the end
        // so finishing never has to wait out the close timeout.
        if (message.type === 'Metadata' && session.closeRequested) {
          this.settleLive(session)
          return
        }
        if (message.type !== 'Results') return
        const text = message.channel?.alternatives?.[0]?.transcript?.trim() ?? ''
        if (message.is_final) {
          if (text) session.finalized.push(text)
          session.interim = ''
        } else {
          session.interim = text
        }
        this.publishLive(session)
      } catch {
        // A malformed frame must not kill the stream; the next frame corrects it.
      }
    }
    socket.onerror = () => {
      if (!session.done) session.error ??= 'The live transcription connection failed'
      this.settleLive(session)
    }
    socket.onclose = () => this.settleLive(session)
    this.liveSessions.set(id, session)
    return this.liveState(session)
  }

  pushLiveAudio(sessionId: string, chunk: Buffer): DictationLiveState {
    const session = this.liveSessions.get(sessionId)
    if (!session) throw new Error('The live dictation session has ended')
    if (chunk.byteLength === 0 || chunk.byteLength > maxLiveChunkBytes) throw new Error('Invalid dictation audio chunk')
    session.audioBytes += chunk.byteLength
    if (session.audioBytes > maxLiveAudioBytes) {
      this.cancelLiveTranscription(sessionId)
      throw new Error('The dictation ran past the live transcription size limit')
    }
    if (!session.done) {
      const bytes = new Uint8Array(chunk)
      if (session.open) session.socket.send(bytes)
      else session.pendingChunks.push(bytes)
    }
    return this.liveState(session)
  }

  async finishLiveTranscription(sessionId: string): Promise<DictationLiveState> {
    const session = this.liveSessions.get(sessionId)
    if (!session) throw new Error('The live dictation session has ended')
    if (!session.done) {
      session.closeRequested = true
      if (session.open) {
        try { session.socket.send(JSON.stringify({ type: 'CloseStream' })) } catch { this.settleLive(session) }
      }
      await new Promise<void>((resolvePromise) => {
        // Settling, rather than merely ending the wait, folds the latest
        // interim into the returned transcript before the session is removed.
        const timer = setTimeout(() => this.settleLive(session), this.finishTimeoutMs)
        timer.unref?.()
        session.finishWaiters.push(() => { clearTimeout(timer); resolvePromise() })
      })
    }
    const state = this.liveState(session)
    this.disposeLive(session)
    return { ...state, done: true }
  }

  cancelAllLiveTranscriptions(): void {
    for (const id of this.liveSessions.keys()) this.cancelLiveTranscription(id)
  }

  cancelLiveTranscription(sessionId: string): void {
    const session = this.liveSessions.get(sessionId)
    if (!session) return
    this.settleLive(session)
    this.disposeLive(session)
  }

  liveAudioBytes(sessionId: string): number {
    return this.liveSessions.get(sessionId)?.audioBytes ?? 0
  }

  private liveState(session: LiveTranscription): DictationLiveState {
    return {
      sessionId: session.id,
      transcript: session.finalized.join(' '),
      interim: session.interim,
      done: session.done,
      error: session.error,
    }
  }

  private settleLive(session: LiveTranscription): void {
    if (session.done) return
    session.done = true
    // A close can arrive before the last interim was finalized; the spoken
    // words still belong in the result.
    if (session.interim) {
      session.finalized.push(session.interim)
      session.interim = ''
    }
    this.publishLive(session)
    try { session.socket.close() } catch { /* already closed */ }
    for (const waiter of session.finishWaiters.splice(0)) waiter()
  }

  private publishLive(session: LiveTranscription): void {
    const state = this.liveState(session)
    for (const listener of this.liveListeners) {
      try { listener(state) } catch { /* renderer delivery is best-effort */ }
    }
  }

  private disposeLive(session: LiveTranscription): void {
    clearTimeout(session.expiry)
    this.liveSessions.delete(session.id)
  }

  async transcribe(audio: Buffer, mimeType: string): Promise<DictationResult> {
    if (!this.apiKey) throw new Error('Voice dictation is not configured. Set DEEPGRAM_API_KEY in Carve’s local configuration.')
    const normalizedMime = mimeType.trim().toLowerCase()
    if (!allowedMimeTypes.has(normalizedMime)) throw new Error(`Unsupported dictation audio format: ${mimeType}`)
    if (audio.byteLength < minAudioBytes) throw new Error('The recording was too short to transcribe. Hold the mic a moment longer.')
    if (audio.byteLength > maxAudioBytes) throw new Error('The recording is too long to transcribe in one request. Keep dictation under a minute.')

    const url = `${deepgramEndpoint}?model=${deepgramModel}&smart_format=true&punctuate=true`
    const response = await this.fetchImplementation(url, {
      method: 'POST', redirect: 'error',
      headers: { authorization: `Token ${this.apiKey}`, 'content-type': normalizedMime },
      body: new Uint8Array(audio),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Deepgram transcription failed (${response.status}): ${body.slice(0, 300) || response.statusText}`)
    }
    const payload = await response.json() as {
      metadata?: { duration?: number }
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> }
    }
    const transcript = payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? ''
    if (!transcript) throw new Error('No speech was recognized in the recording.')
    return {
      transcript,
      durationSeconds: typeof payload.metadata?.duration === 'number' ? payload.metadata.duration : null,
    }
  }
}
