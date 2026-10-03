import { describeModelProviderFailure, type ModelProvider, type ModelRequest, type ModelResponse } from './types.js'

/** A hedged attempt that dies on a retryable transport failure (a stream cut after its headers, a reset socket) starts
 * the second attempt at once instead of waiting for the stall timer, so a network blip no longer ends the person's turn
 * with "Couldn't answer" (e2e-0928 net-drop: routing, interpretation and method choice all failed within 0.4 s of a
 * 6 s drop and the turn ended). Still at most two attempts. `STEWARD_HEDGE_TRANSPORT_RETRY=off` restores the old rule. */
export function hedgeTransportRetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_HEDGE_TRANSPORT_RETRY?.trim().toLowerCase() !== 'off'
}
const TRANSPORT_RETRY_DELAY_MS = 750

/**
 * A request that returns nothing for longer than almost every response takes is usually stalled, not slow: one
 * routing call on 27 September sent no response for its whole 60 s window, then the person pressed Stop after 54 s of
 * silence, while every other routing call that evening took 1–3 s. Hedging sends one identical request after
 * `hedgeAfterMs` and takes whichever answers first; the other is aborted. Only for small stateless requests whose
 * duplicate costs a fraction of a cent (metadata-only routing). `STEWARD_ROUTE_HEDGE_MS=off` disables it.
 */
export function routeHedgeAfterMs(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.STEWARD_ROUTE_HEDGE_MS?.trim().toLowerCase()
  if (raw === 'off') return null
  const value = raw ? Number(raw) : 8_000
  return Number.isFinite(value) && value >= 1_000 ? value : 8_000
}

/** The conversation interpretation (median 2.5 s, 90th percentile 4 s over 53 probe runs on 27 September; two took
 * 12.8 and 15.4 s waiting for response headers). `STEWARD_INTERPRET_HEDGE_MS=off` disables its hedge. */
export function interpretHedgeAfterMs(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.STEWARD_INTERPRET_HEDGE_MS?.trim().toLowerCase()
  if (raw === 'off') return null
  const value = raw ? Number(raw) : 6_000
  return Number.isFinite(value) && value >= 1_000 ? value : 6_000
}

/** The web-or-window method choice (median 1.3 s, 90th percentile 2.1 s over 53 probe runs on 27 September; one run's
 * got no response headers in its 12 s window and the person saw "couldn't choose how to handle your request").
 * `STEWARD_METHOD_HEDGE_MS=off` disables its hedge. */
export function methodHedgeAfterMs(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.STEWARD_METHOD_HEDGE_MS?.trim().toLowerCase()
  if (raw === 'off') return null
  const value = raw ? Number(raw) : 5_000
  return Number.isFinite(value) && value >= 1_000 ? value : 5_000
}

/** The compact engine's routine decision (Luna; median 2.6 s, 90th percentile 4.4 s, 99th 7.7 s over 1,328 recorded calls
 * in e2e-0928). Two took 36 s and 14 more failed after 24-31 s, about 300 s of 4,000 s of decision time, all in the
 * longest runs. The request is stateless and a duplicate costs about 0.05 cent, so a stall is raced by one identical
 * request after this delay. Not applied to a strong model: its duplicate costs 3 cents and its long calls are
 * reasoning, not stalls. `STEWARD_DECISION_HEDGE_MS=off` disables it. */
export function decisionHedgeAfterMs(model: string | undefined, env: NodeJS.ProcessEnv = process.env): number | null {
  if (!/luna/iu.test(model ?? '')) return null
  const raw = env.STEWARD_DECISION_HEDGE_MS?.trim().toLowerCase()
  if (raw === 'off') return null
  const value = raw ? Number(raw) : 9_000
  return Number.isFinite(value) && value >= 1_000 ? value : 9_000
}

/** The same provider with every request hedged: for small, stateless requests only (see hedgedComplete). */
export function hedgedProvider<P extends Pick<ModelProvider, 'complete'>>(provider: P, hedgeAfterMs: number | null, onHedge?: () => void): P {
  if (hedgeAfterMs === null) return provider
  return Object.assign(Object.create(provider) as P, {
    complete: (request: ModelRequest) => hedgedComplete(provider, request, { hedgeAfterMs, signal: request.signal ?? new AbortController().signal, ...(onHedge ? { onHedge } : {}) }),
  })
}

export async function hedgedComplete(provider: Pick<ModelProvider, 'complete'>, request: ModelRequest, options: { hedgeAfterMs: number | null; signal: AbortSignal; onHedge?: () => void }): Promise<ModelResponse & { hedged?: 'first' | 'second' }> {
  const first = new AbortController(), second = new AbortController()
  const call = (controller: AbortController) => provider.complete({ ...request, signal: AbortSignal.any([options.signal, controller.signal]) })
  const hedgeAfterMs = options.hedgeAfterMs
  if (hedgeAfterMs === null) return call(first)
  return await new Promise((resolve, reject) => {
    let settled = false, pending = 1, lastError: unknown = null, hedged = false
    const retryTransport = hedgeTransportRetryEnabled()
    const finish = (value: ModelResponse, which: 'first' | 'second') => {
      if (settled) return
      settled = true; clearTimeout(timer)
      ;(which === 'first' ? second : first).abort(new DOMException('Hedged request answered by the other attempt', 'AbortError'))
      resolve(hedged ? { ...value, hedged: which } : value)
    }
    const fail = (error: unknown) => {
      lastError = error; pending -= 1
      if (!settled && !hedged && !options.signal.aborted && retryTransport && describeModelProviderFailure(error, { signal: options.signal }).retryable
        && describeModelProviderFailure(error, { signal: options.signal }).kind === 'transport') {
        // The first attempt died on the network: send the second now (after a short pause) rather than failing the turn.
        clearTimeout(timer); hedged = true; pending += 1; options.onHedge?.()
        setTimeout(() => { if (!settled && !options.signal.aborted) start(second, 'second'); else if (!settled) { pending -= 1; settled = true; reject(lastError) } }, TRANSPORT_RETRY_DELAY_MS)
        return
      }
      // One attempt failing is not the answer while the other may still arrive; a caller abort ends both.
      if (!settled && (pending === 0 || options.signal.aborted)) { settled = true; clearTimeout(timer); reject(lastError) }
    }
    const start = (controller: AbortController, which: 'first' | 'second') => call(controller).then(value => finish(value, which), fail)
    const timer = setTimeout(() => {
      if (settled || options.signal.aborted) return
      hedged = true; pending += 1; options.onHedge?.()
      start(second, 'second')
    }, hedgeAfterMs)
    options.signal.addEventListener('abort', () => { clearTimeout(timer); first.abort(options.signal.reason); second.abort(options.signal.reason) }, { once: true })
    start(first, 'first')
  })
}
