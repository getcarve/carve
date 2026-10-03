/** Connection-level resend for provider requests.
 *
 * A `fetch()` that throws before any response exists (Node's `TypeError: fetch
 * failed` with an undici or socket cause: ECONNRESET, UND_ERR_SOCKET "other
 * side closed", ETIMEDOUT, EAI_AGAIN…) escaped every provider loop: only HTTP
 * statuses were resent. launch-0929 qualification (27 September 2026) lost 3 of
 * 59 fresh runs to `fetch failed` in 0.6–3.6 s, each a request that a second
 * attempt would almost certainly have carried; the person saw "Carve couldn't
 * connect". Every request that goes through here is safe to send again: the
 * stateless ones are `store:false`, and a stored computer-use turn that never
 * produced a response leaves its `previous_response_id` unchanged, so a resend
 * continues the same chain.
 *
 * What is resent: a throw whose cause chain carries a known connection code,
 * before a response began. What is never resent: the caller's own abort, the
 * request's timeout, TLS/certificate failures, `redirect: 'error'` refusals,
 * and anything after response headers arrived (a stream that consumed bytes is
 * the caller's to recover; it is not replayed here).
 *
 * `STEWARD_TRANSPORT_RETRY=off` restores the single attempt. */

/** Codes that mean the connection failed before the request could have been
 * written: nothing reached the provider, so nothing can have been billed. */
const connectPhaseCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'UND_ERR_CONNECT_TIMEOUT'])
/** Codes where the request may have been written before the connection died.
 * Still resent (the request is idempotent in state), but the attempt is
 * counted as one the provider may have seen, for conservative metering. */
const midRequestCodes = new Set(['ECONNRESET', 'UND_ERR_SOCKET', 'ETIMEDOUT', 'EPIPE', 'ECONNABORTED', 'UND_ERR_CLOSED', 'UND_ERR_HEADERS_TIMEOUT'])

export const transportRetryEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_TRANSPORT_RETRY?.trim() !== 'off'

/** The connection code a thrown fetch carries, or null when the throw is not a
 * connection failure (an abort, a timeout, a TLS or redirect refusal, a bug). */
export function connectionFailureCode(error: unknown): string | null {
  const seen = new Set<unknown>()
  const visit = (value: unknown, depth: number): string | null => {
    if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return null
    seen.add(value)
    const record = value as { name?: unknown; code?: unknown; cause?: unknown; errors?: unknown }
    if (record.name === 'AbortError' || record.name === 'TimeoutError') return null
    const code = typeof record.code === 'string' ? record.code : null
    if (code && (connectPhaseCodes.has(code) || midRequestCodes.has(code))) return code
    for (const inner of Array.isArray(record.errors) ? record.errors : []) {
      const found = visit(inner, depth + 1)
      if (found) return found
    }
    return visit(record.cause, depth + 1)
  }
  return visit(error, 0)
}

/** True when the code proves the request never left this machine. */
export const connectPhaseFailure = (code: string | null): boolean => code !== null && connectPhaseCodes.has(code)

/** A request that failed on the connection, every attempt, before any response.
 * `attemptsMayHaveReached` counts attempts whose failure code cannot rule out
 * that the provider received (and may bill) the request; metering charges
 * those at the request's own reserve and releases the rest. */
export class ProviderTransportError extends Error {
  constructor(
    readonly phase: string,
    readonly attempts: number,
    readonly code: string,
    readonly attemptsMayHaveReached: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ProviderTransportError'
  }
}

export interface TransportRetryOptions {
  /** Short, content-free label for messages and audits ("text", "embeddings"). */
  phase: string
  /** The caller's own signal: once aborted, nothing is resent. */
  callerSignal?: AbortSignal | undefined
  /** Resends after the first attempt. */
  retries?: number
  baseDelayMs?: number
  /** No resend starts after this much time since the first attempt. */
  maxElapsedMs?: number
  random?: () => number
  onRetry?: (detail: { attempt: number; code: string; delayMs: number }) => void
  env?: NodeJS.ProcessEnv
}

export const defaultTransportRetries = 2

/** Jittered exponential backoff: 250 ms, 500 ms… each scaled by 0.5–1.0, so
 * concurrent callers that failed together do not resend together. */
export function transportRetryDelayMs(attempt: number, baseDelayMs = 250, random: () => number = Math.random): number {
  return Math.round(baseDelayMs * 2 ** attempt * (0.5 + 0.5 * Math.min(1, Math.max(0, random()))))
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason as Error); return }
    const onAbort = () => { clearTimeout(timer); reject(signal!.reason as Error) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Runs `attempt` (one fetch, returning once response headers exist) and
 * resends connection failures. `attempt` is called afresh each time so each
 * request gets its own timeout signal. Returns the response and the number of
 * connection resends it took; throws `ProviderTransportError` when every
 * attempt failed on the connection, and any other error unchanged. */
export async function withTransportRetry<T>(attempt: () => Promise<T>, options: TransportRetryOptions): Promise<{ value: T; connectionRetries: number }> {
  const retries = transportRetryEnabled(options.env) ? Math.max(0, Math.min(4, options.retries ?? defaultTransportRetries)) : 0
  const started = Date.now()
  let mayHaveReached = 0
  for (let index = 0; ; index++) {
    try {
      return { value: await attempt(), connectionRetries: index }
    } catch (error) {
      const code = connectionFailureCode(error)
      if (code === null || options.callerSignal?.aborted) throw error
      if (!connectPhaseFailure(code)) mayHaveReached++
      const elapsed = Date.now() - started
      if (index >= retries || elapsed >= (options.maxElapsedMs ?? 30_000)) {
        if (!transportRetryEnabled(options.env)) throw error
        throw new ProviderTransportError(options.phase, index + 1, code, mayHaveReached,
          `fetch failed: the ${options.phase} request lost its connection before any response (${code}; ${index + 1} attempt${index ? 's' : ''})`, { cause: error })
      }
      const delayMs = transportRetryDelayMs(index, options.baseDelayMs, options.random)
      try { options.onRetry?.({ attempt: index + 1, code, delayMs }) } catch { /* Telemetry never changes execution. */ }
      await abortableDelay(delayMs, options.callerSignal)
    }
  }
}
