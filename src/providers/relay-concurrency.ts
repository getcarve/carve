import { CloudError } from '../cloud/client.js'

/**
 * Carve Cloud's relay admits at most two model requests in flight per account and refuses a third with
 * 429 `concurrency_limit` (gateway server.ts). The desktop app starts three at once at nearly every request
 * (interpretation, method choice and speculative routing: 1,274 recorded starts on 27 Sep-1 Oct), and hedges stalls
 * with a duplicate, so on the relay one of them was refused at once and never retried. Requests above the limit now
 * wait their turn here instead. The relay can still hold a slot this client no longer counts (a hedged attempt
 * abandoned here keeps running upstream until it answers, or another device of the same account is working), so a
 * `concurrency_limit` refusal is retried with a short backoff before it reaches the caller.
 * `STEWARD_CLOUD_MAX_IN_FLIGHT` sets the limit (default 2, the gateway's); `off` disables queueing and retry.
 */
export class RelayConcurrency {
  private active = 0
  private readonly waiting: Array<{ start: () => void; onAbort?: () => void }> = []

  constructor(private readonly limit: number, private readonly retryDelaysMs: readonly number[] = [250, 500, 1_000, 2_000, 4_000]) {}

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): RelayConcurrency | null {
    const raw = env.STEWARD_CLOUD_MAX_IN_FLIGHT?.trim().toLowerCase()
    if (raw === 'off') return null
    const value = raw ? Number(raw) : 2
    return new RelayConcurrency(Number.isInteger(value) && value >= 1 ? value : 2)
  }

  async run<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    await this.acquire(signal)
    try {
      for (let attempt = 0; ; attempt++) {
        try { return await operation() } catch (error) {
          const delay = this.retryDelaysMs[attempt]
          if (!(error instanceof CloudError && error.code === 'concurrency_limit') || delay === undefined || signal?.aborted) throw error
          await sleep(delay, signal)
        }
      }
    } finally { this.release() }
  }

  get inFlight(): number { return this.active }
  get queued(): number { return this.waiting.length }

  private acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (this.active < this.limit) { this.active++; return Promise.resolve() }
    return new Promise((resolve, reject) => {
      const entry: (typeof this.waiting)[number] = { start: () => { if (entry.onAbort) signal?.removeEventListener('abort', entry.onAbort); this.active++; resolve() } }
      if (signal) {
        entry.onAbort = () => { const index = this.waiting.indexOf(entry); if (index >= 0) this.waiting.splice(index, 1); reject(signal.reason) }
        signal.addEventListener('abort', entry.onAbort, { once: true })
      }
      this.waiting.push(entry)
    })
  }

  private release(): void {
    this.active--
    this.waiting.shift()?.start()
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    const abort = () => { clearTimeout(timer); reject(signal!.reason) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
