import { performance } from 'node:perf_hooks'

/** How busy this process's main thread was over an interval: the event-loop
 * utilization (0–1, share of wall time spent running JavaScript and native
 * callbacks rather than idle) and the longest stall a 20 ms timer observed.
 * Diagnostics only; used to tell a slow helper from a busy host (26 September:
 * the real app captured 3–4× slower than the harness driving the same bundle). */
export function startEventLoopProbe(): () => { eventLoopUtilization: number; maxEventLoopLagMs: number } {
  const startUtilization = performance.eventLoopUtilization()
  let maxLag = 0
  let expected = performance.now() + 20
  const timer = setInterval(() => {
    const now = performance.now()
    maxLag = Math.max(maxLag, now - expected)
    expected = now + 20
  }, 20)
  timer.unref()
  // A caller that returns early never stops the probe; it stops itself.
  const limit = setTimeout(() => clearInterval(timer), 120_000)
  limit.unref()
  return () => {
    clearInterval(timer)
    clearTimeout(limit)
    const now = performance.now()
    maxLag = Math.max(maxLag, now - expected)
    return { eventLoopUtilization: Math.round(performance.eventLoopUtilization(startUtilization).utilization * 1000) / 1000, maxEventLoopLagMs: Math.max(0, Math.round(maxLag)) }
  }
}
