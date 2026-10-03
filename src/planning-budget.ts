export type PlanningTimeoutCause = 'budget_exhausted' | 'request_deadline' | 'no_output' | 'output_stalled' | 'stream_hard_deadline'

export class PlanningTimeoutError extends DOMException {
  constructor(readonly causeCode: PlanningTimeoutCause) {
    super(`Planning timed out: ${causeCode}`, 'TimeoutError')
  }
}

/** One monotonic deadline shared by planning, repairs and fallbacks. */
export class PlanningBudget {
  private readonly deadline: number
  constructor(readonly durationMs: number, private readonly clock: () => number = () => performance.now(), private readonly parent?: AbortSignal, private readonly completionGraceMs = 10_000, private readonly graceBeyondBudget = true) {
    this.deadline = clock() + durationMs
  }
  remainingMs(): number { return Math.max(0, Math.floor(this.deadline - this.clock())) }
  throwIfCancelled(): void { this.parent?.throwIfAborted() }
  signal(callLimitMs: number, parent?: AbortSignal): AbortSignal {
    this.parent?.throwIfAborted()
    const remaining = this.remainingMs()
    if (remaining <= 0) throw new PlanningTimeoutError('budget_exhausted')
    const deadline = AbortSignal.timeout(Math.max(1, Math.min(remaining, callLimitMs)))
    return AbortSignal.any([deadline, ...(parent ? [parent] : []), ...(this.parent ? [this.parent] : [])])
  }
  async run<T>(callLimitMs: number, operation: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
    const callDeadline = this.clock() + Math.min(callLimitMs, this.remainingMs())
    const signal = this.signal(callLimitMs, parent)
    signal.throwIfAborted()
    let abort: () => void = () => {}
    const expired = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
    })
    try {
      // A provider that ignores cancellation cannot bind a late plan.
      const result = await Promise.race([operation(signal), expired])
      signal.throwIfAborted()
      // Timer delivery can lag behind a busy event loop. The monotonic
      // deadline remains authoritative even when the response wins that race.
      if (this.clock() >= callDeadline) throw new PlanningTimeoutError('request_deadline')
      return result
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  /** Let an in-flight request, including a repair, finish productive output.
   * Grace never extends the episode past its original deadline plus allowance;
   * no new request starts after the original budget is exhausted. */
  async runStreaming<T>(
    callLimitMs: number,
    operation: (signal: AbortSignal, markOutput: () => void) => Promise<T>,
    options: { graceMs?: number; idleMs?: number; onGrace?: () => void } = {},
  ): Promise<T> {
    this.throwIfCancelled()
    const remaining = this.remainingMs()
    if (remaining <= 0) throw new PlanningTimeoutError('budget_exhausted')
    const softDeadline = this.clock() + Math.min(callLimitMs, remaining)
    const graceMs = Math.max(0, Math.min(this.completionGraceMs, options.graceMs ?? this.completionGraceMs))
    const idleMs = Math.max(1, Math.min(10_000, options.idleMs ?? 2_000))
    const hardDeadline = Math.min(softDeadline + graceMs, this.deadline + (this.graceBeyondBudget ? graceMs : 0))
    const controller = new AbortController()
    const signal = this.parent ? AbortSignal.any([controller.signal, this.parent]) : controller.signal
    let lastOutput: number | null = null
    let grace = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = (cause: PlanningTimeoutCause) => controller.abort(new PlanningTimeoutError(cause))
    const check = () => {
      if (signal.aborted) return
      const now = this.clock()
      if (now < softDeadline) return
      if (now >= hardDeadline) { expired('stream_hard_deadline'); return }
      if (lastOutput === null) { expired('no_output'); return }
      if (now - lastOutput >= idleMs) { expired('output_stalled'); return }
      if (!grace) { grace = true; options.onGrace?.() }
    }
    const schedule = () => {
      clearTimeout(timer)
      if (signal.aborted) return
      const next = grace ? Math.min(hardDeadline, lastOutput! + idleMs) : softDeadline
      timer = setTimeout(() => { check(); schedule() }, Math.max(1, next - this.clock()))
    }
    const markOutput = () => {
      // Check before updating: a late chunk cannot revive a stalled request.
      check()
      if (signal.aborted) return
      lastOutput = this.clock()
      if (grace) schedule()
    }
    let abort: () => void = () => {}
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
    })
    schedule()
    try {
      signal.throwIfAborted()
      const result = await Promise.race([operation(signal, markOutput), cancelled])
      check()
      signal.throwIfAborted()
      return result
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
  }

}

/** Startup has a bounded productive-output allowance and one separately
 * reserved retry. Repairs share their attempt's clock; neither text chunks
 * nor stage transitions replenish it. */
export class StartupPlanningRecovery {
  private readonly deadline: number
  private claimed = false
  private readonly retryMs: number
  constructor(private readonly primaryMs: number, reserveMs: number, private readonly parent: AbortSignal,
    private readonly clock: () => number = () => performance.now(), readonly completionMs = 60_000) {
    this.retryMs = Math.max(primaryMs, reserveMs)
    this.deadline = clock() + primaryMs + completionMs + this.retryMs + completionMs
  }
  primaryBudget(): PlanningBudget {
    return new PlanningBudget(this.primaryMs, this.clock, this.parent, this.completionMs)
  }
  /** Start a repair with enough of its original allowance to be useful.
   * The reserve is single-use and remains inside the startup hard deadline. */
  forRepair(current: PlanningBudget): PlanningBudget {
    const minimumUsefulMs = Math.min(10_000, Math.ceil(this.primaryMs / 2))
    return current.remainingMs() < minimumUsefulMs ? this.claim() ?? current : current
  }
  claim(): PlanningBudget | null {
    this.parent.throwIfAborted()
    const remaining = Math.floor(this.deadline - this.clock())
    if (this.claimed || remaining <= 0) return null
    this.claimed = true
    const duration = Math.min(this.retryMs, remaining)
    return new PlanningBudget(duration, this.clock, this.parent, Math.min(this.completionMs, remaining - duration))
  }
}

export function livePlanningPolicy(environment: NodeJS.ProcessEnv = process.env) {
  const bounded = (value: string | undefined, fallback: number) => {
    const parsed = Number(value)
    return value?.trim() && Number.isFinite(parsed) && parsed >= 1_000 && parsed <= 120_000 ? Math.round(parsed) : fallback
  }
  return {
    // Adaptive: one result-contract phase. Legacy: goal plus strategy. Never replenish on retry.
    startupMs: bounded(environment.STEWARD_LIVE_STARTUP_BUDGET_MS, 30_000),
    recoveryMs: bounded(environment.STEWARD_LIVE_RECOVERY_BUDGET_MS, 25_000),
    compareStrategies: environment.STEWARD_LIVE_COMPARE_STRATEGIES === '1',
  }
}
