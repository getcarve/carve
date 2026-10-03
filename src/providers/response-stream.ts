import { ProviderTransientRequestError } from './types.js'
/** Reads Responses SSE without ever treating partial generated text as a plan. */
export interface ResponseStreamProgress {
  firstEventMs: number | null
  firstTextMs: number | null
  lastEventMs: number | null
  eventCount: number
  outputCharacters: number
  responseId: string | null
  /** The first characters of generated output text, bounded. In-process
   * only: lets a caller read a leading schema field (the compact engine's
   * declared next step) before the response completes. Never a plan. */
  textHead?: string
}

const textHeadLimit = 600

/** Longest silence tolerated between stream chunks before the request is abandoned and retried on a fresh connection. */
export interface ResponseStreamOptions {
  idleMs?: number
}

export class ResponseStreamIdleError extends Error {
  /** What arrived before the silence, including the response id once `response.created` was seen, so usage can be reconciled later. */
  readonly progress: ResponseStreamProgress
  constructor(idleMs: number, progress: ResponseStreamProgress) {
    super(`OpenAI response stream timed out after ${Math.round(idleMs / 1000)} s without data (${progress.eventCount} events received); the request will be retried on a fresh connection`)
    this.name = 'ResponseStreamIdleError'
    this.progress = { ...progress }
  }
}

export async function readResponseStream<T>(
  response: Response,
  started: number,
  onProgress?: (progress: ResponseStreamProgress) => void,
  options: ResponseStreamOptions = {},
): Promise<T> {
  if (!response.body) throw new Error('OpenAI response stream has no body')
  const reader = response.body.getReader()
  // A connection that dies without a FIN looks exactly like a slow model:
  // headers and a first event arrive, then nothing until the hard deadline.
  // Reading with an idle bound turns that 60 s wait into a quick retry.
  const idleMs = options.idleMs !== undefined && Number.isFinite(options.idleMs) && options.idleMs > 0 ? options.idleMs : null
  const readChunk = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    if (idleMs === null) return reader.read()
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ResponseStreamIdleError(idleMs, progress)), idleMs) }),
      ])
    } finally { clearTimeout(timer) }
  }
  const decoder = new TextDecoder()
  const progress: ResponseStreamProgress = { firstEventMs: null, firstTextMs: null, lastEventMs: null, eventCount: 0, outputCharacters: 0, responseId: null }
  let buffer = ''
  let data: string[] = []
  const dispatch = (): T | undefined => {
    if (!data.length) return undefined
    const payload = data.join('\n'); data = []
    if (payload === '[DONE]') throw new Error('OpenAI stream ended without a terminal response')
    const event = JSON.parse(payload) as { type?: string; code?: string; error?: { code?: string; type?: string }; delta?: string; response?: { id?: string; status?: string } }
    const elapsed = performance.now() - started
    progress.firstEventMs ??= elapsed
    progress.lastEventMs = elapsed
    progress.eventCount += 1
    if (event.response?.id) progress.responseId = event.response.id
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      progress.firstTextMs ??= elapsed
      progress.outputCharacters += event.delta.length
      const head = progress.textHead ?? ''
      if (head.length < textHeadLimit) progress.textHead = (head + event.delta).slice(0, textHeadLimit)
    }
    onProgress?.({ ...progress })
    if (['response.completed', 'response.incomplete', 'response.failed'].includes(event.type ?? '')) {
      if (!event.response) throw new Error('OpenAI terminal stream event has no response')
      return event.response as T
    }
    if (event.type === 'error') {
      const code = event.code ?? event.error?.code ?? event.error?.type
      if (code === 'credit_balance_exhausted' || code === 'insufficient_quota') throw new Error('OpenAI API credits are exhausted (insufficient_quota). Add API credits or choose a funded provider to continue.')
      // A server-side failure reported before any output is the same transient
      // outage as a 5xx and is resent like one (in testing: one such
      // event ended the run and its text became the answer).
      const safeCode = typeof code === 'string' && /^[a-z_]{1,48}$/u.test(code) ? code : null
      if (progress.outputCharacters === 0 && safeCode && /server_error|internal|overloaded|unavailable|rate_limit|timeout/u.test(safeCode)) {
        throw new ProviderTransientRequestError('stream', 0, progress.responseId, `OpenAI response stream reported a transient error (${safeCode})`)
      }
      throw new Error(`OpenAI response stream reported an error${safeCode ? ` (${safeCode})` : ''}`)
    }
    return undefined
  }
  try {
    while (true) {
      const { done, value } = await readChunk()
      buffer += decoder.decode(value, { stream: !done })
      // Bound malformed streams which never emit a line terminator.
      if (buffer.length > 8_000_000) throw new Error('OpenAI stream event exceeded the size limit')
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/u, '')
        buffer = buffer.slice(newline + 1)
        if (line === '') {
          const terminal = dispatch()
          if (terminal !== undefined) return terminal
        } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /u, ''))
      }
      if (done) throw new Error('OpenAI response stream disconnected before a terminal response')
    }
  } finally {
    // Completion is an application-level event; do not wait for socket EOF.
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
