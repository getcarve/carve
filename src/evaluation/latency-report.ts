import type { ModelCall } from '../types.js'

export function summarizeModelLatency(calls: ModelCall[]) {
  const groups = new Map<string, ModelCall[]>()
  for (const call of calls) {
    const key = JSON.stringify([call.job, call.model, call.runtimeBuildId ?? null, call.telemetry?.reasoningEffort ?? null, call.telemetry?.serviceTier ?? null])
    groups.set(key, [...(groups.get(key) ?? []), call])
  }
  return {
    calls: calls.length,
    failedCalls: calls.filter((call) => call.status === 'failed').length,
    caveat: 'Historical calls are not paired benchmarks. Summed call durations include parallel overlap; they are not task wall time. Null usage is unknown. API completion does not imply controller acceptance.',
    groups: [...groups.values()].map((entries) => {
      const first = entries[0]!
      const completed = entries.filter((call) => call.status !== 'failed')
      const durations = completed.flatMap((call) => call.durationMs == null ? [] : [call.durationMs]).sort((a, b) => a - b)
      const cacheKnown = entries.filter((call) => call.inputTokens != null && call.cachedInputTokens != null)
      const cacheInput = cacheKnown.reduce((total, call) => total + call.inputTokens!, 0)
      const cached = cacheKnown.reduce((total, call) => total + call.cachedInputTokens!, 0)
      return {
        job: first.job, model: first.model, runtimeBuildId: first.runtimeBuildId ?? null,
        reasoningEffort: first.telemetry?.reasoningEffort ?? null, serviceTier: first.telemetry?.serviceTier ?? null,
        calls: entries.length, failedCalls: entries.length - completed.length, timedCompletedCalls: durations.length,
        p50Ms: durations.length ? (durations[Math.floor((durations.length - 1) / 2)]! + durations[Math.floor(durations.length / 2)]!) / 2 : null,
        p95Ms: durations.length >= 20 ? durations[Math.ceil(durations.length * .95) - 1]! : null,
        summedCallMs: entries.reduce((total, call) => total + (call.durationMs ?? 0), 0),
        cacheUsageRecords: cacheKnown.length, cacheHitRatio: cacheInput > 0 ? cached / cacheInput : null,
        cacheWriteTokens: entries.some((call) => call.cacheWriteTokens != null) ? entries.reduce((total, call) => total + (call.cacheWriteTokens ?? 0), 0) : null,
        reasoningTokens: entries.some((call) => call.reasoningTokens != null) ? entries.reduce((total, call) => total + (call.reasoningTokens ?? 0), 0) : null,
      }
    }),
  }
}
