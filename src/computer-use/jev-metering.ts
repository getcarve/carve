import type { ModelCall } from '../types.js'
import { jevModel, type JevEvent } from './jev-action-selector.js'

export function estimateJevCost(inputTokens: number | null, outputTokens: number | null): number | null {
  if (inputTokens === null || outputTokens === null || ![inputTokens, outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) return null
  return inputTokens * .042 / 1e6
}

/** Every dispatched selector call is recorded, including paid deferrals and cancellation. */
export function createJevMeter(options: {
  runId: string; sessionId: string; record: (call: ModelCall) => void
  additionalUsage: { modelCalls: number; totalTokens: number; visionFrames: number }
}): (event: JevEvent) => void {
  const seen = new Set<string>()
  return event => {
    if (!event.requestId || seen.has(event.requestId)) return
    const inputTokens = event.inputTokens ?? null, outputTokens = event.outputTokens ?? null
    const known = estimateJevCost(inputTokens, outputTokens) !== null
    options.record({ id: 'jev_' + event.requestId, occurredAt: new Date().toISOString(),
      providerId: 'typesafe-jev', providerKind: 'hosted', model: jevModel, job: 'computer.live',
      runId: options.runId, sessionId: options.sessionId, responseChainId: options.sessionId,
      phase: event.selected ? 'jev_action_selection' : 'jev_selection_deferred',
      inputTokens, outputTokens, totalTokens: known ? inputTokens! + outputTokens! : null,
      status: known ? 'completed' : 'failed', durationMs: event.durationMs, visionFrames: 0 })
    seen.add(event.requestId)
    // Selected requests are counted by the normal provider-turn governor.
    if (!event.selected) {
      options.additionalUsage.modelCalls += 1
      options.additionalUsage.totalTokens += known ? inputTokens! + outputTokens! : 0
    }
  }
}
